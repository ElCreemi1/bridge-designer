/* SPDX-License-Identifier: GPL-3.0-or-later */
import { analyzePasta, DEFAULT_PASTA_PROPERTIES, PastaInput, PastaResult } from './pasta-analysis';
import { optimizePastaTarget, TargetOptions } from './pasta-target-optimization';

describe('Pasta target search time ceiling', () => {
  let clock: number;
  beforeEach(() => { clock = 0; spyOn(performance, 'now').and.callFake(() => clock); });
  const input = (): PastaInput => ({
    joints: [{ x: 0, y: 0 }, { x: 0.5, y: 0 }, { x: 1, y: 0 }, { x: 0.5, y: 0.2 }],
    members: [{ a: 0, b: 1 }, { a: 1, b: 2 }, { a: 0, b: 3 }, { a: 1, b: 3 }, { a: 2, b: 3 }],
    supports: { loadedJointCount: 3, isPier: false, isHiPier: false, pierJointIndex: -1,
      isArch: false, archJointIndex: -1, isLeftAnchorage: false, leftAnchorageJointIndex: -1,
      isRightAnchorage: false, rightAnchorageJointIndex: -1 }, properties: { ...DEFAULT_PASTA_PROPERTIES }, forceN: 0,
  });
  const options = (): TargetOptions => ({ targetMassG: 10, maxStrandsPerMember: 30, maxStrandLengthM: 1,
    gridStepWorld: 0.05, bounds: { xMin: 0, xMax: 1, yMin: 0, yMax: 0.8 }, maxEvaluations: 100 });
  // Search-control double only; these values make no claim about pasta physics.
  const response = (model: PastaInput, met: boolean): PastaResult => ({
    massKg: 0.01, peakRatio: met ? 0.5 : 2, firstFailureForceN: met ? 1 : 0.01,
    memberLengthsM: Float64Array.from([0.5, 0.5, 0.54, 0.2, 0.54]),
    strandMassKg: new Float64Array(5).fill(0.001), signedRatios: new Float64Array(5).fill(met ? 0.5 : 2),
    displacements: new Float64Array(8), memberForces: new Float64Array(5), strandCounts: Int32Array.from(model.strandCounts!),
  } as PastaResult);
  it('defaults to 300000 ms and keeps a feasible result at expiry', async () => {
    let calls = 0;
    const analyzer: typeof analyzePasta = model => { calls++; clock = 300000; return response(model, true); };
    const r = await optimizePastaTarget(input(), options(), analyzer);
    expect(calls).toBe(1); expect(r.metTarget).toBeTrue(); expect(r.timeLimited).toBeTrue(); expect(r.limited).toBeTrue();
    expect(r.elapsedMs).toBe(300000); expect(r.reason).toBe('target-met');
  });
  it('returns time-limit without claiming a feasible design when time expires', async () => {
    const analyzer: typeof analyzePasta = model => { clock = 5; return response(model, false); };
    const r = await optimizePastaTarget(input(), { ...options(), maxDurationMs: 5 }, analyzer);
    expect(r.evaluations).toBe(1); expect(r.metTarget).toBeFalse(); expect(r.reason).toBe('time-limit');
  });
  it('rechecks the deadline after yielding, before another solve', async () => {
    let calls = 0;
    const analyzer: typeof analyzePasta = model => { calls++; return response(model, false); };
    const r = await optimizePastaTarget(input(), { ...options(), maxDurationMs: 5,
      onProgress: () => { clock = 5; } }, analyzer);
    expect(calls).toBe(8); expect(r.evaluations).toBe(8); expect(r.timeLimited).toBeTrue();
  });
  it('can finish before the ceiling and retains analysis-count limits', async () => {
    const analyzer: typeof analyzePasta = model => response(model, true);
    const r = await optimizePastaTarget(input(), { ...options(), geometryFirst: false }, analyzer);
    expect(r.timeLimited).toBeFalse(); expect(r.elapsedMs).toBe(0); expect(r.metTarget).toBeTrue();
    const unmet: typeof analyzePasta = model => response(model, false);
    const capped = await optimizePastaTarget(input(), { ...options(), maxEvaluations: 16 }, unmet);
    expect(capped.timeLimited).toBeFalse(); expect(capped.reason).toBe('evaluation-limit');
  });
  it('rejects invalid duration ceilings and still honors cancellation', async () => {
    for (const maxDurationMs of [0, -1, NaN, Infinity, 300001]) {
      await expectAsync(optimizePastaTarget(input(), { ...options(), maxDurationMs })).toBeRejectedWithError(/duration/);
    }
    const controller = new AbortController(); controller.abort();
    await expectAsync(optimizePastaTarget(input(), { ...options(), signal: controller.signal })).toBeRejectedWithError(/cancelled/);
  });
});
