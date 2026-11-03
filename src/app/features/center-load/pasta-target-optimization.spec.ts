/* SPDX-License-Identifier: GPL-3.0-or-later */
import { analyzePasta, DEFAULT_PASTA_PROPERTIES, PastaInput, PastaResult } from './pasta-analysis';
import { optimizePastaTarget, TargetOptions } from './pasta-target-optimization';

/** Independent equilibrium/extension reference for this symmetric five-member
 * determinate truss only. Not physical calibration or a general truss solver. */
function reference(model: PastaInput): PastaResult {
  const h = model.joints[3].y, l = Math.hypot(0.5, h), p = model.properties;
  const n = Array.from(model.strandCounts ?? [1, 1, 1, 1, 1]), lengths = [0.5, 0.5, l, h, l];
  const a = Math.PI * p.diameterM ** 2 / 4, inertia = Math.PI * p.diameterM ** 4 / 64;
  const masses = lengths.map(v => v * a * p.densityKgM3), w = masses.map((v, i) => v * n[i] * 9.80665);
  const centerDead = (w[0] + w[1] + w[3]) / 2, topDead = (w[2] + w[4] + w[3]) / 2;
  const equilibrium = (center: number, top: number) => {
    const q = center + top; return [q / (4 * h), q / (4 * h), -q * l / (2 * h), center, -q * l / (2 * h)];
  };
  const dead = equilibrium(centerDead, topDead), unit = equilibrium(1, 0);
  const forces = dead.map((v, i) => v + model.forceN * unit[i]);
  const tension = n.map(v => v * p.tensileStrengthPa * a);
  const compression = lengths.map((v, i) => n[i] * Math.min(p.compressiveStrengthPa * a, Math.PI ** 2 * p.elasticModulusPa * inertia / v ** 2));
  const ratios = forces.map((v, i) => v / (v >= 0 ? tension[i] : compression[i]));
  const failures = unit.map((v, i) => {
    if (dead[i] > tension[i] || -dead[i] > compression[i]) return -Infinity;
    return v > 0 ? (tension[i] - dead[i]) / v : v < 0 ? (-compression[i] - dead[i]) / v : Infinity;
  });
  const massKg = masses.reduce((v, m, i) => v + m * n[i], 0), ea = p.elasticModulusPa * a;
  const ux = forces[0] * 0.5 / (ea * n[0]);
  const uyTop = (forces[2] * l / (ea * n[2]) - ux * 0.5 / l) * l / h;
  const uyCenter = uyTop - forces[3] * h / (ea * n[3]);
  const first = failures.some(v => v < 0) ? NaN : Math.min(...failures);
  return { forceN: model.forceN, scale: 1, massKg, memberLengthsM: Float64Array.from(lengths),
    strandMassKg: Float64Array.from(masses), firstFailureForceN: first,
    memberFailureForceN: Float64Array.from(failures), peakRatio: Math.max(...ratios.map(Math.abs)),
    displacements: Float64Array.from([0, 0, ux, uyCenter, 2 * ux, 0, ux, uyTop]),
    memberForces: Float64Array.from(forces), signedRatios: Float64Array.from(ratios),
    tensileCapacityN: Float64Array.from(tension), compressiveCapacityN: Float64Array.from(compression),
    strandCounts: Int32Array.from(n), totalStrandCount: n.reduce((v, c) => v + c, 0),
    selfWeightN: massKg * 9.80665, centerDeflectionM: uyCenter,
    totalStrandLengthM: lengths.reduce((v, length, i) => v + length * n[i], 0), efficiencyNPerG: first / (massKg * 1000),
    overStrengthCount: ratios.filter(v => Math.abs(v) > 1).length,
    bucklingGoverns: Uint8Array.from(lengths.map(v => Math.PI ** 2 * p.elasticModulusPa * inertia / v ** 2 < p.compressiveStrengthPa * a ? 1 : 0)) };
}

