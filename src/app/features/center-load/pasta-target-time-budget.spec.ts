/* SPDX-License-Identifier: GPL-3.0-or-later */
import { analyzePasta, DEFAULT_PASTA_PROPERTIES, PastaInput, PastaResult } from './pasta-analysis';
import { optimizePastaTarget, TargetOptions } from './pasta-target-optimization';

describe('Time-budgeted pasta target search', () => {
  let clock: number;
  beforeEach(() => { clock = 0; spyOn(performance, 'now').and.callFake(() => clock); });
  const input = (): PastaInput => ({
    joints: [{ x: 0, y: 0 }, { x: 0.5, y: 0 }, { x: 1, y: 0 }, { x: 0.5, y: 0.2 }],
    members: [{ a: 0, b: 1 }, { a: 1, b: 2 }, { a: 0, b: 3 }, { a: 1, b: 3 }, { a: 2, b: 3 }],
    supports: { loadedJointCount: 3, isPier: false, isHiPier: false, pierJointIndex: -1,
      isArch: false, archJointIndex: -1, isLeftAnchorage: false, leftAnchorageJointIndex: -1,
      isRightAnchorage: false, rightAnchorageJointIndex: -1 }, properties: { ...DEFAULT_PASTA_PROPERTIES }, forceN: 0,
  });
  const options = (): TargetOptions => ({ targetMassG: 2000, maxStrandsPerMember: 10000, maxStrandLengthM: 1,
    gridStepWorld: 0.05, geometryFirst: false, bounds: { xMin: 0, xMax: 1, yMin: 0, yMax: 0.8 } });
  // Search-control double, not a physical model.
  const response = (met: boolean, massKg = 0.01): PastaResult => ({
    massKg, peakRatio: met ? 0.5 : 2, firstFailureForceN: met ? 40 : 0.01,
    memberLengthsM: Float64Array.from([0.5, 0.5, 0.54, 0.2, 0.54]), strandMassKg: new Float64Array(5).fill(0.001),
    signedRatios: Float64Array.from([2, 2, 1, 1, 1]), displacements: new Float64Array(8), memberForces: new Float64Array(5),
  } as PastaResult);
  it('continues beyond 6000 analyses until the time deadline and converts the 2 kg target', async () => {
    let calls = 0;
    const analyzer: typeof analyzePasta = () => { calls++; if (calls === 6501) clock = 300000; return response(calls >= 6501); };
    const r = await optimizePastaTarget(input(), options(), analyzer);
    expect(calls).toBe(6501); expect(r.evaluations).toBe(6501); expect(r.timeLimited).toBeTrue();
    expect(r.metTarget).toBeTrue(); expect(r.targetForceN).toBeCloseTo(19.6133, 8);
  });
  it('does not impose a hidden six-cycle limit while candidates keep improving', async () => {
    let calls = 0;
    const analyzer: typeof analyzePasta = () => { calls++; if (calls === 30) clock = 300000; return response(true, 1 / calls); };
    const r = await optimizePastaTarget(input(), options(), analyzer);
    expect(r.cyclesCompleted).toBeGreaterThan(6); expect(r.timeLimited).toBeTrue(); expect(r.metTarget).toBeTrue();
  });
  it('can stop early after three cycles without improvement', async () => {
    const r = await optimizePastaTarget(input(), options(), () => response(true));
    expect(r.cyclesCompleted).toBe(3); expect(r.timeLimited).toBeFalse(); expect(r.limited).toBeFalse();
  });
  it('retains explicit finite budgets for callers and deterministic tests', async () => {
    const r = await optimizePastaTarget(input(), { ...options(), maxEvaluations: 16 }, () => response(false));
    expect(r.evaluations).toBe(16); expect(r.reason).toBe('evaluation-limit');
    const one = await optimizePastaTarget(input(), { ...options(), cycles: 1 }, () => response(true));
    expect(one.cyclesCompleted).toBe(1);
  });
  it('still rejects invalid finite limits and honors cancellation', async () => {
    for (const bad of [{ maxEvaluations: 0 }, { maxEvaluations: NaN }, { cycles: 0 }, { cycles: NaN }]) {
      await expectAsync(optimizePastaTarget(input(), { ...options(), ...bad })).toBeRejected();
    }
    const controller = new AbortController(); controller.abort();
    await expectAsync(optimizePastaTarget(input(), { ...options(), signal: controller.signal })).toBeRejectedWithError(/cancelled/);
  });
});
