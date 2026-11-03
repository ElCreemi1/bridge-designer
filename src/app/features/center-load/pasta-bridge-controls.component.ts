/* SPDX-License-Identifier: GPL-3.0-or-later */
import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { Subscription } from 'rxjs';
import { BridgeService } from '../../shared/services/bridge.service';
import { EventBrokerService } from '../../shared/services/event-broker.service';
import { PastaSettingsService } from '../../shared/services/pasta-settings.service';
import { SimulationStateService } from '../fly-thru/rendering/simulation-state.service';
import { PastaInput, PastaProperties } from './pasta-analysis';
import { PastaStrandSessionService } from './pasta-strand-session.service';
import { analyzePastaBridge3, makePastaBridge3 } from './pasta-bridge-3d';
import { bridgePanelIndices, PastaBridgeControlsState } from './pasta-bridge-controls-state.service';

@Component({
  selector: 'pasta-bridge-controls', changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h3>Full bridge numerical results - 1.00 m span, 45 mm width</h3>
    <p>Two side trusses with top and bottom X bracing. Results only: full-bridge rendering and optimization are not connected yet.</p>
    <div class="inputs">
      <label>Total hanging mass (g)<input type="number" min="0" max="1000000" step="100" [value]="state.massG" (change)="setNumber('massG', $event)" /></label>
      <label>Strands per X brace<input type="number" min="1" max="10000" step="1" [value]="state.braceStrands" (change)="setNumber('braceStrands', $event)" /></label>
      <label>Top panels (member numbers)<input type="text" placeholder="e.g. M3, M5" [value]="state.top" (input)="setPanels('top', $event)" /></label>
      <label>Bottom panels (member numbers)<input type="text" placeholder="e.g. M1, M2" [value]="state.bottom" (input)="setPanels('bottom', $event)" /></label>
    </div>
    <p>Available members: {{ memberNumbersText }}. Select existing top/bottom chord members: each gets two crossing braces between the trusses. Crossings are not joints; no transverse ties are added.</p>
    <details><summary>Editable pasta properties</summary><div class="inputs">
      @for (p of propertyRows; track p.key) {
        <label>{{ p.label }}<input type="number" min="0.000001" step="any" [value]="state.props[p.key] / p.scale" (change)="setProperty(p.key, p.scale, $event)" /></label>
      }
    </div><p>Starting properties are placeholders, not measured or calibrated data.</p></details>
    <p>Side-member counts are read from the existing shared session, with identical counts on both sides. Edit those counts in planar mode for now.</p>
    <button type="button" [disabled]="!bridge.designConditions.isPasta" (click)="run()">Analyze full bridge</button>
    <p role="status">{{ message }}</p>
    @if (result; as r) {
      <p [class.warning]="r.peakRatio > 1 || overLength.length > 0">Peak utilization {{ (r.peakRatio * 100).toFixed(1) }}%; {{ failureText }}.</p>
      <p>Both trusses plus X braces: {{ (r.massKg * 1000).toFixed(2) }} g pasta; {{ r.totalStrandCount }} separate pieces. Downward midspan displacement: {{ centerDownMm.toFixed(3) }} mm.</p>
      @if (overLength.length) { <p class="warning">Longer than stock: {{ overLength.join(', ') }}. No splices assumed.</p> }
    }
    <details><summary>Assumptions and limits</summary>
      <p>The centered plate/transfer beams deliver half the total hanging load to each side. Their strength and mass, glue and waste are excluded, not verified. Supports restrain x/y/z at both left seats and y/z at both right seats. Special pier/arch/anchorage layouts are rejected.</p>
      <p>Linear 3D axial truss model with strand self-weight and independently buckling loose strands. No nonlinear collapse, geometric-stiffness stability, member bending, joint failure or safe-load certification.</p>
    </details>
  `,
  styles: [`
    :host { position:absolute; inset:60px 8px 8px; z-index:3; background:#fff; color:#171717; padding:10px; overflow:auto; font:13px sans-serif; }
    h3 { margin:0 0 6px; } p { margin:6px 0; } .inputs { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px; }
    label { display:block; } input { display:block; width:100%; box-sizing:border-box; min-height:40px; font-size:16px; }
    button, summary { min-height:40px; } button { margin-top:8px; } .warning { color:#ad2600; }
  `],
})
export class PastaBridgeControlsComponent implements OnInit, OnDestroy {
  memberNumbersText = '';
  result: ReturnType<typeof analyzePastaBridge3> | undefined;
  overLength: string[] = [];
  centerDownMm = 0;
  failureText = '';
  message = 'Choose top and bottom panels, then Analyze. Existing planar optimization is a separate mode.';
  readonly propertyRows: { key: keyof PastaProperties; label: string; scale: number }[] = [
    { key: 'diameterM', label: 'Diameter (mm)', scale: 1e-3 }, { key: 'elasticModulusPa', label: 'Elastic modulus (GPa)', scale: 1e9 },
    { key: 'tensileStrengthPa', label: 'Tensile strength (MPa)', scale: 1e6 }, { key: 'compressiveStrengthPa', label: 'Compressive strength (MPa)', scale: 1e6 },
    { key: 'densityKgM3', label: 'Density (kg/m3)', scale: 1 },
  ];
  private readonly subscriptions = new Subscription();
  constructor(readonly state: PastaBridgeControlsState, readonly bridge: BridgeService,
    private readonly session: PastaStrandSessionService, private readonly broker: EventBrokerService,
    private readonly settings: PastaSettingsService, private readonly simulation: SimulationStateService,
    private readonly detector: ChangeDetectorRef) {}
  private refresh(): void {
    const b = this.bridge.bridge;
    this.state.synchronize(b, b.members, JSON.stringify(b.members.map(m => [m.a.index, m.b.index, m.number])));
    this.memberNumbersText = b.members.map(m => `M${m.number}`).join(', ');
  }
  private invalidate(): void {
    this.result = undefined; this.overLength = []; this.centerDownMm = 0; this.failureText = '';
    this.message = 'Inputs changed. Analyze again; no drawing geometry was changed.';
  }
  setNumber(key: 'massG' | 'braceStrands', event: Event): void {
    this.invalidate(); const value = (event.target as HTMLInputElement).valueAsNumber;
    this.state[key] = value;
  }
  setPanels(key: 'top' | 'bottom', event: Event): void { this.state[key] = (event.target as HTMLInputElement).value; this.invalidate(); }
  setProperty(key: keyof PastaProperties, scale: number, event: Event): void {
    this.state.props = { ...this.state.props, [key]: (event.target as HTMLInputElement).valueAsNumber * scale }; this.invalidate();
  }
  run(): void {
    this.invalidate();
    try {
      this.refresh();
      if (!this.bridge.designConditions.isPasta) throw new Error('Create a Pasta site before using full-bridge mode.');
      if (!Number.isFinite(this.state.massG) || this.state.massG < 0 || this.state.massG > 1000000) throw new Error('Total hanging mass must be from 0 to 1000000 g.');
      const b = this.bridge.bridge, c = this.bridge.designConditions, numbers = b.members.map(m => m.number);
      const input: PastaInput = {
        joints: b.joints.map(j => ({ x: j.x, y: j.y })), members: b.members.map(m => ({ a: m.a.index, b: m.b.index })),
        supports: { loadedJointCount: c.loadedJointCount, isPier: c.isPier, isHiPier: c.isHiPier, pierJointIndex: c.pierJointIndex,
          isArch: c.isArch, archJointIndex: c.archJointIndex, isLeftAnchorage: c.isLeftAnchorage, leftAnchorageJointIndex: c.leftAnchorageJointIndex,
          isRightAnchorage: c.isRightAnchorage, rightAnchorageJointIndex: c.rightAnchorageJointIndex },
        properties: { ...this.state.props }, forceN: this.state.massG * 9.80665 / 1000, strandCounts: this.session.read(),
      };
      const model = makePastaBridge3(input, bridgePanelIndices(this.state.top, numbers), bridgePanelIndices(this.state.bottom, numbers), this.state.braceStrands);
      const r = analyzePastaBridge3(model);
      this.overLength = model.members.filter((_, i) => r.memberLengthsM[i] > this.settings.maxStrandLengthM * (1 + 1e-9)).map(m => m.label);
      this.centerDownMm = -1000 * model.unitLoads.reduce((sum, load, i) => sum - load * r.displacements[i], 0);
      this.failureText = Number.isNaN(r.firstFailureForceN) ? 'self-weight alone exceeds model capacity' : Number.isFinite(r.firstFailureForceN)
        ? `first model member capacity at ${(r.firstFailureForceN / 9.80665 * 1000).toFixed(1)} g total hanging mass` : 'no finite first-failure load in this linear model';
      this.result = r;
      this.message = 'Calculated using the full 3D solver. These results do not drive the renderer, optimizer or PDF quantities yet.';
    } catch (error) { this.message = error instanceof Error ? error.message : String(error); }
  }
  ngOnInit(): void {
    this.refresh();
    this.simulation.setStaticResponse({ displayDisplacements: new Float64Array(2 * this.bridge.bridge.joints.length), signedRatios: new Float64Array(this.bridge.bridge.members.length), hideDeck: true });
    const edited = () => { this.refresh(); this.invalidate(); this.detector.markForCheck(); };
    this.subscriptions.add(this.broker.editCommandCompletion.subscribe(edited));
    this.subscriptions.add(this.broker.loadBridgeCompletion.subscribe(() => { this.state.resetLayout(); edited(); }));
  }
  ngOnDestroy(): void { this.subscriptions.unsubscribe(); this.simulation.setStaticResponse(undefined); }
}
