/* SPDX-License-Identifier: GPL-3.0-or-later */
export const MAX_DRAWN_STRANDS = 19;

/** Schematic cross-section offsets in strand-diameter units; never solver input. */
export function strandOffsets(count: number): { y: number; z: number }[] {
  if (!Number.isInteger(count) || count < 1 || count > 10000) throw new Error('Invalid strand count.');
  const drawn = Math.min(count, MAX_DRAWN_STRANDS);
  if (drawn === 1) return [{ y: 0, z: 0 }];
  const spread = Math.sqrt(count / drawn);
  const offsets = Array.from({ length: drawn }, (_, i) => {
    const angle = i * Math.PI * (3 - Math.sqrt(5));
    const radius = 1.15 * Math.sqrt(i) * spread;
    return { y: radius * Math.cos(angle), z: radius * Math.sin(angle) };
  });
  const cy = offsets.reduce((sum, p) => sum + p.y, 0) / drawn;
  const cz = offsets.reduce((sum, p) => sum + p.z, 0) / drawn;
  return offsets.map(p => ({ y: p.y - cy, z: p.z - cz }));
}

/** Project with the SAME perspective/view matrix and CSS viewport as the 3D scene. */
export function projectStrandPoint(matrix: ArrayLike<number>, x: number, y: number, z: number,
  width: number, height: number): { x: number; y: number; depth: number } | undefined {
  if (matrix.length !== 16 || ![x, y, z, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return undefined;
  const w = matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15];
  if (!Number.isFinite(w) || w <= 1e-9) return undefined;
  const px = (matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12]) / w;
  const py = (matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13]) / w;
  const depth = (matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14]) / w;
  if (![px, py, depth].every(Number.isFinite) || depth < -1 || depth > 1) return undefined;
  return { x: (px + 1) * width / 2, y: (1 - py) * height / 2, depth };
}
