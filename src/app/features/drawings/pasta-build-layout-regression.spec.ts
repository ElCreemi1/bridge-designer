/* SPDX-License-Identifier: GPL-3.0-or-later */
import { makePastaBuild, pastaBuildTiles, pastaBuildInkBounds, pastaCutList } from './pasta-build-layout';
import { PastaBuildPdfService } from './pasta-build-pdf.service';

describe('Compact pasta construction booklet', () => {
  const members = [{ a: 0, b: 1, number: 1 }, { a: 1, b: 2, number: 2 }, { a: 1, b: 3, number: 3 }];
  const counts = [4, 3, 2];
  const points = (height: number) => [{ x: 0, y: 0 }, { x: 0.5, y: 0 }, { x: 1, y: 0 }, { x: 0.5, y: height }];
  const build = (height: number) => makePastaBuild(points(height), members, counts, 3, 0.25);
  const ink = (height: number) => pastaBuildInkBounds(build(height), (text, size) => text.length * size * 0.18);
  it('does not add a second five-sheet row merely for trailing margin', () => {
    const plan = pastaBuildTiles(build(0.15), 279.4, 215.9, ink(0.15));
    expect(plan.columns).toBe(5); expect(plan.rows).toBe(1); expect(plan.tiles.length).toBe(5);
    expect(plan.tiles[0].x).toBe(-10); expect(plan.tiles[0].y).toBe(-160);
    expect(plan.tiles[0].x + plan.tiles[0].width - plan.tiles[1].x).toBe(10);
  });
  it('retains a real second row for taller geometry and covers all ink bounds', () => {
    const bounds = ink(0.2), plan = pastaBuildTiles(build(0.2), 279.4, 215.9, bounds);
    expect(plan.rows).toBe(2);
    for (const x of [bounds.xMin, bounds.xMax]) for (const y of [bounds.yMin, bounds.yMax]) {
      expect(plan.tiles.some(t => x >= t.x && x <= t.x + t.width && y >= t.y && y <= t.y + t.height)).toBeTrue();
    }
  });
  it('keeps wide boundary labels rather than dropping their continuation sheet', () => {
    const bounds = ink(0.15); bounds.yMax = 6;
    expect(pastaBuildTiles(build(0.15), 279.4, 215.9, bounds).rows).toBe(2);
  });
  it('groups equal lengths and sums separate strand pieces, not member counts', () => {
    const model = build(0.2), before = JSON.stringify(model), cuts = pastaCutList(model);
    expect(cuts.map(c => [c.lengthMm, c.quantity])).toEqual([[200, 2], [500, 7]]);
    expect(cuts.map(c => c.overLength)).toEqual([false, true]);
    expect(cuts.reduce((sum, c) => sum + c.quantity, 0)).toBe(model.totalPieces);
    expect(JSON.stringify(model)).toBe(before);
  });
  it('does not merge different lengths merely because they round to the same tenth', () => {
    const model = build(0.2);
    model.parts = model.parts.slice(0, 2).map((p, i) => ({ ...p, lengthMm: 100.01 + i * 0.01 }));
    const cuts = pastaCutList(model);
    expect(cuts.length).toBe(2); expect(cuts[0].labelMm).not.toBe(cuts[1].labelMm);
  });
  it('keeps original coordinates and scale for Letter and A4', () => {
    const model = build(0.15), before = JSON.stringify(model);
    for (const [w, h] of [[279.4, 215.9], [297, 210]]) {
      const plan = pastaBuildTiles(model, w, h, ink(0.15)); expect(plan.tiles.length).toBeGreaterThan(0);
      expect(model.points[2].x - model.points[0].x).toBe(1000);
    }
    expect(JSON.stringify(model)).toBe(before);
  });
  it('exports five full-scale tiles, one compact cut list and an overview for a 150 mm high drawing', () => {
    const bridge = { bridge: { joints: points(0.15), members: members.map(m => ({ a: { index: m.a }, b: { index: m.b }, number: m.number })) },
      designConditions: { loadedJointCount: 3 } };
    const service = new PastaBuildPdfService(bridge as never, { read: () => counts } as never, { maxStrandLengthM: 0.25 } as never);
    const doc = service.create();
    expect(doc.getNumberOfPages()).toBe(7); expect(doc.output('arraybuffer').byteLength).toBeGreaterThan(1000);
  });
});
