/* SPDX-License-Identifier: GPL-3.0-or-later */
import { MAX_DRAWN_STRANDS, projectStrandPoint, strandOffsets } from './strand-visuals';
describe('Strand visualization helpers', () => {
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  it('draws one centered strand', () => { expect(strandOffsets(1)).toEqual([{ y: 0, z: 0 }]); });
  it('draws distinct strands centered about the member axis', () => {
    for (const count of [2, 4, 7, 19]) {
      const offsets = strandOffsets(count);
      expect(offsets.length).toBe(count);
      expect(offsets.reduce((sum, p) => sum + p.y, 0)).toBeCloseTo(0, 10);
      expect(offsets.reduce((sum, p) => sum + p.z, 0)).toBeCloseTo(0, 10);
      expect(new Set(offsets.map(p => `${p.y}:${p.z}`)).size).toBe(count);
    }
  });
  it('caps only rendered geometry, without changing the requested count', () => {
    const count = 10000;
    expect(strandOffsets(count).length).toBe(MAX_DRAWN_STRANDS);
    expect(count).toBe(10000);
    const radius = (n: number) => Math.max(...strandOffsets(n).map(p => Math.hypot(p.y, p.z)));
    expect(radius(100)).toBeGreaterThan(radius(19));
  });
  it('rejects invalid counts instead of inventing a bundle', () => {
    for (const count of [0, -1, 1.5, NaN, Infinity, 10001]) expect(() => strandOffsets(count)).toThrow();
  });
  it('maps clip coordinates into the CSS viewport, not the oversized canvas', () => {
    expect(projectStrandPoint(identity, 0, 0, 0, 800, 300)).toEqual({ x: 400, y: 150, depth: 0 });
    expect(projectStrandPoint(identity, 1, 1, 0, 800, 300)).toEqual({ x: 800, y: 0, depth: 0 });
    expect(projectStrandPoint(identity, 0, 0, 0, 300, 800)).toEqual({ x: 150, y: 400, depth: 0 });
  });
  it('applies the homogeneous perspective divide', () => {
    const matrix = [...identity]; matrix[15] = 2;
    expect(projectStrandPoint(matrix, 1, 1, 0, 800, 300)).toEqual({ x: 600, y: 75, depth: 0 });
  });
  it('culls points behind the eye and outside the near/far planes', () => {
    const matrix = [...identity]; matrix[15] = -1;
    expect(projectStrandPoint(matrix, 0, 0, 0, 800, 300)).toBeUndefined();
    expect(projectStrandPoint(identity, 0, 0, 2, 800, 300)).toBeUndefined();
    expect(projectStrandPoint(identity, 0, 0, -2, 800, 300)).toBeUndefined();
  });
  it('rejects non-finite coordinates and invalid viewport dimensions', () => {
    expect(projectStrandPoint(identity, NaN, 0, 0, 800, 300)).toBeUndefined();
    expect(projectStrandPoint(identity, 0, 0, 0, 0, 300)).toBeUndefined();
    expect(projectStrandPoint([], 0, 0, 0, 800, 300)).toBeUndefined();
  });
});
