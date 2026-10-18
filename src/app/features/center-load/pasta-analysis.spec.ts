/* Copyright (c) 2025-2026 Gene Ressler
   SPDX-License-Identifier: GPL-3.0-or-later */
import { analyzePasta, DEFAULT_PASTA_PROPERTIES, PastaInput, PastaProperties } from './pasta-analysis';

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
});
