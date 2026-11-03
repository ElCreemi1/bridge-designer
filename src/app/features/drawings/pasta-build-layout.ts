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
export type BuildBounds = { xMin: number; xMax: number; yMin: number; yMax: number };

/** Match the full-size member badges and joint labels, including their ink bounds. */
export function pastaBuildInkBounds(model: PastaBuild, textWidth: (text: string, size: number) => number): BuildBounds {
  const bounds = { xMin: Infinity, xMax: -Infinity, yMin: Infinity, yMax: -Infinity };
  const include = (x: number, y: number, halfWidth: number, halfHeight: number) => {
    bounds.xMin = Math.min(bounds.xMin, x - halfWidth); bounds.xMax = Math.max(bounds.xMax, x + halfWidth);
    bounds.yMin = Math.min(bounds.yMin, y - halfHeight); bounds.yMax = Math.max(bounds.yMax, y + halfHeight);
  };
  model.points.forEach((p, i) => {
    include(p.x, p.y, 0.8, 0.8);
    const width = textWidth(`J${i + 1}`, 5);
    include(p.x + 1 + width / 2, p.y - 1.8, width / 2 + 0.2, 1.2);
  });
  model.parts.forEach((part, i) => {
    const a = model.points[part.a], b = model.points[part.b], length = part.lengthMm, offset = (i % 2 ? 1 : -1) * 3;
    const x = (a.x + b.x) / 2 - (b.y - a.y) / length * offset;
    const y = (a.y + b.y) / 2 + (b.x - a.x) / length * offset;
    include(x, y, (textWidth(`M${part.number} x${part.count}`, 6) + 1.2) / 2 + 0.2, 1.7);
  });
  return bounds;
}

/** Group equal computed lengths, not merely equal rounded labels. */
export function pastaCutList(model: PastaBuild) {
  const rows: { lengthMm: number; quantity: number; overLength: boolean; labelMm: string }[] = [];
  for (const part of model.parts.slice().sort((a, b) => a.lengthMm - b.lengthMm)) {
    const last = rows[rows.length - 1];
    if (last && Math.abs(last.lengthMm - part.lengthMm) <= 1e-6) {
      last.quantity += part.count; last.overLength = last.overLength || part.overLength;
    } else rows.push({ lengthMm: part.lengthMm, quantity: part.count, overLength: part.overLength, labelMm: '' });
  }
  let digits = 1;
  while (digits < 6 && new Set(rows.map(row => row.lengthMm.toFixed(digits))).size !== rows.length) digits++;
  rows.forEach(row => row.labelMm = row.lengthMm.toFixed(digits));
  return rows;
}

/** Fixed 1:1 tiles. Do not create a continuation solely for trailing margin. */
export function pastaBuildTiles(model: PastaBuild, pageWidth: number, pageHeight: number, ink?: BuildBounds) {
  const width = Math.floor((pageWidth - 2 * BUILD_MARGIN_MM) / 5) * 5;
  const height = Math.floor((pageHeight - 2 * BUILD_MARGIN_MM - 24) / 5) * 5;
  if (![width, height].every(Number.isFinite) || width <= BUILD_OVERLAP_MM || height <= BUILD_OVERLAP_MM) throw new Error('Paper is too small.');
  const minX = Math.min(...model.points.map(p => p.x)), minY = Math.min(...model.points.map(p => p.y));
  const maxX = Math.max(...model.points.map(p => p.x)), maxY = Math.max(...model.points.map(p => p.y));
  const content = ink ?? { xMin: minX - 1, xMax: maxX + 1, yMin: minY - 1, yMax: maxY + 1 };
  if (!Object.values(content).every(Number.isFinite) || content.xMax < content.xMin || content.yMax < content.yMin) throw new Error('Invalid drawing bounds.');
  const x0 = Math.floor(Math.min(minX - 10, content.xMin) / 5) * 5;
  const y0 = Math.floor(Math.min(minY - 10, content.yMin) / 5) * 5;
  const x1 = Math.ceil(Math.max(maxX, content.xMax) / 5) * 5;
  const y1 = Math.ceil(Math.max(maxY, content.yMax) / 5) * 5;
  const columns = Math.max(1, Math.ceil((x1 - x0 - BUILD_OVERLAP_MM - 1e-7) / (width - BUILD_OVERLAP_MM)));
  const rows = Math.max(1, Math.ceil((y1 - y0 - BUILD_OVERLAP_MM - 1e-7) / (height - BUILD_OVERLAP_MM)));
  if (rows * columns > 200) throw new Error('This geometry needs more than 200 full-scale sheets. Check the model proportions.');
  const tiles = Array.from({ length: rows * columns }, (_, i) => {
    const row = Math.floor(i / columns), column = i % columns;
    return { row, column, x: x0 + column * (width - BUILD_OVERLAP_MM),
      y: y0 + row * (height - BUILD_OVERLAP_MM), width, height };
  });
  return { tiles, rows, columns };
}
