/* SPDX-License-Identifier: GPL-3.0-or-later */
import type { PastaInput, PastaProperties } from './pasta-analysis';
import { centerLoadShares } from './center-load';

type Point3 = { x: number; y: number; z: number };
type Member3 = { a: number; b: number; strands: number; label: string };
export type PastaBridge3 = {
  joints: Point3[]; members: Member3[]; properties: PastaProperties;
  fixedDofs: number[]; unitLoads: Float64Array; forceN: number;
};

/** Explicit panel indices refer to existing drawn members. No chord guessing.
 * X crossings are unconnected. No transverse ties are silently added.
 * Supports: x/y/z fixed at both left seats, y/z at both right seats.
 * Plate and transfer beams deliver the load but their strength/mass is excluded.
 */
export function makePastaBridge3(input: PastaInput, top: readonly number[], bottom: readonly number[], braceStrands: number): PastaBridge3 {
  const n = input.joints.length, deck = input.supports.loadedJointCount, s = input.supports;
  if (!Number.isInteger(deck) || deck < 3 || deck > n || !top.length || !bottom.length ||
      !Number.isInteger(braceStrands) || braceStrands < 1 || braceStrands > 10000) throw new Error('Invalid full-bridge layout.');
  if (s.isPier || s.isArch || s.isLeftAnchorage || s.isRightAnchorage) throw new Error('Full-bridge mode currently requires simple end seats.');
  const span = input.joints[deck - 1].x - input.joints[0].x;
  if (!Number.isFinite(span) || span <= 0) throw new Error('Invalid span.');
  const panels = [...top, ...bottom];
  if (new Set(panels).size !== panels.length || panels.some(i => !Number.isInteger(i) || i < 0 || i >= input.members.length)) throw new Error('Choose distinct existing top and bottom members.');
  if (input.strandCounts && input.strandCounts.length !== input.members.length) throw new Error('Invalid side strand counts.');
  const joints: Point3[] = [];
  for (const z of [-0.0225, 0.0225]) for (const p of input.joints) joints.push({ x: (p.x - input.joints[0].x) / span, y: (p.y - input.joints[0].y) / span, z });
  const members: Member3[] = [];
  input.members.forEach((m, i) => {
    if (![m.a, m.b].every(j => Number.isInteger(j) && j >= 0 && j < n) || m.a === m.b) throw new Error('Invalid side connectivity.');
    for (let side = 0; side < 2; side++) members.push({ a: m.a + side * n, b: m.b + side * n, strands: input.strandCounts?.[i] ?? 1, label: `${side ? 'R' : 'L'}-M${i + 1}` });
  });
  panels.forEach(i => {
    const m = input.members[i];
    members.push({ a: m.a, b: m.b + n, strands: braceStrands, label: `X${i + 1}a` }, { a: m.b, b: m.a + n, strands: braceStrands, label: `X${i + 1}b` });
  });
  const fixedDofs: number[] = [], unitLoads = new Float64Array(6 * n);
  const shares = centerLoadShares(joints.slice(0, deck).map(p => p.x), 1);
  for (let side = 0; side < 2; side++) {
    const left = 3 * side * n, right = 3 * (side * n + deck - 1);
    fixedDofs.push(left, left + 1, left + 2, right + 1, right + 2);
    shares.forEach(load => unitLoads[3 * (side * n + load.jointIndex) + 1] -= load.forceKN / 2);
  }
  return { joints, members, properties: { ...input.properties }, fixedDofs, unitLoads, forceN: input.forceN };
}

/** 3D small-deflection axial truss model, not a nonlinear stability/collapse model.
 * Loose-strand stiffness, mass and pinned Euler capacity all scale with count.
 * This module is not connected to the UI or optimizer until a separate integration.
 */
