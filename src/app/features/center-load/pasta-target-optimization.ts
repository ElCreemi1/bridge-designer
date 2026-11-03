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
  cycles?: number;
  signal?: AbortSignal;
  onProgress?: (phase: string, evaluations: number) => void;
};

/** Symmetric cyclic local search, not a global optimum or a physics upgrade.
 * Compare geometry only after reinforcement/pruning at the required hanging load.
 * Connectivity, deck/loading joints and specified fixed joints remain unchanged.
 */
export async function optimizePastaTarget(input: PastaInput, options: TargetOptions,
  analyzer: typeof analyzePasta = analyzePasta) {
  const { targetMassG, maxStrandsPerMember: cap, maxStrandLengthM: stock, gridStepWorld: step, bounds } = options;
  const limit = options.maxEvaluations ?? 3000, passes = options.geometryPasses ?? 2, cycles = options.cycles ?? 6;
  if (!Number.isFinite(targetMassG) || targetMassG <= 0 || targetMassG > 1000000) throw new Error('Target hanging mass must be from above 0 to 1,000,000 g.');
  if (!Number.isInteger(cap) || cap < 1 || cap > 10000) throw new Error('Choose 1–10000 strands per member.');
  if (![stock, step].every(v => Number.isFinite(v) && v > 0) || !Object.values(bounds).every(Number.isFinite) ||
      bounds.xMax <= bounds.xMin || bounds.yMax <= bounds.yMin || !Number.isInteger(limit) || limit < 16 || limit > 20000 ||
      !Number.isInteger(passes) || passes < 1 || passes > 8 || !Number.isInteger(cycles) || cycles < 1 || cycles > 100) throw new Error('Invalid search limits, grid or bounds.');
  const original = input.joints.map(p => ({ x: p.x, y: p.y }));
  const members = input.members.map(m => ({ a: m.a, b: m.b }));
  const supports = { ...input.supports }, properties = { ...input.properties }, deck = supports.loadedJointCount;
  if (!Number.isInteger(deck) || deck < 3 || deck > original.length || !members.length) throw new Error('Invalid bridge connectivity.');
  const span = original[deck - 1].x - original[0].x, scale = 1 / span;
  if (!Number.isFinite(scale) || scale <= 0) throw new Error('Invalid support span.');
  const mid = (original[0].x + original[deck - 1].x) / 2, epsilon = Math.max(1e-10, step * 1e-7);
  const allowed = (points: typeof original, enforceStock = false) => {
    if (points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y) || p.x < bounds.xMin || p.x > bounds.xMax || p.y < bounds.yMin || p.y > bounds.yMax)) return false;
    for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) {
      if (Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y) < epsilon) return false;
    }
    for (const m of members) {
      if (![m.a, m.b].every(i => Number.isInteger(i) && i >= 0 && i < points.length) || m.a === m.b) return false;
      const a = points[m.a], b = points[m.b], dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
      if (length * scale < 0.001 || (enforceStock && length * scale > stock * (1 + 1e-9))) return false;
      for (let i = 0; i < points.length; i++) if (i !== m.a && i !== m.b) {
        const px = points[i].x - a.x, py = points[i].y - a.y, t = (px * dx + py * dy) / (length * length);
        if (t > 1e-8 && t < 1 - 1e-8 && Math.abs(px * dy - py * dx) / length < epsilon) return false;
      }
    }
    return true;
  };
  if (!allowed(original)) throw new Error('Correct out-of-bounds, overlapping, zero-length or unsplit-joint geometry before optimizing.');
  const mirror = original.map(p => original.findIndex(q => Math.abs(q.x - (2 * mid - p.x)) < epsilon && Math.abs(q.y - p.y) < epsilon));
  if (mirror.some((j, i) => j < 0 || mirror[j] !== i || (i < deck) !== (j < deck))) throw new Error('Optimization requires mirror-symmetric starting joints and deck layout.');
  const key = (a: number, b: number) => a < b ? `${a}:${b}` : `${b}:${a}`;
  const map = new Map<string, number>();
  members.forEach((m, i) => { const k = key(m.a, m.b); if (map.has(k)) throw new Error('Duplicate members are not supported.'); map.set(k, i); });
  const groups: number[][] = [];
  members.forEach((m, i) => {
    const j = map.get(key(mirror[m.a], mirror[m.b]));
    if (j === undefined) throw new Error('Optimization requires mirror-symmetric member connectivity.');
    if (i <= j) groups.push(i === j ? [i] : [i, j]);
  });
  const locked = new Set<number>(Array.from({ length: deck }, (_, i) => i));
  const extra = [...(options.lockedJoints ?? [])];
  if (supports.isPier) extra.push(supports.pierJointIndex);
  if (supports.isArch) extra.push(supports.archJointIndex, supports.archJointIndex + 1);
  if (supports.isLeftAnchorage) extra.push(supports.leftAnchorageJointIndex);
  if (supports.isRightAnchorage) extra.push(supports.rightAnchorageJointIndex);
  for (const i of extra) {
    if (!Number.isInteger(i) || i < 0 || i >= original.length) throw new Error('Invalid locked joint.');
    locked.add(i);
  }
  for (const i of Array.from(locked)) locked.add(mirror[i]);
  const targetForceN = targetMassG * 9.80665 / 1000;
  const overLength = (r: PastaResult) => r.memberLengthsM.reduce((sum, length) => sum + Math.max(0, length / stock - 1), 0);
  const feasible = (r: PastaResult) => overLength(r) <= 1e-9 && !Number.isNaN(r.firstFailureForceN) &&
    r.firstFailureForceN >= targetForceN * (1 - 1e-8) && r.peakRatio <= 1 + 1e-8;
  const better = (a: PastaResult, b: PastaResult) => {
    if (feasible(a) !== feasible(b)) return feasible(a);
    if (feasible(a)) return a.massKg < b.massKg * (1 - 1e-10);
    if (Math.abs(overLength(a) - overLength(b)) > 1e-9) return overLength(a) < overLength(b);
    if (Math.abs(a.peakRatio - b.peakRatio) > 1e-9) return a.peakRatio < b.peakRatio;
    return a.massKg < b.massKg * (1 - 1e-10);
  };
  type Candidate = { joints: typeof original; counts: Int32Array; result: PastaResult };
  const best: Candidate[] = [];
  let evaluations = 0, geometryEvaluations = 0, cyclesCompleted = 0, phase = 'reinforcement';
  const cancel = () => { if (options.signal?.aborted) throw new Error('Optimization cancelled.'); };
  const evaluate = async (points: typeof original, counts: Int32Array, required = false): Promise<Candidate | undefined> => {
    cancel(); if (evaluations >= limit) return undefined;
    if (evaluations > 0 && evaluations % 8 === 0) {
      options.onProgress?.(phase, evaluations); await new Promise<void>(resolve => setTimeout(resolve, 0)); cancel();
    }
    evaluations++;
    try {
      const r = analyzer({ joints: points, members, supports, properties, forceN: targetForceN, strandCounts: counts });
      if (!Number.isFinite(r.massKg) || r.massKg <= 0 || !Number.isFinite(r.peakRatio) ||
          !r.displacements.every(Number.isFinite) || !r.memberForces.every(Number.isFinite) ||
          r.memberLengthsM.length !== members.length || !r.memberLengthsM.every(v => Number.isFinite(v) && v > 0)) throw new Error('Non-finite structural response.');
      const candidate = { joints: points.map(p => ({ ...p })), counts: counts.slice(), result: r };
      if (feasible(r) && (!best.length || better(r, best[0].result))) best[0] = candidate;
      return candidate;
    } catch (error) { if (required) throw error; return undefined; }
  };
  const size = async (start: Candidate): Promise<Candidate> => {
    let current = start;
    phase = 'reinforcement';
    while (!feasible(current.result) && overLength(current.result) <= 1e-9 && evaluations < limit) {
      const order = groups.filter(g => current.counts[g[0]] < cap).slice().sort((a, b) =>
        Math.max(...b.map(i => Math.abs(current.result.signedRatios[i]))) - Math.max(...a.map(i => Math.abs(current.result.signedRatios[i]))));
      let next: Candidate | undefined;
      for (const group of order) {
        const counts = current.counts.slice(); group.forEach(i => counts[i]++);
        next = await evaluate(current.joints, counts);
        // Accept plateaus: tied governing groups may need reinforcement in turn.
        // Capped groups are excluded, so one capped member never ends the search.
        if (next || evaluations >= limit) break;
      }
      if (!next) break;
      current = next;
    }
    phase = 'pruning';
    if (feasible(current.result)) {
      let changed = true;
      while (changed && evaluations < limit) {
        changed = false;
        const order = groups.slice().sort((a, b) => b.reduce((v, i) => v + current.result.strandMassKg[i], 0) - a.reduce((v, i) => v + current.result.strandMassKg[i], 0));
        for (const group of order) if (current.counts[group[0]] > 1 && evaluations < limit) {
          const counts = current.counts.slice(); group.forEach(i => counts[i]--);
          const trial = await evaluate(current.joints, counts);
          if (trial && feasible(trial.result)) { current = trial; changed = true; }
        }
      }
    }
    return current;
  };
  const ones = new Int32Array(members.length).fill(1), seed = ones.slice();
  if (input.strandCounts) {
    if (input.strandCounts.length !== members.length) throw new Error('Strand counts must list one value per member.');
    for (let i = 0; i < members.length; i++) {
      const n = input.strandCounts[i];
      if (!Number.isInteger(n) || n < 1 || n > cap) throw new Error('Existing strand counts exceed the search limits.');
      seed[i] = n;
    }
    groups.forEach(g => { const n = Math.max(...g.map(i => seed[i])); g.forEach(i => seed[i] = n); });
  }
  let current = await size((await evaluate(original, seed, true))!);
  const resize = async (points: typeof original, counts: Int32Array) => {
    let trial = await evaluate(points, counts);
    if (!trial) return undefined;
    trial = await size(trial);
    if (evaluations < limit) {
      const base = await evaluate(points, ones);
      if (base) { const fresh = await size(base); if (better(fresh.result, trial.result)) trial = fresh; }
    }
    return trial;
  };
  const directions = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
  const onGrid = (v: number) => Math.abs(v / step - Math.round(v / step)) < 1e-7;
  let stale = 0;
  for (let cycle = 0; cycle < cycles && stale < 3 && evaluations < limit; cycle++) {
    const before = current.result;
    const sized = await resize(current.joints, current.counts);
    if (sized && better(sized.result, current.result)) current = sized;
    if (options.geometryFirst !== false) {
      const multiple = [4, 2, 1][Math.min(cycle, 2)];
      for (let pass = 0; pass < passes && evaluations < limit; pass++) {
        let moved = false;
        for (let i = 0; i < original.length && evaluations < limit; i++) {
          const j = mirror[i]; if (i > j || locked.has(i) || locked.has(j)) continue;
          for (const [dx, dy] of directions) {
            if (evaluations >= limit) break;
            if (i === j && dx !== 0) continue;
            const points = current.joints.map(p => ({ ...p }));
            const x = i === j ? mid : Math.round((points[i].x + dx * step * multiple) / step) * step;
            const y = Math.round((points[i].y + dy * step * multiple) / step) * step;
            points[i] = { x, y }; points[j] = { x: 2 * mid - x, y };
            if (![points[i].x, points[j].x, y].every(onGrid) || !allowed(points, true)) continue;
            phase = 'geometry'; geometryEvaluations++;
            const trial = await resize(points, current.counts);
            if (trial && better(trial.result, current.result)) { current = trial; moved = true; }
          }
        }
        if (!moved) break;
      }
    }
    cyclesCompleted++; stale = better(current.result, before) ? 0 : stale + 1;
  }
  cancel(); if (best.length) current = best[0];
  const limited = evaluations >= limit, metTarget = feasible(current.result);
  return { joints: current.joints.map(p => ({ ...p })), strandCounts: current.counts.slice(), result: current.result,
    targetMassG, targetForceN, metTarget, evaluations, geometryEvaluations, cyclesCompleted, limited,
    changedJointCount: current.joints.filter((p, i) => Math.hypot(p.x - original[i].x, p.y - original[i].y) > epsilon).length,
    reason: metTarget ? 'target-met' : limited ? 'evaluation-limit' : overLength(current.result) > 1e-9 ? 'over-length' : 'target-not-found' };
}
