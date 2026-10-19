/* SPDX-License-Identifier: GPL-3.0-or-later */
import { AfterViewInit, ChangeDetectionStrategy, ChangeDetectorRef, Component, ElementRef, Input, NgZone, OnDestroy, ViewChild } from '@angular/core';
import { mat4 } from 'gl-matrix';
import { BridgeService } from '../../../shared/services/bridge.service';
import { StaticLoadPanelComponent } from '../../center-load/static-load-panel.component';
import { ProjectionService } from './projection.service';
import { SimulationStateService } from './simulation-state.service';
import { ViewService } from './view.service';
import { ViewportService } from './viewport.service';
import { KeyboardService } from '../pane/keyboard.service';
import { MAX_DRAWN_STRANDS, projectStrandPoint, strandOffsets } from './strand-visuals';

type StrandLabel = { index: number; count: number; lengthCm: string; x: number; y: number; depth: number };

/** Read-only schematic overlay. It never changes counts, materials or solver data. */
@Component({
  selector: 'pasta-strand-overlay', changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <canvas #canvas aria-hidden="true"></canvas>
    <div class="toolbar">
      <label><input type="checkbox" [checked]="enabled" (change)="toggle($event)" /> Show strand counts</label>
      @if (enabled) {
        <p>Tap a member label for its build details. Counts are per member on each displayed side.</p>
        <p>Schematic overlay, not depth-occluded. Up to {{ maxDrawn }} strands drawn per bundle; labels show exact counts.</p>
      }
    </div>
    @if (enabled) {
      @for (label of labels; track label.index) {
        <button class="member" type="button" [class.selected]="selectedIndex === label.index"
          [style.left.px]="label.x" [style.top.px]="label.y"
          [attr.aria-label]="'Member ' + (label.index + 1) + ': ' + label.count + ' strands, ' + label.lengthCm + ' centimeters'"
          [attr.aria-pressed]="selectedIndex === label.index" (click)="selectedIndex = label.index">
          M{{ label.index + 1 }} · {{ label.count }}×
        </button>
      }
      @if (selected; as row) {
        <div class="inspection" role="status">
          <button type="button" aria-label="Close member details" (click)="selectedIndex = -1">×</button>
          <strong>M{{ row.index + 1 }}: {{ row.count }} spaghetti strand{{ row.count === 1 ? '' : 's' }}</strong>
          <p>{{ row.lengthCm }} cm per strand · {{ row.state }}</p>
          <p>Loose parallel strands, connected only at the joints. No bonded-composite strength is implied.</p>
        </div>
      }
    }
  `,
  styles: [`
    :host { position:absolute; inset:0; z-index:2; pointer-events:none; overflow:hidden; font:12px sans-serif; color:#171717; }
    canvas { position:absolute; inset:0; width:100%; height:100%; pointer-events:none; }
    .toolbar,.inspection { position:absolute; left:max(8px, env(safe-area-inset-left)); background:#fffffff0;
      border:1px solid #666; border-radius:5px; padding:4px 8px; pointer-events:auto; box-sizing:border-box; }
    .toolbar { top:60px; max-width:min(240px, 40vw); }
    label { min-height:40px; display:flex; align-items:center; gap:6px; cursor:pointer; }
    input { width:20px; height:20px; }
    p { margin:4px 0; font-size:11px; }
    .member { position:absolute; transform:translate(-50%, -50%); pointer-events:auto; min-height:36px;
      min-width:44px; border:1px solid #444; border-radius:5px; padding:3px 5px;
      background:#ffffffe8; color:#111; font:12px sans-serif; touch-action:manipulation; }
    .member.selected { background:#ffe3a0; border:2px solid #684500; z-index:1; }
    .inspection { bottom:64px; max-width:min(300px, 45vw); }
    .inspection button { float:right; min-width:40px; min-height:40px; font-size:20px; }
  `],
})
export class PastaStrandOverlayComponent implements AfterViewInit, OnDestroy {
  @Input({ required: true }) panel!: StaticLoadPanelComponent;
  @ViewChild('canvas') canvas!: ElementRef<HTMLCanvasElement>;
  readonly maxDrawn = MAX_DRAWN_STRANDS;
  enabled = true;
  selectedIndex = -1;
  labels: StrandLabel[] = [];
  private frame: number | undefined;
  private lastDraw = -Infinity;
  private locations = new Float32Array(0);
  private readonly view = mat4.create();
  private readonly projection = mat4.create();
  private readonly transform = mat4.create();
  get selected() {
    return this.labels.some(label => label.index === this.selectedIndex)
      ? this.panel.strandRows.find(row => row.index === this.selectedIndex) : undefined;
  }
  constructor(
    private readonly bridge: BridgeService, private readonly simulation: SimulationStateService,
    private readonly camera: ViewService, private readonly projections: ProjectionService,
    private readonly viewport: ViewportService, private readonly keyboard: KeyboardService,
    private readonly zone: NgZone, private readonly detector: ChangeDetectorRef,
  ) {}
  toggle(event: Event): void {
    this.enabled = (event.target as HTMLInputElement).checked;
    this.selectedIndex = -1;
  }
  ngAfterViewInit(): void {
    this.zone.runOutsideAngular(() => {
      const tick = (time: number) => {
        if (time - this.lastDraw >= 50) {
          this.lastDraw = time;
          this.draw(); this.detector.detectChanges();
        }
        this.frame = requestAnimationFrame(tick);
      };
      this.frame = requestAnimationFrame(tick);
    });
  }
  ngOnDestroy(): void { if (this.frame !== undefined) cancelAnimationFrame(this.frame); }

  private draw(): void {
    const canvas = this.canvas.nativeElement;
    const width = this.viewport.width, height = this.viewport.height;
    if (width <= 0 || height <= 0) { this.labels = []; return; }
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(width * dpr), h = Math.round(height * dpr);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    const ctx = canvas.getContext('2d'); if (!ctx) { this.labels = []; return; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, width, height);
    this.labels = [];
    if (!this.enabled || this.panel.mode !== 'pasta' || this.panel.shortSummary === 'error' ||
        this.keyboard.debugState.projectionType !== 'normal') return;
    const bridge = this.bridge.bridge, rows = this.panel.strandRows;
    if (rows.length !== bridge.members.length || rows.some((row, i) => row.count !== this.panel.strandCounts[i])) return;
    if (this.locations.length !== bridge.joints.length * 2) this.locations = new Float32Array(bridge.joints.length * 2);
    this.simulation.interpolator.getAllDisplacedJointLocations(this.locations);
    this.camera.getLookAtMatrix(this.view); this.projections.getPerspectiveProjection(this.projection);
    mat4.multiply(this.transform, this.projection, this.view);
    const deckCount = this.bridge.designConditions.loadedJointCount;
    const span = bridge.joints[deckCount - 1].x - bridge.joints[0].x;
    const diameter = this.panel.props.diameterM * span;
    if (!Number.isFinite(diameter) || diameter <= 0) return;
    const project = (x: number, y: number, z: number) => projectStrandPoint(this.transform, x, y, z, width, height);
    const sides = [this.bridge.trussCenterlineOffset, -this.bridge.trussCenterlineOffset];
    bridge.members.forEach((member, index) => {
      const row = rows[index];
      if (!row || row.index !== index || !Number.isInteger(row.count) || row.count < 1 || row.count > 10000) return;
      const ax = this.locations[2 * member.a.index], ay = this.locations[2 * member.a.index + 1];
      const bx = this.locations[2 * member.b.index], by = this.locations[2 * member.b.index + 1];
      const length = Math.hypot(bx - ax, by - ay); if (!Number.isFinite(length) || length < 1e-9) return;
      const nx = -(by - ay) / length, ny = (bx - ax) / length;
      const ratio = this.simulation.interpolator.memberForceStrengthRatios[index];
      ctx.strokeStyle = index === this.selectedIndex ? '#9b6800' : ratio < 0 ? '#c74e32' : '#286daf';
      ctx.lineWidth = index === this.selectedIndex ? 2.5 : 1.15;
      const offsets = strandOffsets(row.count);
      let label: StrandLabel | undefined;
      for (const side of sides) {
        for (const offset of offsets) {
          const dy = offset.y * diameter, dz = offset.z * diameter;
          const a = project(ax + nx * dy, ay + ny * dy, side + dz);
          const b = project(bx + nx * dy, by + ny * dy, side + dz);
          if (a && b) { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
        }
        const middle = project((ax + bx) / 2, (ay + by) / 2, side);
        if (middle && middle.x >= 24 && middle.x <= width - 24 && middle.y >= 18 && middle.y <= height - 18 &&
            (!label || middle.depth < label.depth)) {
          label = { index, count: row.count, lengthCm: row.lengthCm, ...middle };
        }
      }
      if (label) this.labels.push(label);
    });
  }
}