export function analyzePastaBridge3(model: PastaBridge3) {
  const { joints, members, properties: p, unitLoads, forceN } = model, nd = 3 * joints.length;
  if (!joints.length || joints.length > 300 || !members.length || unitLoads.length !== nd || !unitLoads.every(Number.isFinite) ||
      !Number.isFinite(forceN) || forceN < 0 || ![p.elasticModulusPa, p.tensileStrengthPa, p.compressiveStrengthPa, p.densityKgM3, p.diameterM].every(v => Number.isFinite(v) && v > 0) ||
      joints.some(q => ![q.x, q.y, q.z].every(Number.isFinite))) throw new Error('Invalid 3D model.');
  const fixed = new Set(model.fixedDofs);
  if ([...fixed].some(d => !Number.isInteger(d) || d < 0 || d >= nd)) throw new Error('Invalid 3D restraints.');
  const free = Array.from({ length: nd }, (_, d) => d).filter(d => !fixed.has(d));
  const pos = new Int32Array(nd).fill(-1); free.forEach((d, i) => pos[d] = i);
  const k = Array.from({ length: free.length }, () => new Float64Array(free.length));
  const dead = new Float64Array(nd), area = Math.PI * p.diameterM ** 2 / 4, inertia = Math.PI * p.diameterM ** 4 / 64;
  const seen = new Set<string>();
  let massKg = 0, totalStrands = 0;
  const data = members.map(m => {
    if (![m.a, m.b].every(j => Number.isInteger(j) && j >= 0 && j < joints.length) || m.a === m.b || !Number.isInteger(m.strands) || m.strands < 1 || m.strands > 10000) throw new Error('Invalid 3D member.');
    const key = [m.a, m.b].sort((a, b) => a - b).join(':');
    if (seen.has(key)) throw new Error('Duplicate 3D member.'); seen.add(key);
    const a = joints[m.a], b = joints[m.b], delta = [b.x - a.x, b.y - a.y, b.z - a.z], length = Math.hypot(...delta);
    if (!Number.isFinite(length) || length < 0.001) throw new Error('Invalid 3D length.');
    const direction = delta.map(v => v / length), t = [...direction.map(v => -v), ...direction];
    const dofs = [3 * m.a, 3 * m.a + 1, 3 * m.a + 2, 3 * m.b, 3 * m.b + 1, 3 * m.b + 2];
    const stiffness = m.strands * p.elasticModulusPa * area / length, mass = m.strands * p.densityKgM3 * area * length;
    massKg += mass; totalStrands += m.strands;
    dead[dofs[1]] -= mass * 9.80665 / 2; dead[dofs[4]] -= mass * 9.80665 / 2;
    dofs.forEach((d, r) => { const pr = pos[d]; if (pr < 0) return;
      dofs.forEach((e, c) => { const pc = pos[e]; if (pc >= 0) k[pr][pc] += stiffness * t[r] * t[c]; }); });
    return { length, t, dofs, stiffness };
  });
  const rhs = [Float64Array.from(free.map(d => dead[d])), Float64Array.from(free.map(d => unitLoads[d]))];
  const tiny = 1e-10 * k.reduce((v, row, i) => Math.max(v, Math.abs(row[i])), 0);
  for (let c = 0; c < free.length; c++) {
    let pivot = c;
    for (let r = c + 1; r < free.length; r++) if (Math.abs(k[r][c]) > Math.abs(k[pivot][c])) pivot = r;
    if (Math.abs(k[pivot][c]) <= tiny || !Number.isFinite(k[pivot][c])) throw new Error('Unstable or ill-conditioned 3D bridge.');
    [k[c], k[pivot]] = [k[pivot], k[c]];
    rhs.forEach(b => { const v = b[c]; b[c] = b[pivot]; b[pivot] = v; });
    for (let r = c + 1; r < free.length; r++) {
      const factor = k[r][c] / k[c][c];
      for (let j = c; j < free.length; j++) k[r][j] -= factor * k[c][j];
      rhs.forEach(b => b[r] -= factor * b[c]);
    }
  }
  rhs.forEach(b => { for (let r = free.length - 1; r >= 0; r--) {
    let v = b[r]; for (let c = r + 1; c < free.length; c++) v -= k[r][c] * b[c]; b[r] = v / k[r][r];
  } });
  const deadU = new Float64Array(nd), unitU = new Float64Array(nd);
  free.forEach((d, i) => { deadU[d] = rhs[0][i]; unitU[d] = rhs[1][i]; });
  const displacements = Float64Array.from(deadU, (v, i) => v + forceN * unitU[i]);
  const forces = new Float64Array(members.length), ratios = forces.slice(), failureLoads = forces.slice();
  const compression = forces.slice(), tension = forces.slice();
  const reactions = Float64Array.from(dead, (v, i) => -v - forceN * unitLoads[i]);
  let peakRatio = 0, firstFailureForceN = Infinity;
  data.forEach((d, i) => {
    const axial = (u: Float64Array) => d.stiffness * d.dofs.reduce((v, index, j) => v + d.t[j] * u[index], 0);
    const nd = axial(deadU), nu = axial(unitU), force = nd + forceN * nu, count = members[i].strands;
    tension[i] = count * p.tensileStrengthPa * area;
    compression[i] = count * Math.min(p.compressiveStrengthPa * area, Math.PI ** 2 * p.elasticModulusPa * inertia / d.length ** 2);
    forces[i] = force; ratios[i] = force / (force >= 0 ? tension[i] : compression[i]); peakRatio = Math.max(peakRatio, Math.abs(ratios[i]));
    const selfFails = nd > tension[i] || nd < -compression[i];
    failureLoads[i] = selfFails ? -Infinity : nu > 0 ? (tension[i] - nd) / nu : nu < 0 ? (-compression[i] - nd) / nu : Infinity;
    if (selfFails) firstFailureForceN = NaN;
    else if (!Number.isNaN(firstFailureForceN)) firstFailureForceN = Math.min(firstFailureForceN, failureLoads[i]);
    d.dofs.forEach((index, j) => reactions[index] += d.t[j] * force);
  });
  if (!displacements.every(Number.isFinite) || !forces.every(Number.isFinite) || !reactions.every(Number.isFinite)) throw new Error('Non-finite 3D response.');
  return { displacements, memberForces: forces, signedRatios: ratios, tensileCapacityN: tension, compressiveCapacityN: compression,
    memberFailureForceN: failureLoads, firstFailureForceN, peakRatio, reactions, massKg, selfWeightN: massKg * 9.80665,
    totalStrandCount: totalStrands, memberLengthsM: Float64Array.from(data.map(d => d.length)) };
}