describe('Symmetric cyclic required hanging-mass optimization', () => {
  const input = (): PastaInput => ({
    joints: [{ x: 0, y: 0 }, { x: 0.5, y: 0 }, { x: 1, y: 0 }, { x: 0.5, y: 0.2 }],
    members: [{ a: 0, b: 1 }, { a: 1, b: 2 }, { a: 0, b: 3 }, { a: 1, b: 3 }, { a: 2, b: 3 }],
    supports: { loadedJointCount: 3, isPier: false, isHiPier: false, pierJointIndex: -1,
      isArch: false, archJointIndex: -1, isLeftAnchorage: false, leftAnchorageJointIndex: -1,
      isRightAnchorage: false, rightAnchorageJointIndex: -1 },
    properties: { ...DEFAULT_PASTA_PROPERTIES }, forceN: 0,
  });
  const options = (): TargetOptions => ({ targetMassG: 10, maxStrandsPerMember: 30, maxStrandLengthM: 1,
    gridStepWorld: 0.05, cycles: 6, bounds: { xMin: 0, xMax: 1, yMin: 0, yMax: 0.8 }, maxEvaluations: 3000 });
  it('cycles geometry with reinforced mass, preserves symmetry and does not mutate input', async () => {
    const source = input(), before = JSON.stringify(source), r = await optimizePastaTarget(source, options(), reference);
    expect(r.targetForceN).toBeCloseTo(0.0980665, 10); expect(r.metTarget).toBeTrue();
    expect(r.cyclesCompleted).toBeGreaterThan(1); expect(r.geometryEvaluations).toBeGreaterThan(0);
    expect(r.joints.slice(0, 3)).toEqual(source.joints.slice(0, 3)); expect(r.joints[3].x).toBe(0.5);
    expect(r.strandCounts[0]).toBe(r.strandCounts[1]); expect(r.strandCounts[2]).toBe(r.strandCounts[4]);
    expect(JSON.stringify(source)).toBe(before);
    const checked = reference({ ...source, joints: r.joints, strandCounts: r.strandCounts, forceN: r.targetForceN });
    expect(checked.massKg).toBeCloseTo(r.result.massKg, 12); expect(checked.peakRatio).toBeLessThanOrEqual(1 + 1e-8);
    r.joints.forEach(p => expect(p.y / 0.05).toBeCloseTo(Math.round(p.y / 0.05), 8));
  });
  it('uses maximum mirrored seed counts, prunes, and counts self-mirrored members once', async () => {
    const source = input(); source.strandCounts = [2, 1, 12, 2, 10];
    const r = await optimizePastaTarget(source, { ...options(), geometryFirst: false }, reference);
    expect(r.metTarget).toBeTrue(); expect(r.strandCounts[0]).toBe(r.strandCounts[1]); expect(r.strandCounts[2]).toBe(r.strandCounts[4]);
    expect(r.result.totalStrandCount).toBe(Array.from(r.strandCounts).reduce((a, b) => a + b, 0));
    expect(r.result.massKg).toBeLessThan(reference({ ...source, strandCounts: [2, 2, 12, 2, 12] }).massKg);
  });
  it('retains a feasible incumbent when later trials exhaust the budget', async () => {
    const source = input(); source.strandCounts = [2, 2, 12, 2, 12];
    const r = await optimizePastaTarget(source, { ...options(), maxEvaluations: 16 }, reference);
    expect(r.metTarget).toBeTrue(); expect(r.limited).toBeTrue(); expect(r.evaluations).toBe(16);
    expect(reference({ ...source, joints: r.joints, strandCounts: r.strandCounts, forceN: r.targetForceN }).peakRatio).toBeLessThanOrEqual(1 + 1e-8);
  });
  it('rejects asymmetric geometry and connectivity without adding anything', async () => {
    const source = input(); source.joints = source.joints.map((p, i) => i === 3 ? { ...p, x: 0.55 } : p);
    await expectAsync(optimizePastaTarget(source, options(), reference)).toBeRejectedWithError(/mirror-symmetric/);
    const missing = input(); missing.members = missing.members.slice(0, 4);
    await expectAsync(optimizePastaTarget(missing, options(), reference)).toBeRejectedWithError(/mirror-symmetric/);
  });
  it('honors fixed joints, strands-only mode and the cycle limit', async () => {
    for (const control of [{ lockedJoints: [3] }, { geometryFirst: false }]) {
      const source = input(), r = await optimizePastaTarget(source, { ...options(), ...control }, reference);
      expect(r.joints).toEqual(source.joints); expect(r.metTarget).toBeTrue();
    }
    const r = await optimizePastaTarget(input(), { ...options(), cycles: 1 }, reference);
    expect(r.cyclesCompleted).toBe(1);
  });
  it('reports unmet targets and stock violations without assuming splices', async () => {
    const capped = await optimizePastaTarget(input(), { ...options(), maxStrandsPerMember: 1 }, reference);
    expect(capped.metTarget).toBeFalse(); expect(capped.reason).toBe('target-not-found');
    const long = await optimizePastaTarget(input(), { ...options(), maxStrandLengthM: 0.25, geometryFirst: false }, reference);
    expect(long.metTarget).toBeFalse(); expect(long.reason).toBe('over-length');
    const heavy = await optimizePastaTarget(input(), { ...options(), targetMassG: 100 }, reference);
    expect(heavy.metTarget).toBeFalse();
  });
  it('honors budgets and both pre-start and progress cancellation', async () => {
    const r = await optimizePastaTarget(input(), { ...options(), targetMassG: 100000, maxEvaluations: 16 }, reference);
    expect(r.limited).toBeTrue(); expect(r.metTarget).toBeFalse(); expect(r.reason).toBe('evaluation-limit');
    const controller = new AbortController();
    await expectAsync(optimizePastaTarget(input(), { ...options(), signal: controller.signal,
      onProgress: () => controller.abort() }, reference)).toBeRejectedWithError(/cancelled/);
    const pre = new AbortController(); pre.abort();
    await expectAsync(optimizePastaTarget(input(), { ...options(), signal: pre.signal }, reference)).toBeRejectedWithError(/cancelled/);
  });
  it('rejects invalid controls, coincident joints and unsplit-joint geometry', async () => {
    for (const invalid of [{ cycles: 0 }, { targetMassG: 0 }, { gridStepWorld: 0 }]) {
      await expectAsync(optimizePastaTarget(input(), { ...options(), ...invalid }, reference)).toBeRejected();
    }
    const coincident = input(); coincident.joints = [...coincident.joints, { ...coincident.joints[3] }];
    await expectAsync(optimizePastaTarget(coincident, options(), reference)).toBeRejected();
    const unsplit = input(); unsplit.members = [...unsplit.members, { a: 0, b: 2 }];
    await expectAsync(optimizePastaTarget(unsplit, options(), reference)).toBeRejectedWithError(/unsplit/);
  });
  it('matches exhaustive enumeration for one small height/count family', async () => {
    const source = input(), o = { ...options(), maxStrandsPerMember: 6, gridStepWorld: 0.1, maxEvaluations: 6000 };
    let best = Infinity;
    for (let k = 1; k <= 8; k++) for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) for (let c = 1; c <= 6; c++) {
      const joints = source.joints.map((p, i) => i === 3 ? { x: 0.5, y: k / 10 } : p);
      const r = reference({ ...source, joints, strandCounts: [a, a, b, c, b], forceN: 10 * 9.80665 / 1000 });
      if (r.peakRatio <= 1 + 1e-8 && r.firstFailureForceN >= r.forceN * (1 - 1e-8)) best = Math.min(best, r.massKg);
    }
    const r = await optimizePastaTarget(source, o, reference);
    expect(Number.isFinite(best)).toBeTrue(); expect(r.metTarget).toBeTrue(); expect(r.result.massKg).toBeCloseTo(best, 10);
  });
  it('moves mirrored off-center joint pairs together and locks the partner of a fixed joint', async () => {
    const source = input();
    source.joints = [...source.joints.slice(0, 3), { x: 0.25, y: 0.2 }, { x: 0.5, y: 0.3 }, { x: 0.75, y: 0.2 }];
    source.members = [{ a: 0, b: 1 }, { a: 1, b: 2 }, { a: 0, b: 3 }, { a: 1, b: 3 },
      { a: 3, b: 4 }, { a: 1, b: 4 }, { a: 4, b: 5 }, { a: 1, b: 5 }, { a: 2, b: 5 }];
    const before = JSON.stringify(source);
    let pairedMoves = 0, symmetric = true;
    const checkedAnalyzer: typeof analyzePasta = model => {
      symmetric = symmetric && Math.abs(model.joints[3].x + model.joints[5].x - 1) < 1e-10 &&
        Math.abs(model.joints[3].y - model.joints[5].y) < 1e-10 && model.joints[4].x === 0.5;
      for (const [a, b] of [[0, 1], [2, 8], [3, 7], [4, 6]]) symmetric = symmetric && model.strandCounts![a] === model.strandCounts![b];
      if (Math.abs(model.joints[3].x - 0.25) + Math.abs(model.joints[3].y - 0.2) > 1e-8) pairedMoves++;
      return analyzePasta(model);
    };
    const r = await optimizePastaTarget(source, { ...options(), targetMassG: 1 }, checkedAnalyzer);
    expect(r.metTarget).toBeTrue(); expect(symmetric).toBeTrue(); expect(pairedMoves).toBeGreaterThan(0); expect(JSON.stringify(source)).toBe(before);
    const locked = await optimizePastaTarget(source, { ...options(), targetMassG: 1, lockedJoints: [3] });
    expect(locked.joints[3]).toEqual(source.joints[3]); expect(locked.joints[5]).toEqual(source.joints[5]);
  });
  it('checks actual app forces and displacements against the independent reference', async () => {
    const source = input(); source.strandCounts = [2, 2, 12, 2, 12]; source.forceN = 0.0980665;
    const actual = analyzePasta(source), expected = reference(source);
    for (const field of ['memberForces', 'displacements', 'tensileCapacityN', 'compressiveCapacityN', 'memberFailureForceN'] as const) {
      actual[field].forEach((v, i) => expect(v).toBeCloseTo(expected[field][i], 9));
    }
    expect(actual.massKg).toBeCloseTo(expected.massKg, 12); expect(actual.peakRatio).toBeCloseTo(expected.peakRatio, 10);
    const r = await optimizePastaTarget(input(), options());
    expect(r.metTarget).toBeTrue();
    const checked = analyzePasta({ ...input(), joints: r.joints, strandCounts: r.strandCounts, forceN: r.targetForceN });
    expect(checked.peakRatio).toBeLessThanOrEqual(1 + 1e-8);
  });
});
