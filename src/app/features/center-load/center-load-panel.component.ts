/* Copyright (c) 2025-2026 Gene Ressler
   SPDX-License-Identifier: GPL-3.0-or-later */
import { AfterViewInit, ChangeDetectorRef, Component, ElementRef, OnDestroy, ViewChild } from '@angular/core';
import { Subscription } from 'rxjs';
import { BridgeService } from '../../shared/services/bridge.service';
import { EventBrokerService } from '../../shared/services/event-broker.service';
import { CenterLoadAnalysisService, CenterLoadResult } from './center-load-analysis.service';

@Component({
  selector: 'center-load-panel', providers: [CenterLoadAnalysisService],
  template: `
    <div class="load-controls">
      <label for="center-force">Midspan force: {{ forceKN }} kN per truss</label>
      <input id="center-force" type="range" min="0" max="1000" step="5" [value]="forceKN" (input)="setForce($event)" />
      <input class="numeric" type="number" min="0" max="1000" step="1" aria-label="Center force in kilonewtons per modeled truss" [value]="forceKN" (change)="setForce($event)" />
    </div>
    <p class="summary" [class.warning]="warning">{{ summary }}</p>
    <div #plot class="plot"><canvas #canvas aria-label="Static center-load response; numerical results are shown above"></canvas></div>
    <div class="legend">20x deflection display. Blue: tension; orange: compression; red: over model strength. Gray dashed: original shape.</div>
    <details><summary>Load assumptions and limitations</summary>
      <p>One stationary vertical force at the deck midpoint, applied to one modeled truss, not the combined load shared across two sides. A midpoint between deck joints transfers through a simply supported deck panel. Original app dead-load factors remain; 0 kN means dead load only. No extra truck or impact factor is added to the selected center force.</p>
      <p>Exploratory linear-elastic 2D truss model, not a structural safety rating. No deck bending, three-dimensional load sharing, large-deformation or post-failure collapse analysis. Results beyond member strength are warnings, not a valid prediction of the collapsed shape. Standard truck-test results remain separate.</p>
    </details>
  `,
  styles: [`
    :host { display:flex; flex-direction:column; min-height:0; overflow:auto; background:#fff; color:#171717; font:13px sans-serif; }
    .load-controls { display:flex; align-items:center; flex-wrap:wrap; gap:8px; padding:4px 10px; }
    .load-controls label { font-weight:600; }
    input[type=range] { flex:1; min-width:140px; min-height:44px; touch-action:pan-y; }
    .numeric { width:74px; min-height:36px; font-size:16px; }
    .summary { margin:0; padding:2px 10px 5px; }
    .warning { color:#ad2600; }
    .plot { flex:1 0 120px; min-height:120px; position:relative; }
    canvas { position:absolute; width:100%; height:100%; display:block; }
    .legend { padding:4px 10px; font-size:11px; }
    details { padding:3px 10px 8px; font-size:12px; }
    summary { cursor:pointer; min-height:28px; }
  `],
})
export class CenterLoadPanelComponent implements AfterViewInit, OnDestroy {
  @ViewChild('canvas') canvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('plot') plot!: ElementRef<HTMLDivElement>;
  forceKN = 250;
  summary = 'Calculating static response...';
  warning = false;
  private result: CenterLoadResult | undefined;
  private observer: ResizeObserver | undefined;
  private frame: number | undefined;
  private readonly subscriptions = new Subscription();
  constructor(
    private readonly bridge: BridgeService, private readonly analysis: CenterLoadAnalysisService,
    private readonly broker: EventBrokerService, private readonly changeDetector: ChangeDetectorRef,
  ) {}
  setForce(event: Event): void {
    const value = (event.target as HTMLInputElement).valueAsNumber;
    if (!Number.isFinite(value)) return;
    this.forceKN = Math.max(0, Math.min(1000, value));
    this.schedule();
  }
  private schedule(): void {
    if (this.frame !== undefined) cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => {
      this.frame = undefined;
      try {
        this.result = this.analysis.run(this.forceKN);
        const result = this.result;
        this.warning = result.overStrengthCount > 0 || result.slendernessFailed;
        this.summary = result.overStrengthCount + ' member(s) over model strength; peak utilization ' +
          (result.peakRatio * 100).toFixed(1) + '%; center deflection ' +
          (-1000 * result.centerDeflectionM).toFixed(2) + ' mm downward' +
          (result.slendernessFailed ? '; slenderness check also fails.' : '.');
      } catch (error) {
        this.result = undefined; this.warning = true;
        this.summary = error instanceof Error ? error.message : String(error);
      }
      this.draw(); this.changeDetector.detectChanges();
    });
  }
  private draw(): void {
    const canvas = this.canvas.nativeElement;
    const width = this.plot.nativeElement.clientWidth, height = this.plot.nativeElement.clientHeight;
    if (width <= 0 || height <= 0) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, width, height);
    const result = this.result; if (!result) return;
    const joints = this.bridge.bridge.joints, members = this.bridge.bridge.members;
    const minX = Math.min(...joints.map(j => j.x)), maxX = Math.max(...joints.map(j => j.x));
    const minY = Math.min(...joints.map(j => j.y)), maxY = Math.max(...joints.map(j => j.y));
    const spanX = Math.max(1, maxX - minX), spanY = Math.max(1, maxY - minY);
    const scale = Math.max(0.01, Math.min((width - 56) / spanX, (height - 64) / spanY));
    const left = (width - spanX * scale) / 2;
    const sx = (x: number) => left + (x - minX) * scale;
    const sy = (y: number) => height - 20 - (y - minY) * scale;
    const displaced = (i: number) => ({
      x: joints[i].x + 20 * result.displacements[2 * i],
      y: joints[i].y + 20 * result.displacements[2 * i + 1],
    });
    const line = (ax: number, ay: number, bx: number, by: number) => {
      ctx.beginPath(); ctx.moveTo(sx(ax), sy(ay)); ctx.lineTo(sx(bx), sy(by)); ctx.stroke();
    };
    ctx.strokeStyle = '#aaa'; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
    members.forEach(member => line(member.a.x, member.a.y, member.b.x, member.b.y));
    ctx.setLineDash([]); ctx.lineWidth = 2;
    members.forEach((member, i) => {
      const a = displaced(member.a.index), b = displaced(member.b.index);
      ctx.strokeStyle = Math.abs(result.signedRatios[i]) > 1 ? '#d7191c' : result.memberForces[i] < 0 ? '#bc6500' : '#1565c0';
      line(a.x, a.y, b.x, b.y);
    });
    ctx.fillStyle = '#222';
    joints.forEach((_joint, i) => { const p = displaced(i); ctx.beginPath(); ctx.arc(sx(p.x), sy(p.y), 2.5, 0, 2 * Math.PI); ctx.fill(); });
    const count = this.bridge.designConditions.loadedJointCount;
    const centerX = (joints[0].x + joints[count - 1].x) / 2;
    let centerY = 0;
    for (const share of result.shares) {
      const weight = result.forceKN > 0 ? share.forceKN / result.forceKN : 0;
      centerY += weight * displaced(share.jointIndex).y;
    }
    if (result.forceKN === 0) centerY = joints[0].y + 20 * result.centerDeflectionM;
    const x = sx(centerX), y = sy(centerY);
    ctx.strokeStyle = '#111'; ctx.fillStyle = '#111'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x, y - 32); ctx.lineTo(x, y); ctx.moveTo(x - 5, y - 8); ctx.lineTo(x, y); ctx.lineTo(x + 5, y - 8); ctx.stroke();
    ctx.font = '12px sans-serif'; ctx.fillText(result.forceKN.toFixed(0) + ' kN', x + 7, y - 23);
  }
  ngAfterViewInit(): void {
    this.observer = new ResizeObserver(() => this.draw()); this.observer.observe(this.plot.nativeElement);
    this.subscriptions.add(this.broker.editCommandCompletion.subscribe(() => this.schedule()));
    this.subscriptions.add(this.broker.loadBridgeCompletion.subscribe(() => this.schedule()));
    this.schedule();
  }
  ngOnDestroy(): void {
    if (this.frame !== undefined) cancelAnimationFrame(this.frame);
    this.observer?.disconnect(); this.subscriptions.unsubscribe();
  }
}
