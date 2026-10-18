/* Copyright (c) 2025-2026 Gene Ressler
   SPDX-License-Identifier: GPL-3.0-or-later */
import { centerLoadShares } from './center-load';

/** Editable strand properties in SI units. One solid circular strand per drawn member. */
export type PastaProperties = {
  elasticModulusPa: number;
  tensileStrengthPa: number;
  compressiveStrengthPa: number;
  densityKgM3: number;
  diameterM: number;
};

/** Starting values only. Pasta varies widely by brand and humidity; users should enter measured values. */
export const DEFAULT_PASTA_PROPERTIES: PastaProperties = {
  elasticModulusPa: 3.5e9,
  tensileStrengthPa: 15e6,
  compressiveStrengthPa: 20e6,
  densityKgM3: 1500,
  diameterM: 1.8e-3,
};

export const PASTA_SPAN_M = 1;
const GRAVITY = 9.80665;

/** Support layout, mirroring the restraint rules of the app's structural solver. */
export type PastaSupports = {
  loadedJointCount: number;
  isPier: boolean; isHiPier: boolean; pierJointIndex: number;
  isArch: boolean; archJointIndex: number;
  isLeftAnchorage: boolean; leftAnchorageJointIndex: number;
  isRightAnchorage: boolean; rightAnchorageJointIndex: number;
};

export type PastaInput = {
  joints: ReadonlyArray<{ x: number; y: number }>;
  members: ReadonlyArray<{ a: number; b: number }>;
  supports: PastaSupports;
  properties: PastaProperties;
  forceN: number;
};

export type PastaResult = {
  forceN: number;
  /** Factor from drawn world meters to the 1.00 m model. */
  scale: number;
  /** Displacements of the 1.00 m model, meters, interleaved x,y. */
  displacements: Float64Array;
  /** Axial forces in newtons, tension positive. */
  memberForces: Float64Array;
  tensileCapacityN: Float64Array;
  compressiveCapacityN: Float64Array;
  /** Force over the governing capacity, negative in compression. */
  signedRatios: Float64Array;
  bucklingGoverns: Uint8Array;
  overStrengthCount: number;
  peakRatio: number;
  centerDeflectionM: number;
  selfWeightN: number;
  totalStrandLengthM: number;
  /** Center force at which the first member reaches capacity in this linear model; NaN if self-weight alone fails; Infinity if never. */
  firstFailureForceN: number;
};

