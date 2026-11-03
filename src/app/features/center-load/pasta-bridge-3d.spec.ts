/* SPDX-License-Identifier: GPL-3.0-or-later */
import { DEFAULT_PASTA_PROPERTIES, PastaInput } from './pasta-analysis';
import { analyzePastaBridge3, makePastaBridge3, PastaBridge3 } from './pasta-bridge-3d';

describe('Full pasta bridge numerical foundation (not UI integration)', () => {
  const side = (): PastaInput => ({
    joints: [{ x: 0, y: 0 }, { x: 0.5, y: 0 }, { x: 1, y: 0 }, { x: 0.5, y: 0.2 }],
    members: [{ a: 0, b: 1 }, { a: 1, b: 2 }, { a: 0, b: 3 }, { a: 1, b: 3 }, { a: 2, b: 3 }],
    strandCounts: [2, 2, 3, 1, 3], properties: { ...DEFAULT_PASTA_PROPERTIES }, forceN: 19.6133,
    supports: { loadedJointCount: 3, isPier: false, isHiPier: false, pierJointIndex: -1,
      isArch: false, archJointIndex: -1, isLeftAnchorage: false, leftAnchorageJointIndex: -1,
      isRightAnchorage: false, rightAnchorageJointIndex: -1 },
  });
  const bridge = () => makePastaBridge3(side(), [2, 4], [0, 1], 1);
  const tripod = (): PastaBridge3 => ({
    joints: [...[0, 1, 2].map(i => ({ x: Math.cos(i * 2 * Math.PI / 3), y: 0, z: Math.sin(i * 2 * Math.PI / 3) })), { x: 0, y: 1, z: 0 }],
    members: [0, 1, 2].map(a => ({ a, b: 3, strands: 2, label: `S${a}` })), properties: { ...DEFAULT_PASTA_PROPERTIES },
    fixedDofs: [0, 1, 2, 3, 4, 5, 6, 7, 8], unitLoads: Float64Array.from([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, -1, 0]), forceN: 1,
  });
  it('uses 45 mm spacing, copies both sides, adds only the specified X braces and shares total load', () => {
    const b = bridge(); expect(b.joints.length).toBe(8); expect(b.members.length).toBe(18);
    expect(b.joints[4].z - b.joints[0].z).toBeCloseTo(0.045, 12);
    expect(b.unitLoads[4]).toBe(-0.5); expect(b.unitLoads[16]).toBe(-0.5);
    expect(Array.from(b.unitLoads).reduce((a, v) => a + v, 0)).toBe(-1); expect(b.forceN).toBe(19.6133);
  });
  it('matches independent closed-form tripod equilibrium and axial extension including self-weight', () => {
    const b = tripod(), r = analyzePastaBridge3(b), p = b.properties;
    const area = Math.PI * p.diameterM ** 2 / 4, length = Math.sqrt(2), load = b.forceN + r.selfWeightN / 2;
    const uy = -load / (3 * p.elasticModulusPa * area * 2 / (2 * length));
    expect(r.displacements[10]).toBeCloseTo(uy, 12);
    r.memberForces.forEach(f => expect(f).toBeCloseTo(-load * length / 3, 10));
    expect(r.displacements[9]).toBeCloseTo(0, 12); expect(r.displacements[11]).toBeCloseTo(0, 12);
  });
  it('balances whole-bridge reactions against hanging load and all modeled strand weight', () => {
    const b = bridge(), before = JSON.stringify(b), r = analyzePastaBridge3(b);
    const ry = Array.from(r.reactions).filter((_, i) => i % 3 === 1).reduce((a, v) => a + v, 0);
    expect(ry).toBeCloseTo(b.forceN + r.selfWeightN, 9);
    expect(r.displacements[4]).toBeCloseTo(r.displacements[16], 10);
    expect(r.totalStrandCount).toBe(30); expect(JSON.stringify(b)).toBe(before);
  });
  it('scales loose-strand buckling capacity linearly rather than as a bonded bundle', () => {
    const b = tripod(), a = analyzePastaBridge3(b);
    const doubled = analyzePastaBridge3({ ...b, members: b.members.map(m => ({ ...m, strands: 4 })) });
    expect(doubled.massKg).toBeCloseTo(2 * a.massKg, 12);
    a.compressiveCapacityN.forEach((c, i) => expect(doubled.compressiveCapacityN[i]).toBeCloseTo(2 * c, 12));
  });
  it('responds to an out-of-plane load and rejects the unbraced mechanism', () => {
    const b = bridge(); b.unitLoads = new Float64Array(b.unitLoads.length); b.unitLoads[11] = 1;
    const r = analyzePastaBridge3(b); expect(Math.abs(r.displacements[11])).toBeGreaterThan(0);
    expect(() => analyzePastaBridge3({ ...b, members: b.members.filter(m => !m.label.startsWith('X')) })).toThrowError(/Unstable/);
  });
  it('does not modify the source drawing and normalizes only the side span, not bridge width', () => {
    const input = side(), before = JSON.stringify(input);
    const scaled = { ...input, joints: input.joints.map(p => ({ x: p.x * 40 + 7, y: p.y * 40 - 3 })) };
    const b = makePastaBridge3(scaled, [2, 4], [0, 1], 1);
    expect(b.joints[2].x - b.joints[0].x).toBe(1); expect(b.joints[4].z - b.joints[0].z).toBeCloseTo(0.045, 12);
    expect(JSON.stringify(input)).toBe(before);
  });
  it('rejects invalid geometry, duplicate members and unsupported restraints instead of inventing a result', () => {
    expect(() => makePastaBridge3(side(), [2, 2], [0], 1)).toThrow();
    expect(() => makePastaBridge3(side(), [99], [0], 1)).toThrow();
    const input = side(); input.supports.isPier = true;
    expect(() => makePastaBridge3(input, [2, 4], [0, 1], 1)).toThrowError(/simple end seats/);
    const b = bridge();
    expect(() => analyzePastaBridge3({ ...b, members: [...b.members, b.members[0]] })).toThrowError(/Duplicate/);
    expect(() => analyzePastaBridge3({ ...b, fixedDofs: [-1] })).toThrowError(/restraints/);
    expect(() => analyzePastaBridge3({ ...b, forceN: NaN })).toThrow();
  });
});
