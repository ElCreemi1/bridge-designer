/* SPDX-License-Identifier: GPL-3.0-or-later */
import { makePastaBuild, pastaBuildTiles } from '../drawings/pasta-build-layout';
import { PastaBuildPdfService } from '../drawings/pasta-build-pdf.service';
describe('Pasta graph-paper build booklet', () => {
  const joints = [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 40, y: 0 }, { x: 20, y: 8 }];
  const members = [{ a: 0, b: 1, number: 1 }, { a: 1, b: 2, number: 2 }, { a: 1, b: 3, number: 3 }];
  const counts = [4, 3, 2];
  const model = () => makePastaBuild(joints, members, counts, 3, 0.25);
  it('retains a real 1000 mm span and unscaled member lengths', () => {
    const m = model(); expect(m.points[2].x - m.points[0].x).toBe(1000);
    expect(m.parts.map(p => p.lengthMm)).toEqual([500, 500, 200]);
    expect(m.points[3].y).toBe(-200);
  });
  it('retains strand quantities and total material without doubling side trusses', () => {
    const m = model(); expect(m.totalPieces).toBe(9); expect(m.totalLengthMm).toBe(3900);
    expect(m.parts.map(p => p.count)).toEqual(counts);
  });
  it('flags over-length pieces without silently assuming splices', () => {
    expect(model().parts.map(p => p.overLength)).toEqual([true, true, false]);
  });
  it('aligns every joint to intersections, using a finer grid when needed', () => {
    const changed = joints.map(p => ({ ...p })); changed[3] = { x: 10.25, y: 4.25 };
    const m = makePastaBuild(changed, members, counts, 3, 0.25); expect(m.gridMm).toBe(1.25);
    m.points.forEach(p => { expect(p.x / m.gridMm).toBeCloseTo(Math.round(p.x / m.gridMm), 8);
      expect(p.y / m.gridMm).toBeCloseTo(Math.round(p.y / m.gridMm), 8); });
  });
  it('tiles with 10 mm overlap and a common grid phase', () => {
    const plan = pastaBuildTiles(model(), 279.4, 215.9);
    expect(plan.columns).toBe(5); expect(plan.rows).toBe(2);
    expect(plan.tiles[0].x + plan.tiles[0].width - plan.tiles[1].x).toBe(10);
    expect(plan.tiles[0].y + plan.tiles[0].height - plan.tiles[5].y).toBe(10);
    plan.tiles.forEach(tile => { expect(tile.x % model().gridMm).toBeCloseTo(0, 8);
      expect(tile.y % model().gridMm).toBeCloseTo(0, 8); });
    model().points.forEach(p => expect(plan.tiles.some(t => p.x >= t.x && p.x <= t.x + t.width && p.y >= t.y && p.y <= t.y + t.height)).toBeTrue());
  });
  it('supports A4 without changing physical model dimensions', () => {
    const m = model(), before = JSON.stringify(m);
    const plan = pastaBuildTiles(m, 297, 210); expect(plan.tiles.length).toBeGreaterThan(0);
    expect(JSON.stringify(m)).toBe(before);
  });
  it('normalizes translated drawings identically without modifying the input', () => {
    const shifted = joints.map(p => ({ x: p.x + 7, y: p.y - 3 }));
    const before = JSON.stringify({ shifted, members, counts });
    expect(makePastaBuild(shifted, members, counts, 3, 0.25).points).toEqual(model().points);
    expect(JSON.stringify({ shifted, members, counts })).toBe(before);
  });
  it('rejects mismatched counts, invalid members and invalid paper', () => {
    expect(() => makePastaBuild(joints, members, [1], 3, 0.25)).toThrow();
    expect(() => makePastaBuild(joints, [{ a: 0, b: 99, number: 1 }], [1], 3, 0.25)).toThrow();
    expect(() => pastaBuildTiles(model(), 20, 20)).toThrow();
  });
  it('rejects a grid too fine to print instead of moving joints', () => {
    const changed = joints.map(p => ({ ...p })); changed[3].x = 10.01;
    expect(() => makePastaBuild(changed, members, counts, 3, 0.25)).toThrowError(/0.5 mm/);
  });
  it('creates full-scale tiles, an illustrated parts page and a final overview', () => {
    const bridge = { bridge: { joints, members: members.map(m => ({ a: { index: m.a }, b: { index: m.b }, number: m.number })) },
      designConditions: { loadedJointCount: 3 } };
    const service = new PastaBuildPdfService(bridge as never, { read: () => counts } as never, { maxStrandLengthM: 0.25 } as never);
    const doc = service.create();
    expect(doc.getNumberOfPages()).toBe(pastaBuildTiles(model(), doc.internal.pageSize.getWidth(), doc.internal.pageSize.getHeight()).tiles.length + 2);
    expect(doc.output('arraybuffer').byteLength).toBeGreaterThan(1000);
  });
});