function validateProperties(p: PastaProperties): void {
  const entries: [string, number][] = [
    ['Elastic modulus', p.elasticModulusPa], ['Tensile strength', p.tensileStrengthPa],
    ['Compressive strength', p.compressiveStrengthPa], ['Density', p.densityKgM3], ['Diameter', p.diameterM],
  ];
  for (const [name, value] of entries) {
    if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number.`);
  }
}

/** Solves K u = f in place by Gaussian elimination with partial pivoting. Throws on a singular system. */
function solve(k: Float64Array[], rhs: Float64Array[]): void {
  const n = k.length;
  let maxDiagonal = 0;
  for (let i = 0; i < n; i++) maxDiagonal = Math.max(maxDiagonal, Math.abs(k[i][i]));
  const tiny = 1e-10 * (maxDiagonal || 1);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) if (Math.abs(k[row][col]) > Math.abs(k[pivot][col])) pivot = row;
    if (Math.abs(k[pivot][col]) <= tiny) {
      throw new Error('The bridge is unstable; add bracing or correct its connectivity before loading it.');
    }
    if (pivot !== col) {
      [k[pivot], k[col]] = [k[col], k[pivot]];
      for (const r of rhs) { const t = r[pivot]; r[pivot] = r[col]; r[col] = t; }
    }
    for (let row = col + 1; row < n; row++) {
      const factor = k[row][col] / k[col][col];
      if (factor === 0) continue;
      for (let j = col; j < n; j++) k[row][j] -= factor * k[col][j];
      for (const r of rhs) r[row] -= factor * r[col];
    }
  }
  for (const r of rhs) {
    for (let row = n - 1; row >= 0; row--) {
      let sum = r[row];
      for (let j = row + 1; j < n; j++) sum -= k[row][j] * r[j];
      r[row] = sum / k[row][row];
    }
  }
}

/** Independent linear-elastic analysis of the current drawing scaled to a 1.00 m pasta truss. */
export function analyzePasta(input: PastaInput): PastaResult {
  const { joints, members, supports, properties, forceN } = input;
  if (!Number.isFinite(forceN) || forceN < 0) throw new Error('Load must be a finite nonnegative force in newtons.');
  validateProperties(properties);
  const deckCount = supports.loadedJointCount;
  if (deckCount < 3 || deckCount > joints.length) throw new Error('Center loading requires at least three ordered deck joints.');
  const worldSpan = joints[deckCount - 1].x - joints[0].x;
  if (!Number.isFinite(worldSpan) || worldSpan <= 0) throw new Error('The deck has an invalid span.');
  const scale = PASTA_SPAN_M / worldSpan;
  const x = joints.map(j => (j.x - joints[0].x) * scale);
  const y = joints.map(j => (j.y - joints[0].y) * scale);
  const deckX = x.slice(0, deckCount);
  const unitShares = centerLoadShares(deckX, 1);

  const area = Math.PI * properties.diameterM ** 2 / 4;
  const inertia = Math.PI * properties.diameterM ** 4 / 64;
  const ea = properties.elasticModulusPa * area;
  const nJoints = joints.length, nDof = 2 * nJoints;

  // Restraints follow AnalysisService.
  const restrained = new Uint8Array(nDof);
  const fix = (joint: number, dof: 0 | 1, on = true) => { restrained[2 * joint + dof] = on ? 1 : 0; };
  fix(0, 0); fix(0, 1); fix(deckCount - 1, 1);
  if (supports.isPier) {
    fix(supports.pierJointIndex, 0); fix(supports.pierJointIndex, 1);
    if (supports.isHiPier) fix(0, 0, false);
  }
  if (supports.isArch) {
    const i = supports.archJointIndex;
    fix(0, 0, false); fix(i, 0); fix(i + 1, 0);
    fix(0, 1, false); fix(i, 1); fix(i + 1, 1); fix(deckCount - 1, 1, false);
  }
  if (supports.isLeftAnchorage) { fix(supports.leftAnchorageJointIndex, 0); fix(supports.leftAnchorageJointIndex, 1); }
  if (supports.isRightAnchorage) { fix(supports.rightAnchorageJointIndex, 0); fix(supports.rightAnchorageJointIndex, 1); }

  const free: number[] = [];
  const position = new Int32Array(nDof).fill(-1);
  for (let d = 0; d < nDof; d++) if (!restrained[d]) { position[d] = free.length; free.push(d); }
  const k = Array.from({ length: free.length }, () => new Float64Array(free.length));
  const deadLoad = new Float64Array(free.length), unitLoad = new Float64Array(free.length);

  const lengths = new Float64Array(members.length), cos = new Float64Array(members.length), sin = new Float64Array(members.length);
  let selfWeightN = 0, totalStrandLengthM = 0;
  members.forEach((m, i) => {
    const dx = x[m.b] - x[m.a], dy = y[m.b] - y[m.a], length = Math.hypot(dx, dy);
    if (!Number.isFinite(length) || length <= 0) throw new Error('A member has invalid length.');
    lengths[i] = length; cos[i] = dx / length; sin[i] = dy / length;
    totalStrandLengthM += length;
    const weight = properties.densityKgM3 * area * length * GRAVITY;
    selfWeightN += weight;
    for (const joint of [m.a, m.b]) {
      const p = position[2 * joint + 1];
      if (p >= 0) deadLoad[p] -= weight / 2;
    }
    const dofs = [2 * m.a, 2 * m.a + 1, 2 * m.b, 2 * m.b + 1];
    const t = [-cos[i], -sin[i], cos[i], sin[i]];
    const stiffness = ea / length;
    for (let r = 0; r < 4; r++) {
      const pr = position[dofs[r]]; if (pr < 0) continue;
      for (let c = 0; c < 4; c++) {
        const pc = position[dofs[c]]; if (pc >= 0) k[pr][pc] += stiffness * t[r] * t[c];
      }
    }
  });
  for (const share of unitShares) {
    const p = position[2 * share.jointIndex + 1];
    if (p >= 0) unitLoad[p] -= share.forceKN; // Dimensionless unit share; name inherited from the shared helper.
  }
  solve(k, [deadLoad, unitLoad]);

  const deadDisp = new Float64Array(nDof), unitDisp = new Float64Array(nDof);
  free.forEach((d, p) => { deadDisp[d] = deadLoad[p]; unitDisp[d] = unitLoad[p]; });
  const displacements = new Float64Array(nDof);
  for (let d = 0; d < nDof; d++) displacements[d] = deadDisp[d] + forceN * unitDisp[d];

  const axial = (u: Float64Array, i: number) => {
    const m = members[i];
    return (ea / lengths[i]) * (cos[i] * (u[2 * m.b] - u[2 * m.a]) + sin[i] * (u[2 * m.b + 1] - u[2 * m.a + 1]));
  };
  const n = members.length;
  const memberForces = new Float64Array(n), signedRatios = new Float64Array(n);
  const tensileCapacityN = new Float64Array(n), compressiveCapacityN = new Float64Array(n);
  const bucklingGoverns = new Uint8Array(n);
  let overStrengthCount = 0, peakRatio = 0, firstFailureForceN = Infinity;
  for (let i = 0; i < n; i++) {
    const dead = axial(deadDisp, i), unit = axial(unitDisp, i);
    const force = dead + forceN * unit;
    const euler = Math.PI ** 2 * properties.elasticModulusPa * inertia / lengths[i] ** 2;
    const crushing = properties.compressiveStrengthPa * area;
    tensileCapacityN[i] = properties.tensileStrengthPa * area;
    compressiveCapacityN[i] = Math.min(euler, crushing);
    bucklingGoverns[i] = euler < crushing ? 1 : 0;
    memberForces[i] = force;
    signedRatios[i] = force >= 0 ? force / tensileCapacityN[i] : force / compressiveCapacityN[i];
    const ratio = Math.abs(signedRatios[i]);
    peakRatio = Math.max(peakRatio, ratio);
    if (ratio > 1) overStrengthCount++;
    // Linear failure load for this member: dead + P*unit reaches +Ct or -Cc.
    const candidates: number[] = [];
    if (unit > 0) candidates.push((tensileCapacityN[i] - dead) / unit);
    if (unit < 0) candidates.push((-compressiveCapacityN[i] - dead) / unit);
    const deadRatio = dead >= 0 ? dead / tensileCapacityN[i] : -dead / compressiveCapacityN[i];
    if (deadRatio > 1) firstFailureForceN = NaN;
    else for (const c of candidates) if (c >= 0 && !Number.isNaN(firstFailureForceN)) firstFailureForceN = Math.min(firstFailureForceN, c);
  }
  const centerDeflectionM = unitShares.reduce((sum, s) => sum + s.forceKN * displacements[2 * s.jointIndex + 1], 0);
  return {
    forceN, scale, displacements, memberForces, tensileCapacityN, compressiveCapacityN, signedRatios, bucklingGoverns,
    overStrengthCount, peakRatio, centerDeflectionM, selfWeightN, totalStrandLengthM, firstFailureForceN,
  };
}
