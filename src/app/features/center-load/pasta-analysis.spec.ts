/* Copyright (c) 2025-2026 Gene Ressler
   SPDX-License-Identifier: GPL-3.0-or-later */
import { analyzePasta, DEFAULT_PASTA_PROPERTIES, optimizeStrands, overLengthMembers, PastaInput, PastaProperties } from './pasta-analysis';

const supports = {
  loadedJointCount: 3, isPier: false, isHiPier: false, pierJointIndex: -1, isArch: false, archJointIndex: -1,
  isLeftAnchorage: false, leftAnchorageJointIndex: -1, isRightAnchorage: false, rightAnchorageJointIndex: -1,
};
// Drawn at 8 m; analyzed at 1.00 m.
const joints = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 8, y: 0 }, { x: 4, y: 4 }];
const memberPairs = [[0, 1], [1, 2], [0, 3], [3, 2], [1, 3]].map(([a, b]) => ({ a, b }));

function input(forceN: number, overrides: Partial<PastaProperties> = {}, members = memberPairs): PastaInput {
  return { joints, members, supports, forceN, properties: { ...DEFAULT_PASTA_PROPERTIES, ...overrides } };
}

describe('pasta analysis', () => {
  const area = Math.PI * DEFAULT_PASTA_PROPERTIES.diameterM ** 2 / 4;
  const ea = DEFAULT_PASTA_PROPERTIES.elasticModulusPa * area;

  it('scales the deck span to exactly 1.00 m', () => {
    expect(analyzePasta(input(0)).scale).toBeCloseTo(1 / 8, 12);
  });
  it('matches statics for the incremental center-load forces', () => {
    const dead = analyzePasta(input(0)), loaded = analyzePasta(input(10));
    const expected = [5, 5, -10 / Math.SQRT2, -10 / Math.SQRT2, 10];
    expected.forEach((f, i) => expect(loaded.memberForces[i] - dead.memberForces[i]).toBeCloseTo(f, 8));
  });
  it('matches the virtual-work center deflection at 1.00 m scale', () => {
    const dead = analyzePasta(input(0)), loaded = analyzePasta(input(10));
    const expected = -10 * (6 + 4 * Math.SQRT2) / 8 / ea;
    expect(loaded.centerDeflectionM - dead.centerDeflectionM).toBeCloseTo(expected, 12);
  });
  it('computes self-weight from density, area and total strand length', () => {
    const r = analyzePasta(input(0));
    const length = 0.5 + 0.5 + 2 * Math.SQRT1_2 + 0.5;
    expect(r.totalStrandLengthM).toBeCloseTo(length, 12);
    expect(r.selfWeightN).toBeCloseTo(DEFAULT_PASTA_PROPERTIES.densityKgM3 * area * length * 9.80665, 12);
    expect(r.memberForces[4]).toBeGreaterThan(0); // Self-weight alone puts the vertical in tension.
  });
  it('limits compression by the smaller of crushing and pinned-end Euler buckling', () => {
    const p = DEFAULT_PASTA_PROPERTIES, r = analyzePasta(input(1));
    const inertia = Math.PI * p.diameterM ** 4 / 64;
    const euler = Math.PI ** 2 * p.elasticModulusPa * inertia / (0.5 * Math.SQRT2) ** 2;
    expect(r.compressiveCapacityN[2]).toBeCloseTo(Math.min(euler, p.compressiveStrengthPa * area), 10);
    expect(r.bucklingGoverns[2]).toBe(1);
    const stubby = analyzePasta(input(1, { diameterM: 0.1 }));
    expect(stubby.bucklingGoverns[2]).toBe(0);
    expect(stubby.compressiveCapacityN[2]).toBeCloseTo(p.compressiveStrengthPa * Math.PI * 0.1 ** 2 / 4, 6);
  });
  it('predicts the linear first-failure force and flags members past it', () => {
    const thick = { diameterM: 5e-3 };
    const r = analyzePasta(input(0, thick));
    expect(r.firstFailureForceN).toBeGreaterThan(0);
    const at = analyzePasta(input(r.firstFailureForceN, thick));
    expect(at.peakRatio).toBeCloseTo(1, 8);
    expect(analyzePasta(input(r.firstFailureForceN * 1.01, thick)).overStrengthCount).toBeGreaterThan(0);
  });
  it('rejects invalid input and unstable structures', () => {
    expect(() => analyzePasta(input(-1))).toThrow();
    expect(() => analyzePasta(input(NaN))).toThrow();
    expect(() => analyzePasta(input(1, { diameterM: 0 }))).toThrow();
    expect(() => analyzePasta(input(1, {}, memberPairs.slice(0, 4)))).toThrowError(/unstable/i);
  });

  describe('loose strand bundles', () => {
    const withCounts = (forceN: number, counts: number[], overrides: Partial<PastaProperties> = {}) =>
      analyzePasta({ ...input(forceN, overrides), strandCounts: counts });

    it('defaults to one strand per member', () => {
      const r = analyzePasta(input(1));
      expect(Array.from(r.strandCounts)).toEqual([1, 1, 1, 1, 1]);
      expect(r.totalStrandCount).toBe(5);
    });
    it('scales area, weight and both capacities linearly with strand count', () => {
      const one = analyzePasta(input(1)), r = withCounts(1, [1, 1, 3, 1, 1]);
      expect(r.tensileCapacityN[2]).toBeCloseTo(3 * one.tensileCapacityN[2], 10);
      expect(r.compressiveCapacityN[2]).toBeCloseTo(3 * one.compressiveCapacityN[2], 10);
      expect(r.bucklingGoverns[2]).toBe(one.bucklingGoverns[2]); // Loose strands buckle one by one.
      expect(r.massKg).toBeCloseTo(one.massKg + 2 * one.strandMassKg[2], 12);
      expect(r.totalStrandCount).toBe(7);
    });
    it('keeps statically determinate member forces from the center load unchanged', () => {
      const a0 = withCounts(0, [2, 2, 2, 2, 2]), a = withCounts(10, [2, 2, 2, 2, 2]);
      const expected = [5, 5, -10 / Math.SQRT2, -10 / Math.SQRT2, 10];
      expected.forEach((f, i) => expect(a.memberForces[i] - a0.memberForces[i]).toBeCloseTo(f, 8));
    });
    it('halves the center-load deflection when every member doubles', () => {
      const d = (c: number[]) => withCounts(10, c).centerDeflectionM - withCounts(0, c).centerDeflectionM;
      expect(d([2, 2, 2, 2, 2])).toBeCloseTo(d([1, 1, 1, 1, 1]) / 2, 12);
    });
    it('reports efficiency as failure load per gram', () => {
      const r = withCounts(0, [1, 1, 2, 2, 1], { diameterM: 5e-3 });
      expect(r.efficiencyNPerG).toBeCloseTo(r.firstFailureForceN / (r.massKg * 1000), 12);
    });
    it('rejects invalid strand counts', () => {
      expect(() => withCounts(1, [1, 1, 0, 1, 1])).toThrow();
      expect(() => withCounts(1, [1, 1, 1.5, 1, 1])).toThrow();
      expect(() => withCounts(1, [1, 1, 1])).toThrow();
    });
  });

  describe('strand optimizer', () => {
    const base = input(0, { diameterM: 3e-3 });
    const oneStrandMass = analyzePasta(base).massKg;

    it('rescues a truss that fails under its own weight', () => {
      const thin = input(0);
      expect(analyzePasta(thin).firstFailureForceN).toBeNaN();
      const { result } = optimizeStrands(thin, { massBudgetKg: 4 * analyzePasta(thin).massKg, maxStrandsPerMember: 50 });
      expect(result.firstFailureForceN).toBeGreaterThan(0);
    });

    it('raises the failure load and respects the mass budget and member limit', () => {
      const start = analyzePasta(base);
      expect(start.firstFailureForceN).toBeGreaterThan(0);
      const { strandCounts, result } = optimizeStrands(base, { massBudgetKg: 4 * oneStrandMass, maxStrandsPerMember: 12 });
      expect(result.firstFailureForceN).toBeGreaterThan(start.firstFailureForceN * 2);
      expect(result.massKg).toBeLessThanOrEqual(4 * oneStrandMass * (1 + 1e-12));
      expect(Math.max(...strandCounts)).toBeLessThanOrEqual(12);
      expect(Math.min(...strandCounts)).toBeGreaterThanOrEqual(1);
    });
    it('puts the most strands in the buckling-governed compression diagonals', () => {
      const { strandCounts } = optimizeStrands(base, { massBudgetKg: 4 * oneStrandMass, maxStrandsPerMember: 50 });
      // Members 2 and 3 are the long compression diagonals; 0, 1 and 4 are in tension.
      expect(strandCounts[2]).toBeGreaterThan(strandCounts[0]);
      expect(strandCounts[3]).toBeGreaterThan(strandCounts[4]);
    });
    it('leaves no strand that can be removed without lowering the failure load', () => {
      const { strandCounts, result } = optimizeStrands(base, { massBudgetKg: 4 * oneStrandMass, maxStrandsPerMember: 50 });
      for (let i = 0; i < strandCounts.length; i++) {
        if (strandCounts[i] === 1) continue;
        const fewer = Array.from(strandCounts); fewer[i]--;
        const trial = analyzePasta({ ...base, strandCounts: fewer });
        expect(trial.firstFailureForceN).toBeLessThan(result.firstFailureForceN * (1 - 1e-12));
      }
    });
    it('beats uniform bundles of the same or greater mass', () => {
      const { result } = optimizeStrands(base, { massBudgetKg: 3 * oneStrandMass, maxStrandsPerMember: 50 });
      const uniform = analyzePasta({ ...base, strandCounts: [3, 3, 3, 3, 3] });
      expect(result.massKg).toBeLessThanOrEqual(uniform.massKg * (1 + 1e-12));
      expect(result.firstFailureForceN).toBeGreaterThan(uniform.firstFailureForceN);
    });
    it('rejects a budget below one strand per member', () => {
      expect(() => optimizeStrands(base, { massBudgetKg: oneStrandMass / 2, maxStrandsPerMember: 10 })).toThrowError(/budget/);
    });
  });

  describe('strand length limit', () => {
    it('reports member lengths at the 1.00 m scale', () => {
      const r = analyzePasta(input(0));
      // 4 m chords and post, 4*sqrt(2) m diagonals, drawn on an 8 m span.
      [0.5, 0.5, Math.SQRT1_2, Math.SQRT1_2, 0.5].forEach((l, i) => expect(r.memberLengthsM[i]).toBeCloseTo(l, 12));
    });
    it('lists only members longer than one strand', () => {
      const r = analyzePasta(input(0));
      expect(overLengthMembers(r, 0.6).map(o => o.index)).toEqual([2, 3]);
      expect(overLengthMembers(r, 0.5).map(o => o.index)).toEqual([2, 3]); // Exactly 0.5 m is allowed.
      expect(overLengthMembers(r, 0.75).length).toBe(0);
    });
    it('stops the optimizer while any member is too long', () => {
      const base = input(0, { diameterM: 3e-3 });
      const mass = analyzePasta(base).massKg;
      expect(() => optimizeStrands(base, { massBudgetKg: 3 * mass, maxStrandsPerMember: 10, maxStrandLengthM: 0.6 }))
        .toThrowError(/M3, M4/);
      expect(() => optimizeStrands(base, { massBudgetKg: 3 * mass, maxStrandsPerMember: 10, maxStrandLengthM: 0.75 })).not.toThrow();
    });
  });
});
