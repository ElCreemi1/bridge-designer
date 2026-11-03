/* SPDX-License-Identifier: GPL-3.0-or-later */
import { Component, Input, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { Subscription } from 'rxjs';
import { BridgeService } from '../../shared/services/bridge.service';
import { DesignGridService, DesignGrid } from '../../shared/services/design-grid.service';
import { PastaSettingsService } from '../../shared/services/pasta-settings.service';
import { EventBrokerService } from '../../shared/services/event-broker.service';
import { UndoManagerService } from '../drafting/shared/undo-manager.service';
import { MoveJointCommand } from '../controls/edit-command/move-joint.command';
import { StaticLoadPanelComponent } from './static-load-panel.component';
import { PastaStrandSessionService } from './pasta-strand-session.service';
import { analyzePasta, PastaInput } from './pasta-analysis';
import { optimizePastaTarget } from './pasta-target-optimization';
type Preview = Awaited<ReturnType<typeof optimizePastaTarget>>;

@Component({
  selector: 'pasta-target-controls', changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <details open><summary>Required-load optimization</summary>
      <label>Hanging mass to hold (g)
        <input type="number" min="1" max="1000000" step="1" [value]="targetG" (input)="setTarget($event)" />
      </label>
      <label>Mode<select [value]="geometryFirst ? 'geometry' : 'strands'" (change)="setMode($event)">
        <option value="geometry">Beam lengths first, then strands</option>
        <option value="strands">Strands only; keep geometry</option>
      </select></label>
      <label>Search<select [value]="effort" (change)="setEffort($event)">
        <option value="500">Quick (500 analyses)</option><option value="3000">Normal (3000)</option><option value="6000">Thorough (6000)</option>
      </select></label>
      <p>Minimize pasta mass while meeting the required center load. This is not the separate mass-budget optimizer.</p>
      <p>Limits from the other panel: {{ panel.maxStrandsPerMember }} strands/member; {{ (settings.maxStrandLengthM * 100).toFixed(1) }} cm stock.</p>
      <button type="button" [disabled]="running || !bridge.designConditions.isPasta" (click)="search()">Find design</button>
      @if (running) { <button type="button" (click)="cancel()">Cancel</button> }
      @if (!bridge.designConditions.isPasta) { <p>Create a Pasta site to apply this geometry optimizer.</p> }
      <p role="status">{{ message }}</p>
      @if (preview; as r) {
        <p [class.warning]="!r.metTarget">{{ r.metTarget ? 'Target met in this model' : 'Target not found' }}.
          Pasta: {{ (r.result.massKg * 1000).toFixed(2) }} g (was {{ baselineMassG.toFixed(2) }} g); predicted first failure: {{ capacityText }}.</p>
        <p>{{ r.changedJointCount }} joint(s) moved; {{ r.evaluations }} analyses{{ r.limited ? '; search limit reached' : '' }}.</p>
        <svg viewBox="0 0 280 110" role="img" aria-label="Geometry preview: gray original, blue proposed">
          @for (line of lines; track $index) {
            <line [attr.x1]="line.ox1" [attr.y1]="line.oy1" [attr.x2]="line.ox2" [attr.y2]="line.oy2" stroke="#aaa" stroke-dasharray="3 3" />
            <line [attr.x1]="line.x1" [attr.y1]="line.y1" [attr.x2]="line.x2" [attr.y2]="line.y2" stroke="#1565c0" stroke-width="2" />
          }
        </svg>
        <button type="button" [disabled]="!r.metTarget || running" (click)="apply()">Apply to drawing</button>
        <p>Apply is one undoable edit. Counts are session-only; coordinate undo survives reload, counts do not.</p>
      }
      <p class="note">1.00 m span, loading joints, fixed supports and connectivity stay fixed. Free joints remain on the drafting grid.
        Local search, not a global minimum or safety certification. No safety factor or upgraded failure physics is added.</p>
    </details>
  `,
  styles: [`
    :host { position:absolute; z-index:3; left:max(8px, env(safe-area-inset-left)); top:60px;
      width:min(300px, 42vw); max-height:calc(100% - 68px); overflow:auto; color:#171717; font:12px sans-serif; }
    details { background:#fffffff2; padding:6px 9px; border:1px solid #555; border-radius:5px; }
    summary { cursor:pointer; min-height:40px; font-weight:600; }
    label { display:block; margin:4px 0; } input,select { display:block; min-height:40px; width:100%; box-sizing:border-box; font-size:16px; }
    button { min-height:44px; margin:4px; } p { margin:6px 0; } .note { font-size:11px; } .warning { color:#ad2600; }
    svg { width:100%; display:block; background:white; }
  `],
})
export class PastaTargetControlsComponent implements OnInit, OnDestroy {
  @Input({ required: true }) panel!: StaticLoadPanelComponent;
  targetG = 1000;
  geometryFirst = true;
  effort = 3000;
  running = false;
  message = '';
  preview: Preview | undefined;
  lines: { x1: number; y1: number; x2: number; y2: number; ox1: number; oy1: number; ox2: number; oy2: number }[] = [];
  baselineMassG = 0;
  private sourceKey = '';
  private original: PastaInput | undefined;
  private abort: AbortController | undefined;
  private destroyed = false;
  private applying = false;
  private readonly subscriptions = new Subscription();
  constructor(readonly bridge: BridgeService, readonly settings: PastaSettingsService,
    private readonly grid: DesignGridService, private readonly session: PastaStrandSessionService,
    private readonly undo: UndoManagerService, private readonly broker: EventBrokerService,
    private readonly detector: ChangeDetectorRef) {}
  get capacityText(): string {
    const n = this.preview?.result.firstFailureForceN;
    return n === undefined || Number.isNaN(n) ? 'fails under self-weight' : Number.isFinite(n) ? `${(n / 9.80665 * 1000).toFixed(1)} g hanging` : 'no limit in this load path';
  }
  setTarget(event: Event): void { this.targetG = (event.target as HTMLInputElement).valueAsNumber; this.invalidate(); }
  setMode(event: Event): void { this.geometryFirst = (event.target as HTMLSelectElement).value === 'geometry'; this.invalidate(); }
  setEffort(event: Event): void { this.effort = Number((event.target as HTMLSelectElement).value); this.invalidate(); }
  cancel(): void { this.abort?.abort(); }
  private invalidate(): void { this.cancel(); this.preview = undefined; this.lines = []; }
  private input(): PastaInput {
    const b = this.bridge.bridge, s = this.bridge.designConditions;
    return { joints: b.joints.map(j => ({ x: j.x, y: j.y })), members: b.members.map(m => ({ a: m.a.index, b: m.b.index })),
      properties: { ...this.panel.props }, forceN: 0,
      strandCounts: this.panel.strandCounts.length === b.members.length ? this.panel.strandCounts.slice() : this.session.read(),
      supports: { loadedJointCount: s.loadedJointCount, isPier: s.isPier, isHiPier: s.isHiPier, pierJointIndex: s.pierJointIndex,
        isArch: s.isArch, archJointIndex: s.archJointIndex, isLeftAnchorage: s.isLeftAnchorage,
        leftAnchorageJointIndex: s.leftAnchorageJointIndex, isRightAnchorage: s.isRightAnchorage, rightAnchorageJointIndex: s.rightAnchorageJointIndex } };
  }
  private key(): string {
    return JSON.stringify({ input: this.input(), fixed: this.bridge.bridge.joints.map(j => j.isFixed), target: this.targetG,
      geometry: this.geometryFirst, step: this.grid.grid.snapMultiple, max: this.panel.maxStrandsPerMember,
      stock: this.settings.maxStrandLengthM, effort: this.effort });
  }
  async search(): Promise<void> {
    if (this.running || !this.bridge.designConditions.isPasta) return;
    this.invalidate(); this.running = true; this.message = 'Searching without changing your drawing...';
    const controller = new AbortController(); this.abort = controller;
    try {
      const source = this.input(), key = this.key(), box = this.bridge.siteInfo.drawingWindow;
      this.baselineMassG = analyzePasta(source).massKg * 1000;
      const result = await optimizePastaTarget(source, { targetMassG: this.targetG,
        maxStrandsPerMember: this.panel.maxStrandsPerMember, maxStrandLengthM: this.settings.maxStrandLengthM,
        geometryFirst: this.geometryFirst, maxEvaluations: this.effort,
        gridStepWorld: DesignGrid.FINE_GRID_SIZE * this.grid.grid.snapMultiple,
        bounds: { xMin: box.x0, xMax: box.x0 + box.width, yMin: box.y0, yMax: box.y0 + box.height },
        lockedJoints: this.bridge.bridge.joints.filter(j => j.isFixed).map(j => j.index), signal: controller.signal,
        onProgress: (phase, evaluations) => { if (!this.destroyed) { this.message = `${phase}: ${evaluations} analyses`; this.detector.markForCheck(); } } });
      if (this.destroyed || controller.signal.aborted) return;
      if (key !== this.key()) throw new Error('Design or settings changed. Run the search again.');
      this.original = source; this.sourceKey = key; this.preview = result; this.makeLines();
      this.message = result.metTarget ? 'Preview ready; the drawing is unchanged until Apply.' : `No applicable design found (${result.reason}). This is not proof that no solution exists.`;
    } catch (error) { if (!this.destroyed) this.message = error instanceof Error ? error.message : String(error); }
    finally { if (!this.destroyed) { this.running = false; this.detector.markForCheck(); } }
  }
  apply(): void {
    const result = this.preview;
    if (!result?.metTarget || this.running || !this.original) return;
    try {
      if (this.sourceKey !== this.key()) throw new Error('Design or settings changed. Search again before applying.');
      const checked = analyzePasta({ ...this.input(), joints: result.joints, strandCounts: result.strandCounts, forceN: result.targetForceN });
      if (!Number.isFinite(checked.peakRatio) || checked.peakRatio > 1 + 1e-8 ||
          checked.memberLengthsM.some(length => length > this.settings.maxStrandLengthM * (1 + 1e-9))) throw new Error('The preview no longer meets the load or length constraints.');
      const command = MoveJointCommand.forPasta(this.bridge.bridge, result.joints, this.session,
        Array.from(this.input().strandCounts!), Array.from(result.strandCounts));
      this.applying = true;
      try { this.undo.do(command); } finally { this.applying = false; }
      this.panel.strandCounts = Array.from(result.strandCounts);
      // Reuse the panel's validated force setter to schedule its normal analysis.
      this.panel.setPastaForce({ target: { valueAsNumber: result.targetForceN } } as unknown as Event);
      this.preview = undefined; this.lines = []; this.message = 'Applied. Return to the drawing to see the geometry and strand counts. Undo restores both for this session.';
    } catch (error) { this.message = error instanceof Error ? error.message : String(error); }
  }
  private makeLines(): void {
    const r = this.preview!, original = this.original!, all = [...r.joints, ...original.joints];
    const x0 = Math.min(...all.map(p => p.x)), x1 = Math.max(...all.map(p => p.x));
    const y0 = Math.min(...all.map(p => p.y)), y1 = Math.max(...all.map(p => p.y));
    const scale = Math.min(260 / Math.max(1e-6, x1 - x0), 85 / Math.max(1e-6, y1 - y0));
    const x = (v: number) => 10 + (v - x0) * scale, y = (v: number) => 100 - (v - y0) * scale;
    this.lines = original.members.map(m => ({ x1: x(r.joints[m.a].x), y1: y(r.joints[m.a].y), x2: x(r.joints[m.b].x), y2: y(r.joints[m.b].y),
      ox1: x(original.joints[m.a].x), oy1: y(original.joints[m.a].y), ox2: x(original.joints[m.b].x), oy2: y(original.joints[m.b].y) }));
  }
  ngOnInit(): void {
    this.subscriptions.add(this.broker.editCommandCompletion.subscribe(() => {
      this.panel.strandCounts = this.session.read();
      if (!this.applying) { this.invalidate(); this.message = 'Drawing edited; search again for a new preview.'; }
      this.detector.markForCheck();
    }));
    this.subscriptions.add(this.broker.loadBridgeCompletion.subscribe(() => { this.invalidate(); this.panel.strandCounts = this.session.read(); }));
  }
  ngOnDestroy(): void { this.destroyed = true; this.cancel(); this.subscriptions.unsubscribe(); }
}
