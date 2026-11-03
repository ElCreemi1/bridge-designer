/* SPDX-License-Identifier: GPL-3.0-or-later */
export type BuildPoint = { x: number; y: number };
export type BuildMember = { a: number; b: number; number: number };
export const BUILD_MARGIN_MM = 12.7;
export const BUILD_OVERLAP_MM = 10;

/** Coordinates in actual millimetres, x right and y down. Geometry is never snapped. */
export function makePastaBuild(joints: readonly BuildPoint[], members: readonly BuildMember[],
  counts: readonly number[], deckCount: number, maxStrandLengthM: number) {
  if (!Number.isInteger(deckCount) || deckCount < 2 || deckCount > joints.length || !members.length) {
    throw new Error('A pasta booklet requires a bridge with members and valid deck endpoints.');
  }
  if (joints.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) throw new Error('Invalid joint coordinates.');
  const span = joints[deckCount - 1].x - joints[0].x;
  if (!Number.isFinite(span) || span <= 0) throw new Error('Invalid pasta support span.');
  if (counts.length !== members.length || counts.some(n => !Number.isInteger(n) || n < 1 || n > 10000)) {
    throw new Error('The strand counts do not match this bridge. Return to the drawing and try again.');
  }
  if (!Number.isFinite(maxStrandLengthM) || maxStrandLengthM <= 0) throw new Error('Invalid stock strand length.');
  const factor = 1000 / span;
  const points = joints.map(p => ({ x: (p.x - joints[0].x) * factor, y: (joints[0].y - p.y) * factor }));
  const ids = new Set<number>();
  const parts = members.map((member, i) => {
    if (![member.a, member.b].every(n => Number.isInteger(n) && n >= 0 && n < points.length) || member.a === member.b ||
        !Number.isInteger(member.number) || member.number < 1 || ids.has(member.number)) throw new Error('Invalid member identification.');
    ids.add(member.number);
    const a = points[member.a], b = points[member.b], lengthMm = Math.hypot(b.x - a.x, b.y - a.y);
    if (!Number.isFinite(lengthMm) || lengthMm <= 0) throw new Error('A member has invalid length.');
    return { ...member, count: counts[i], lengthMm, overLength: lengthMm > maxStrandLengthM * 1000 * (1 + 1e-9) };
  });
  // Find a common grid dividing the standard 5 mm major squares and all joint coordinates.
  // Reject an unreadably fine/noncommensurate grid rather than distorting the bridge.
  const gcd = (a: number, b: number): number => { while (b) { const t = b; b = a % b; a = t; } return a; };
  let units = 5000;
  for (const point of points) for (const coordinate of [point.x, point.y]) {
    const integer = Math.round(coordinate * 1000);
    if (Math.abs(coordinate - integer / 1000) > 1e-6) throw new Error('These joints cannot align to a practical graph-paper grid without moving them.');
    units = gcd(units, Math.abs(integer));
  }
  const gridMm = units / 1000;
  if (gridMm < 0.5) throw new Error('Joint alignment requires grid squares smaller than 0.5 mm. Use a coarser drafting grid; the export will not move your joints.');
  return { points, parts, gridMm, maxStrandLengthMm: maxStrandLengthM * 1000,
    totalPieces: parts.reduce((sum, p) => sum + p.count, 0),
    totalLengthMm: parts.reduce((sum, p) => sum + p.count * p.lengthMm, 0) };
}
export type PastaBuild = ReturnType<typeof makePastaBuild>;

/** Fixed 1:1 tiles; each tile uses the same global graph-paper phase. */
export function pastaBuildTiles(model: PastaBuild, pageWidth: number, pageHeight: number) {
  const width = Math.floor((pageWidth - 2 * BUILD_MARGIN_MM) / 5) * 5;
  const height = Math.floor((pageHeight - 2 * BUILD_MARGIN_MM - 24) / 5) * 5;
  if (![width, height].every(Number.isFinite) || width <= BUILD_OVERLAP_MM || height <= BUILD_OVERLAP_MM) throw new Error('Paper is too small.');
  const x0 = Math.floor(Math.min(...model.points.map(p => p.x)) / 5) * 5 - 10;
  const y0 = Math.floor(Math.min(...model.points.map(p => p.y)) / 5) * 5 - 10;
  const x1 = Math.ceil(Math.max(...model.points.map(p => p.x)) / 5) * 5 + 10;
  const y1 = Math.ceil(Math.max(...model.points.map(p => p.y)) / 5) * 5 + 10;
  const columns = Math.max(1, Math.ceil((x1 - x0 - BUILD_OVERLAP_MM) / (width - BUILD_OVERLAP_MM)));
  const rows = Math.max(1, Math.ceil((y1 - y0 - BUILD_OVERLAP_MM) / (height - BUILD_OVERLAP_MM)));
  if (rows * columns > 200) throw new Error('This geometry needs more than 200 full-scale sheets. Check the model proportions.');
  const tiles = Array.from({ length: rows * columns }, (_, i) => {
    const row = Math.floor(i / columns), column = i % columns;
    return { row, column, x: x0 + column * (width - BUILD_OVERLAP_MM),
      y: y0 + row * (height - BUILD_OVERLAP_MM), width, height };
  });
  return { tiles, rows, columns };
}
