/* Copyright (c) 2025-2026 Gene Ressler
   SPDX-License-Identifier: GPL-3.0-or-later */
import { AfterViewInit, ChangeDetectionStrategy, ChangeDetectorRef, Component, Input, OnChanges, OnDestroy } from '@angular/core';
import { Subscription } from 'rxjs';
import { BridgeService } from '../../shared/services/bridge.service';
import { EventBrokerService } from '../../shared/services/event-broker.service';
import { SimulationStateService } from '../fly-thru/rendering/simulation-state.service';
import { CenterLoadAnalysisService } from './center-load-analysis.service';
import { analyzePasta, DEFAULT_PASTA_PROPERTIES, optimizeStrands, overLengthMembers, PastaProperties, PastaResult } from './pasta-analysis';
import { PastaSettingsService } from '../../shared/services/pasta-settings.service';

export type StaticLoadMode = 'center' | 'pasta';

/** Overlay controls for static loads shown in the shared 3D scene. */
@Component({
  selector: 'static-load-panel', providers: [CenterLoadAnalysisService],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <details class="panel" open>
      <summary>{{ mode === 'center' ? 'Center load' : 'Pasta 1.00 m' }} &mdash; {{ shortSummary }}</summary>
      @if (mode === 'center') {
        <label for="center-force">Midspan force: {{ forceKN }} kN per truss</label>
        <div class="row">
          <input id="center-force" type="range" min="0" max="1000" step="5" [value]="forceKN" (input)="setCenterForce($event)" />
          <input class="numeric" type="number" min="0" max="1000" step="1" aria-label="Center force in kilonewtons per modeled truss" [value]="forceKN" (change)="setCenterForce($event)" />
        </div>
      } @else {
        <label for="pasta-force">Center force: {{ forceN.toFixed(1) }} N (&asymp; {{ (forceN / 9.80665).toFixed(2) }} kg hanging)</label>
        <div class="row">
          <input id="pasta-force" type="range" min="0" [max]="pastaMaxN" step="0.1" [value]="forceN" (input)="setPastaForce($event)" />
          <input class="numeric" type="number" min="0" step="0.1" aria-label="Center force in newtons" [value]="forceN" (change)="setPastaForce($event)" />
        </div>
        <details>
          <summary>Strand properties</summary>
          <div class="grid">
            <label>Diameter (mm)<input type="number" min="0.1" step="0.1" [value]="props.diameterM * 1e3" (change)="setProp('diameterM', $event, 1e-3)" /></label>
            <label>Elastic modulus (GPa)<input type="number" min="0.1" step="0.1" [value]="props.elasticModulusPa / 1e9" (change)="setProp('elasticModulusPa', $event, 1e9)" /></label>
            <label>Tensile strength (MPa)<input type="number" min="0.1" step="0.5" [value]="props.tensileStrengthPa / 1e6" (change)="setProp('tensileStrengthPa', $event, 1e6)" /></label>
            <label>Compressive strength (MPa)<input type="number" min="0.1" step="0.5" [value]="props.compressiveStrengthPa / 1e6" (change)="setProp('compressiveStrengthPa', $event, 1e6)" /></label>
            <label>Density (kg/m&sup3;)<input type="number" min="1" step="10" [value]="props.densityKgM3" (change)="setProp('densityKgM3', $event, 1)" /></label>
          </div>
          <label>Longest strand (cm)<input type="number" min="1" max="200" step="0.5" [value]="maxStrandLengthCm" (change)="setMaxStrandLength($event)" /></label>
          <button type="button" (click)="resetProps()">Reset to starting values</button>
          <p class="note">Starting values are placeholders, not measured data. Pasta varies by brand and humidity; enter values you have measured.</p>
        </details>
        @if (overLength.length) {
          <p class="summary warning">{{ overLength.length }} member(s) longer than one {{ maxStrandLengthCm }} cm strand: {{ overLengthText }}. The optimizer will not run until they are shortened.</p>
        }
        <details>
          <summary>Strands per member ({{ pastaTotalStrands }} total)</summary>
          <p class="note">Loose strands joined only at the joints: each strand buckles on its own, so n strands carry n times one strand.</p>
          <div class="strand-list">
            @for (row of strandRows; track row.index) {
              <div class="strand-row" [class.governing]="row.governing" [class.over-length]="row.overLength">
                <span class="member-label">M{{ row.index + 1 }}</span>
                <span class="member-state">{{ row.lengthCm }} cm, {{ row.state }}</span>
                <button type="button" aria-label="Remove a strand" [disabled]="row.count <= 1" (click)="changeStrands(row.index, -1)">&minus;</button>
                <span class="count">{{ row.count }}</span>
                <button type="button" aria-label="Add a strand" (click)="changeStrands(row.index, 1)">+</button>
              </div>
            }
          </div>
          <button type="button" (click)="resetStrands()">All members to 1 strand</button>
        </details>
        <details>
          <summary>Optimize strands</summary>
          <p class="note">Keeps your drawn shape and picks strand counts that carry the most center load within the mass budget.</p>
          <div class="grid">
            <label>Mass budget (g)<input type="number" min="0.1" step="1" [value]="massBudgetG" (change)="setMassBudget($event)" /></label>
            <label>Max strands per member<input type="number" min="1" step="1" [value]="maxStrandsPerMember" (change)="setMaxStrands($event)" /></label>
          </div>
          <button type="button" (click)="runOptimizer()">Optimize strands</button>
          @if (optimizerMessage) { <p class="summary" [class.warning]="optimizerWarning">{{ optimizerMessage }}</p> }
        </details>
      }
      <label for="exaggeration">Deflection display: {{ exaggeration }}&times;</label>
      <input id="exaggeration" type="range" min="1" max="200" step="1" [value]="exaggeration" (input)="setExaggeration($event)" />
      <p class="summary" [class.warning]="warning">{{ summary }}</p>
      <p class="legend">Gray to blue: tension; gray to red: compression (full color at capacity). Collapse is not animated.</p>
      <details>
        <summary>Model assumptions</summary>
        @if (mode === 'center') {
          <p>One stationary vertical force at the deck midpoint on one modeled truss. A midpoint between deck joints transfers through a simply supported deck panel. Original steel members and factored dead loads are retained; 0 kN means dead load only. No truck or impact factor is added.</p>
        } @else {
          <p>The drawing is scaled so the deck span is exactly 1.00 m (on the pasta site it already is). Members longer than one strand at that scale are flagged. Each drawn member is a bundle of loose solid circular strands (one by default) joined only at the joints; steel sizes are ignored. Loads are strand self-weight plus the center force; no deck, truck or highway factors. Tension is checked against tensile strength; compression against the smaller of crushing and pinned-end Euler buckling, &pi;&sup2;EI/L&sup2;, for each strand separately. Gluing strands together along their length would raise buckling capacity; that is not modeled.</p>
          <p>This is one planar truss shown in 3D. It does not analyze lateral bracing, twisting, out-of-plane buckling or glue joints.</p>
        }
        <p>Linear-elastic small-deflection model for exploration, not a safety rating. Results past capacity are warnings; the collapsed shape is not predicted.</p>
      </details>
    </details>
  `,
  styles: [`
    :host { display:block; color:#171717; font:13px sans-serif; }
    .panel { background:rgba(255,255,255,0.94); border:1px solid #555; border-radius:6px; padding:4px 10px 6px; max-height:100%; overflow:auto; box-sizing:border-box; }
    summary { cursor:pointer; min-height:32px; line-height:32px; font-weight:600; }
    details details summary { font-weight:500; }
    label { display:block; margin-top:4px; }
    .row { display:flex; align-items:center; gap:8px; }
    input[type=range] { flex:1; width:100%; min-height:40px; touch-action:pan-y; }
    .numeric { width:78px; min-height:36px; font-size:16px; }
    .grid { display:grid; grid-template-columns:1fr 1fr; gap:4px 10px; }
    .grid input { display:block; width:100%; min-height:34px; font-size:16px; box-sizing:border-box; }
    button { min-height:36px; margin-top:6px; }
    .summary { margin:4px 0 0; }
    .warning { color:#ad2600; }
    .legend, .note, p { font-size:12px; margin:4px 0; }
    .strand-list { max-height:180px; overflow:auto; border:1px solid #ccc; border-radius:4px; }
    .strand-row { display:grid; grid-template-columns:42px 1fr 36px 30px 36px; align-items:center; gap:4px; padding:2px 4px; }
    .strand-row:nth-child(odd) { background:#f3f3f3; }
    .strand-row.governing { background:#ffe3d9; font-weight:600; }
    .strand-row.over-length .member-label, .strand-row.over-length .member-state { color:#c00000; font-weight:600; }
    .strand-row button { min-height:32px; margin:0; padding:0; font-size:18px; }
    .strand-row .count { text-align:center; }
    .member-state { font-size:11px; color:#444; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  `],
})
export class StaticLoadPanelComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() mode: StaticLoadMode = 'center';
  forceKN = 250;
  forceN = 5;
  pastaMaxN = 50;
  exaggeration = 20;
  props: PastaProperties = { ...DEFAULT_PASTA_PROPERTIES };
  /** Strands per member for pasta mode; reset when the member count changes. */
  strandCounts: number[] = [];
  strandRows: { index: number; count: number; state: string; governing: boolean; lengthCm: string; overLength: boolean }[] = [];
  overLength: { index: number; lengthM: number }[] = [];
  overLengthText = '';
  pastaTotalStrands = 0;
  massBudgetG = 0;
  maxStrandsPerMember = 20;
  optimizerMessage = '';
  optimizerWarning = false;
  summary = 'Calculating static response...';
  shortSummary = '';
  warning = false;
  private frame: number | undefined;
  private viewReady = false;
  private readonly subscriptions = new Subscription();

  constructor(
    private readonly bridge: BridgeService,
    private readonly centerAnalysis: CenterLoadAnalysisService,
    private readonly broker: EventBrokerService,
    private readonly simulationState: SimulationStateService,
    private readonly changeDetector: ChangeDetectorRef,
    private readonly pastaSettings: PastaSettingsService,
  ) {}

  setCenterForce(event: Event): void {
    const value = (event.target as HTMLInputElement).valueAsNumber;
    if (!Number.isFinite(value)) return;
    this.forceKN = Math.max(0, Math.min(1000, value));
    this.schedule();
  }
  setPastaForce(event: Event): void {
    const value = (event.target as HTMLInputElement).valueAsNumber;
    if (!Number.isFinite(value)) return;
    this.forceN = Math.max(0, Math.min(10000, value));
    if (this.forceN > this.pastaMaxN) this.pastaMaxN = Math.ceil(this.forceN);
    this.schedule();
  }
  setProp(key: keyof PastaProperties, event: Event, unit: number): void {
    const value = (event.target as HTMLInputElement).valueAsNumber;
    if (!Number.isFinite(value) || value <= 0) return;
    this.props = { ...this.props, [key]: value * unit };
    this.schedule();
  }
  get maxStrandLengthCm(): number { return Math.round(this.pastaSettings.maxStrandLengthM * 1000) / 10; }
  setMaxStrandLength(event: Event): void {
    const value = (event.target as HTMLInputElement).valueAsNumber / 100;
    if (PastaSettingsService.isValidLength(value)) this.pastaSettings.maxStrandLengthM = value;
    this.optimizerMessage = '';
    this.schedule();
  }
  resetProps(): void { this.props = { ...DEFAULT_PASTA_PROPERTIES }; this.schedule(); }
  changeStrands(index: number, delta: number): void {
    this.ensureStrandCounts();
    this.strandCounts[index] = Math.max(1, Math.min(10000, this.strandCounts[index] + delta));
    this.optimizerMessage = '';
    this.schedule();
  }
  resetStrands(): void { this.strandCounts = []; this.optimizerMessage = ''; this.schedule(); }
  setMassBudget(event: Event): void {
    const value = (event.target as HTMLInputElement).valueAsNumber;
    if (Number.isFinite(value) && value > 0) this.massBudgetG = value;
  }
  setMaxStrands(event: Event): void {
    const value = (event.target as HTMLInputElement).valueAsNumber;
    if (Number.isInteger(value) && value >= 1) this.maxStrandsPerMember = Math.min(10000, value);
  }
  runOptimizer(): void {
    try {
      this.ensureStrandCounts();
      const before = analyzePasta({ ...this.pastaInput(), strandCounts: this.strandCounts });
      const started = performance.now();
      const { strandCounts, result, evaluations } = optimizeStrands(this.pastaInput(), {
        massBudgetKg: this.massBudgetG / 1000, maxStrandsPerMember: this.maxStrandsPerMember,
        maxStrandLengthM: this.pastaSettings.maxStrandLengthM,
      });
      this.strandCounts = Array.from(strandCounts);
      const describe = (r: PastaResult) => Number.isNaN(r.firstFailureForceN) ? 'fails under its own weight'
        : `${r.firstFailureForceN.toFixed(2)} N at ${(r.massKg * 1000).toFixed(1)} g (${r.efficiencyNPerG.toFixed(3)} N/g)`;
      this.optimizerWarning = Number.isNaN(result.firstFailureForceN);
      this.optimizerMessage = `Before: ${describe(before)}. After: ${describe(result)}, ${result.totalStrandCount} strands. ` +
        `${evaluations} analyses in ${Math.round(performance.now() - started)} ms.`;
    } catch (error) {
      this.optimizerWarning = true;
      this.optimizerMessage = error instanceof Error ? error.message : String(error);
    }
    this.schedule();
  }

  private ensureStrandCounts(): void {
    const n = this.bridge.bridge.members.length;
    if (this.strandCounts.length !== n) this.strandCounts = new Array(n).fill(1);
  }

  private pastaInput() {
    const b = this.bridge.bridge, c = this.bridge.designConditions;
    return {
      joints: b.joints, members: b.members.map(m => ({ a: m.a.index, b: m.b.index })), supports: c,
      properties: this.props, forceN: this.forceN,
    };
  }
  setExaggeration(event: Event): void {
    const value = (event.target as HTMLInputElement).valueAsNumber;
    if (!Number.isFinite(value)) return;
    this.exaggeration = Math.max(1, Math.min(200, Math.round(value)));
    this.schedule();
  }

  ngOnChanges(): void {
    this.exaggeration = this.mode === 'pasta' ? 10 : 20;
    if (this.viewReady) this.schedule();
  }
  ngAfterViewInit(): void {
    this.viewReady = true;
    this.subscriptions.add(this.broker.editCommandCompletion.subscribe(() => this.schedule()));
    this.subscriptions.add(this.broker.loadBridgeCompletion.subscribe(() => this.schedule()));
    this.schedule();
  }
  ngOnDestroy(): void {
    if (this.frame !== undefined) cancelAnimationFrame(this.frame);
    this.subscriptions.unsubscribe();
    this.simulationState.setStaticResponse(undefined);
  }

  private schedule(): void {
    if (this.frame !== undefined) cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => {
      this.frame = undefined;
      try {
        if (this.mode === 'center') this.runCenter(); else this.runPasta();
      } catch (error) {
        this.warning = true;
        this.summary = error instanceof Error ? error.message : String(error);
        this.shortSummary = 'error';
        // Show the undeformed bridge in neutral color rather than stale or fabricated results.
        this.simulationState.setStaticResponse({
          displayDisplacements: new Float64Array(2 * this.bridge.bridge.joints.length),
          signedRatios: new Float64Array(this.bridge.bridge.members.length), hideDeck: this.mode === 'pasta',
        });
      }
      this.changeDetector.detectChanges();
    });
  }

  private runCenter(): void {
    const r = this.centerAnalysis.run(this.forceKN);
    const display = r.displacements.map(d => d * this.exaggeration);
    this.simulationState.setStaticResponse({ displayDisplacements: display, signedRatios: r.signedRatios, hideDeck: false });
    this.warning = r.overStrengthCount > 0 || r.slendernessFailed;
    this.shortSummary = `${this.forceKN} kN, peak ${(r.peakRatio * 100).toFixed(0)}%`;
    this.summary = `${r.overStrengthCount} member(s) over model strength; peak utilization ${(r.peakRatio * 100).toFixed(1)}%; ` +
      `center deflection ${(-1000 * r.centerDeflectionM).toFixed(2)} mm downward` +
      (r.slendernessFailed ? '; slenderness check also fails.' : '.');
  }

  private runPasta(): void {
    this.ensureStrandCounts();
    const r = analyzePasta({ ...this.pastaInput(), strandCounts: this.strandCounts });
    this.pastaTotalStrands = r.totalStrandCount;
    if (!(this.massBudgetG > 0)) this.massBudgetG = Math.ceil(r.massKg * 1000 * 3);
    let governing = -1;
    for (let i = 0; i < r.memberFailureForceN.length; i++) {
      if (governing < 0 || r.memberFailureForceN[i] < r.memberFailureForceN[governing]) governing = i;
    }
    this.overLength = overLengthMembers(r, this.pastaSettings.maxStrandLengthM);
    const overSet = new Set(this.overLength.map(o => o.index));
    this.overLengthText = this.overLength.map(o => `M${o.index + 1} (${(o.lengthM * 100).toFixed(1)} cm)`).join(', ');
    this.strandRows = this.strandCounts.map((count, index) => ({
      index, count, governing: index === governing,
      lengthCm: (r.memberLengthsM[index] * 100).toFixed(1), overLength: overSet.has(index),
      state: `${r.memberForces[index] >= 0 ? 'tension' : r.bucklingGoverns[index] ? 'buckling' : 'crushing'} ${(Math.abs(r.signedRatios[index]) * 100).toFixed(0)}%`,
    }));
    // Displacements of the 1.00 m model mapped back to drawing scale, then exaggerated.
    const factor = this.exaggeration / r.scale;
    this.simulationState.setStaticResponse({
      displayDisplacements: r.displacements.map(d => d * factor), signedRatios: r.signedRatios, hideDeck: true,
    });
    const buckling = r.signedRatios.reduce((n, ratio, i) => n + (ratio < -1 && r.bucklingGoverns[i] ? 1 : 0), 0);
    this.warning = r.overStrengthCount > 0;
    this.shortSummary = `${this.forceN.toFixed(1)} N, peak ${(r.peakRatio * 100).toFixed(0)}%`;
    const failure = Number.isNaN(r.firstFailureForceN) ? 'self-weight alone exceeds a member capacity'
      : Number.isFinite(r.firstFailureForceN) ? `first member reaches capacity at about ${r.firstFailureForceN.toFixed(2)} N ` +
        `(${(r.firstFailureForceN / 9.80665).toFixed(3)} kg)` : 'no member reaches capacity under added center load';
    this.summary = `${r.overStrengthCount} strand(s) over capacity` + (buckling ? ` (${buckling} by buckling)` : '') +
      `; peak utilization ${(r.peakRatio * 100).toFixed(1)}%; center deflection ${(-1000 * r.centerDeflectionM).toFixed(2)} mm; ` +
      `pasta mass ${(r.massKg * 1000).toFixed(1)} g, ${r.totalStrandCount} strands, ${r.totalStrandLengthM.toFixed(2)} m of strand; ${failure}` +
      (Number.isFinite(r.efficiencyNPerG) ? `; efficiency ${r.efficiencyNPerG.toFixed(3)} N/g.` : '.');
  }
}
