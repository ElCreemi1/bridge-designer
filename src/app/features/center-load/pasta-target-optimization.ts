/* SPDX-License-Identifier: GPL-3.0-or-later */
import { analyzePasta, PastaInput, PastaResult } from './pasta-analysis';

export type TargetOptions = {
  targetMassG: number;
  maxStrandsPerMember: number;
  maxStrandLengthM: number;
  gridStepWorld: number;
  bounds: { xMin: number; xMax: number; yMin: number; yMax: number };
  geometryFirst?: boolean;
  lockedJoints?: readonly number[];
  maxEvaluations?: number;
  geometryPasses?: number;
  signal?: AbortSignal;
  onProgress?: (phase: string, evaluations: number) => void;
};

/** Bounded local search, not a guarantee of a globally minimum-mass bridge.
 * Geometry first uses ONE loose strand per member; reinforcement then meets the
 * required center load and pruning removes unnecessary strands. Input is immutable.
 * The optional analyzer is a verification seam; normal callers use analyzePasta.
 */
export async function optimizePastaTarget(input: PastaInput, options: TargetOptions,
  analyzer: typeof analyzePasta = analyzePasta) {
  const { targetMassG, maxStrandsPerMember, maxStrandLengthM, gridStepWorld, bounds } = options;
  const limit = options.maxEvaluations ?? 3000, passes = options.geometryPasses ?? 2;
  if (!Number.isFinite(targetMassG) || targetMassG <= 0 || targetMassG > 1000000) throw new Error('Target hanging mass must be from above 0 to 1,000,000 g.');
  if (!Number.isInteger(maxStrandsPerMember) || maxStrandsPerMember < 1 || maxStrandsPerMember > 10000) throw new Error('Choose 1–10000 strands per member.');
  if (![maxStrandLengthM, gridStepWorld].every(v => Number.isFinite(v) && v > 0) ||
      !Object.values(bounds).every(Number.isFinite) || bounds.xMax <= bounds.xMin || bounds.yMax <= bounds.yMin ||
      !Number.isInteger(limit) || limit < 16 || limit > 20000 || !Number.isInteger(passes) || passes < 1 || passes > 8) throw new Error('Invalid search limits, grid or bounds.');
  const original = input.joints.map(p => ({ x: p.x, y: p.y }));
  const members = input.members.map(m => ({ a: m.a, b: m.b })), s = input.supports;
  const supports = { loadedJointCount: s.loadedJointCount, isPier: s.isPier, isHiPier: s.isHiPier,
    pierJointIndex: s.pierJointIndex, isArch: s.isArch, archJointIndex: s.archJointIndex,
    isLeftAnchorage: s.isLeftAnchorage, leftAnchorageJointIndex: s.leftAnchorageJointIndex,
    isRightAnchorage: s.isRightAnchorage, rightAnchorageJointIndex: s.rightAnchorageJointIndex };
  const deck = supports.loadedJointCount;
  if (!Number.isInteger(deck) || deck < 3 || deck > original.length || !members.length) throw new Error('Invalid bridge connectivity.');
  const worldSpan = original[deck - 1].x - original[0].x, scale = 1 / worldSpan;
  if (!Number.isFinite(scale) || scale <= 0) throw new Error('Invalid support span.');
  const targetForceN = targetMassG * 9.80665 / 1000;
  const locked = new Set<number>(Array.from({ length: deck }, (_, i) => i));
  const extra = [...(options.lockedJoints ?? [])];
  if (s.isPier) extra.push(s.pierJointIndex);
  if (s.isArch) extra.push(s.archJointIndex, s.archJointIndex + 1);
  if (s.isLeftAnchorage) extra.push(s.leftAnchorageJointIndex);
  if (s.isRightAnchorage) extra.push(s.rightAnchorageJointIndex);
  for (const i of extra) {
    if (!Number.isInteger(i) || i < 0 || i >= original.length) throw new Error('Invalid locked joint.');
    locked.add(i);
  }
  const epsilon = Math.max(1e-10, gridStepWorld * 1e-7);
  const allowed = (points: typeof original): boolean => {
    if (points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y) || p.x < bounds.xMin || p.x > bounds.xMax || p.y < bounds.yMin || p.y > bounds.yMax)) return false;
    for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) {
      if (Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y) < epsilon) return false;
    }
    for (const m of members) {
      if (![m.a, m.b].every(i => Number.isInteger(i) && i >= 0 && i < points.length) || m.a === m.b) return false;
      const a = points[m.a], b = points[m.b], dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
      if (length * scale < 0.001) return false;
      // A joint on a member would imply a new connection/split: reject it.
      for (let i = 0; i < points.length; i++) if (i !== m.a && i !== m.b) {
        const px = points[i].x - a.x, py = points[i].y - a.y;
        const t = (px * dx + py * dy) / (length * length);
        if (t > 1e-8 && t < 1 - 1e-8 && Math.abs(px * dy - py * dx) / length < epsilon) return false;
      }
    }
    return true;
  };
  if (!allowed(original)) throw new Error('Correct out-of-bounds, overlapping, zero-length or unsplit-joint geometry before optimizing.');
  const properties = { ...input.properties };
  let evaluations = 0, geometryEvaluations = 0, phase = 'geometry', limited = false;
  const checkCancel = () => { if (options.signal?.aborted) throw new Error('Optimization cancelled.'); };
  const evaluate = async (points: typeof original, counts: Int32Array, required = false): Promise<PastaResult | undefined> => {
    checkCancel();
    if (evaluations >= limit) { limited = true; return undefined; }
    if (evaluations > 0 && evaluations % 8 === 0) {
      options.onProgress?.(phase, evaluations);
      await new Promise<void>(resolve => setTimeout(resolve, 0)); checkCancel();
    }
    evaluations++;
    try {
      const r = analyzer({ joints: points, members, supports, properties, forceN: targetForceN, strandCounts: counts });
      if (!Number.isFinite(r.massKg) || r.massKg <= 0 || !Number.isFinite(r.peakRatio) ||
          !r.displacements.every(Number.isFinite) || !r.memberForces.every(Number.isFinite)) throw new Error('Non-finite structural response.');
      return r;
    } catch (error) { if (required) throw error; return undefined; }
  };
  const overLength = (r: PastaResult) => r.memberLengthsM.reduce((sum, length) => sum + Math.max(0, length / maxStrandLengthM - 1), 0);
  const capacity = (r: PastaResult) => Number.isNaN(r.firstFailureForceN) ? 0 : Math.max(0, r.firstFailureForceN);
  const feasible = (r: PastaResult) => overLength(r) <= 1e-9 && capacity(r) >= targetForceN * (1 - 1e-8) && r.peakRatio <= 1 + 1e-8;
  const betterGeometry = (a: PastaResult, b: PastaResult) => {
    const ao = overLength(a), bo = overLength(b); if (Math.abs(ao - bo) > 1e-9) return ao < bo;
    const ac = Math.min(targetForceN, capacity(a)), bc = Math.min(targetForceN, capacity(b));
    if (Math.abs(ac - bc) > targetForceN * 1e-9) return ac > bc;
    return a.massKg < b.massKg * (1 - 1e-10);
  };
  let joints = original.map(p => ({ ...p })), counts: Int32Array = new Int32Array(members.length).fill(1);
  let result = (await evaluate(joints, counts, true))!;
  let incumbent: { joints: typeof original; counts: Int32Array; result: PastaResult } | undefined;
  if (input.strandCounts && input.strandCounts.length === members.length) {
    const existing = Array.from(input.strandCounts);
    if (existing.every(n => Number.isInteger(n) && n >= 1 && n <= maxStrandsPerMember)) {
      const saved = await evaluate(original, Int32Array.from(existing));
      if (saved && feasible(saved)) incumbent = { joints: original, counts: Int32Array.from(existing), result: saved };
    }
  }
  const directions = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
  if (options.geometryFirst !== false) {
    const geometryLimit = Math.floor(limit * 0.6);
    for (const multiple of [4, 2, 1]) for (let pass = 0; pass < passes && evaluations < geometryLimit; pass++) {
      let improved = false;
      for (let i = deck; i < joints.length && evaluations < geometryLimit; i++) if (!locked.has(i)) {
        for (const [dx, dy] of directions) {
          if (evaluations >= geometryLimit) break;
          const trial = joints.map(p => ({ ...p }));
          trial[i] = { x: Math.round((joints[i].x + dx * gridStepWorld * multiple) / gridStepWorld) * gridStepWorld,
            y: Math.round((joints[i].y + dy * gridStepWorld * multiple) / gridStepWorld) * gridStepWorld };
          if (!allowed(trial)) continue;
          const candidate = await evaluate(trial, counts); geometryEvaluations++;
          if (candidate && betterGeometry(candidate, result)) { joints = trial; result = candidate; improved = true; }
        }
      }
      if (!improved) break;
    }
  }
  phase = 'reinforcement'; options.onProgress?.(phase, evaluations);
  if (overLength(result) <= 1e-9) {
    while (!feasible(result) && evaluations < limit) {
      let governing = 0;
      for (let i = 1; i < members.length; i++) if (result.memberFailureForceN[i] < result.memberFailureForceN[governing]) governing = i;
      if (counts[governing] >= maxStrandsPerMember) break;
      counts[governing]++;
      const candidate = await evaluate(joints, counts);
      if (!candidate) { counts[governing]--; break; }
      result = candidate;
    }
  }
  phase = 'pruning'; options.onProgress?.(phase, evaluations);
  if (feasible(result)) {
    let changed = true;
    while (changed && evaluations < limit) {
      changed = false;
      const order = Array.from(counts.keys()).sort((a, b) => result.strandMassKg[b] - result.strandMassKg[a]);
      for (const i of order) if (counts[i] > 1 && evaluations < limit) {
        counts[i]--; const candidate = await evaluate(joints, counts);
        if (candidate && feasible(candidate)) { result = candidate; changed = true; } else counts[i]++;
      }
    }
    if (!incumbent || result.massKg < incumbent.result.massKg) incumbent = { joints, counts: counts.slice(), result };
  }
  if (incumbent) { joints = incumbent.joints; counts = incumbent.counts; result = incumbent.result; }
  checkCancel(); limited = limited || evaluations >= limit;
  const metTarget = feasible(result);
  return { joints: joints.map(p => ({ ...p })), strandCounts: counts.slice(), result,
    targetMassG, targetForceN, metTarget, evaluations, geometryEvaluations, limited,
    changedJointCount: joints.filter((p, i) => Math.hypot(p.x - original[i].x, p.y - original[i].y) > epsilon).length,
    reason: metTarget ? 'target-met' : limited ? 'evaluation-limit' : overLength(result) > 1e-9 ? 'over-length' : 'target-not-found' };
}
