/* SPDX-License-Identifier: GPL-3.0-or-later */
import { analyzePasta, DEFAULT_PASTA_PROPERTIES, PastaInput, PastaResult } from './pasta-analysis';
import { optimizePastaTarget, TargetOptions } from './pasta-target-optimization';

describe('Required hanging-mass optimization', () => {
  const input = (): PastaInput => ({
    joints: [{ x: 0, y: 0 }, { x: 0.5, y: 0 }, { x: 1, y: 0 }, { x: 0.5, y: 0.2 }],
    members: [{ a: 0, b: 1 }, { a: 1, b: 2 }, { a: 0, b: 3 }, { a: 1, b: 3 }, { a: 2, b: 3 }],
    supports: { loadedJointCount: 3, isPier: false, isHiPier: false, pierJointIndex: -1,
      isArch: false, archJointIndex: -1, isLeftAnchorage: false, leftAnchorageJointIndex: -1,
      isRightAnchorage: false, rightAnchorageJointIndex: -1 },
    properties: { ...DEFAULT_PASTA_PROPERTIES }, forceN: 0,
  });
  const options = (): TargetOptions => ({ targetMassG: 100, maxStrandsPerMember: 20,
    maxStrandLengthM: 1, gridStepWorld: 0.05,
    bounds: { xMin: 0, xMax: 1, yMin: 0, yMax: 0.8 }, maxEvaluations: 400 });
  // A deterministic test double isolates search logic; it is NOT a pasta physics model.
  const analytic: typeof analyzePasta = model => {
    const lengths = model.members.map(m => Math.hypot(model.joints[m.b].x - model.joints[m.a].x,
      model.joints[m.b].y - model.joints[m.a].y));
    const counts = Array.from(model.strandCounts!);
    const capacities = lengths.map((length, i) => counts[i] * 0.1 / length ** 2);
    const failure = Math.min(...capacities);
    return { massKg: lengths.reduce((sum, length, i) => sum + length * counts[i] * 0.001, 0),
      memberLengthsM: Float64Array.from(lengths), strandMassKg: Float64Array.from(lengths.map(length => length * 0.001)),
      firstFailureForceN: failure, memberFailureForceN: Float64Array.from(capacities), peakRatio: model.forceN / failure,
      displacements: new Float64Array(model.joints.length * 2), memberForces: new Float64Array(model.members.length),
      signedRatios: Float64Array.from(capacities.map(capacity => model.forceN / capacity)) } as PastaResult;
  };
  it('converts required hanging grams to center force, not a pasta mass budget', async () => {
    const r = await optimizePastaTarget(input(), { ...options(), geometryFirst: false }, analytic);
    expect(r.targetForceN).toBeCloseTo(0.980665, 10); expect(r.metTarget).toBeTrue();
    expect(r.result.firstFailureForceN).toBeGreaterThanOrEqual(r.targetForceN * (1 - 1e-8));
    expect(Math.max(...r.strandCounts)).toBeLessThan(20);
  });
  it('searches geometry with one strand before reinforcement and keeps deck joints fixed', async () => {
    const phases: string[] = [], source = input(), before = JSON.stringify(source);
    const r = await optimizePastaTarget(source, { ...options(), onProgress: phase => { phases.push(phase); } }, analytic);
    expect(r.geometryEvaluations).toBeGreaterThan(0); expect(r.changedJointCount).toBeGreaterThan(0);
    expect(r.joints.slice(0, 3)).toEqual(source.joints.slice(0, 3)); expect(r.metTarget).toBeTrue();
    expect(phases.indexOf('reinforcement')).toBeLessThan(phases.indexOf('pruning'));
    expect(JSON.stringify(source)).toBe(before);
    r.joints.forEach(p => { expect(p.x / 0.05).toBeCloseTo(Math.round(p.x / 0.05), 8);
      expect(p.y / 0.05).toBeCloseTo(Math.round(p.y / 0.05), 8); });
  });
  it('honors additional locked joints', async () => {
    const source = input(), r = await optimizePastaTarget(source, { ...options(), lockedJoints: [3] }, analytic);
    expect(r.joints).toEqual(source.joints); expect(r.changedJointCount).toBe(0);
  });
  it('does not claim success when the strand cap cannot meet the target', async () => {
    const r = await optimizePastaTarget(input(), { ...options(), maxStrandsPerMember: 1 }, analytic);
    expect(r.metTarget).toBeFalse(); expect(r.reason).toBe('target-not-found');
  });
  it('does not call a search-limit result an infeasibility proof', async () => {
    const r = await optimizePastaTarget(input(), { ...options(), targetMassG: 100000,
      maxStrandsPerMember: 10000, geometryFirst: false, maxEvaluations: 16 }, analytic);
    expect(r.metTarget).toBeFalse(); expect(r.limited).toBeTrue(); expect(r.reason).toBe('evaluation-limit');
  });
  it('rejects an over-length construction instead of assuming splices', async () => {
    const r = await optimizePastaTarget(input(), { ...options(), maxStrandLengthM: 0.25, geometryFirst: false }, analytic);
    expect(r.metTarget).toBeFalse(); expect(r.reason).toBe('over-length');
  });
  it('supports cancellation without editing the source', async () => {
    const source = input(), before = JSON.stringify(source), controller = new AbortController(); controller.abort();
    await expectAsync(optimizePastaTarget(source, { ...options(), signal: controller.signal }, analytic)).toBeRejectedWithError(/cancelled/);
    expect(JSON.stringify(source)).toBe(before);
  });
  it('rejects invalid targets and geometry controls', async () => {
    await expectAsync(optimizePastaTarget(input(), { ...options(), targetMassG: 0 }, analytic)).toBeRejected();
    await expectAsync(optimizePastaTarget(input(), { ...options(), gridStepWorld: 0 }, analytic)).toBeRejected();
  });
  it('rechecks an achieved target using the actual pasta solver', async () => {
    const source = input(), r = await optimizePastaTarget(source, { ...options(), targetMassG: 10, geometryFirst: false });
    const actual = analyzePasta({ ...source, joints: r.joints, strandCounts: r.strandCounts, forceN: r.targetForceN });
    expect(r.metTarget).toBeTrue(); expect(actual.peakRatio).toBeLessThanOrEqual(1 + 1e-8);
    expect(actual.massKg).toBeCloseTo(r.result.massKg, 10);
  });
});
