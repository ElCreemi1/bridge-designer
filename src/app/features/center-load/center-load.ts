/* Copyright (c) 2025-2026 Gene Ressler
   SPDX-License-Identifier: GPL-3.0-or-later */
export type CenterLoadShare = { jointIndex: number; forceKN: number };

/** Equivalent joint forces for a point load on a simply supported deck panel. */
export function centerLoadShares(deckX: readonly number[], forceKN: number): CenterLoadShare[] {
  if (!Number.isFinite(forceKN) || forceKN < 0) throw new Error('Load must be a finite nonnegative force in kN.');
  if (deckX.length < 3 || deckX.some((x, i) => !Number.isFinite(x) || (i > 0 && x <= deckX[i - 1]))) {
    throw new Error('Center loading requires at least three ordered deck joints.');
  }
  const midpoint = (deckX[0] + deckX[deckX.length - 1]) / 2;
  const tolerance = 1e-9 * Math.max(1, deckX[deckX.length - 1] - deckX[0]);
  const exact = deckX.findIndex(x => Math.abs(x - midpoint) <= tolerance);
  if (exact >= 0) return [{ jointIndex: exact, forceKN }];
  const right = deckX.findIndex(x => x > midpoint);
  const left = right - 1;
  const fraction = (midpoint - deckX[left]) / (deckX[right] - deckX[left]);
  return [{ jointIndex: left, forceKN: forceKN * (1 - fraction) }, { jointIndex: right, forceKN: forceKN * fraction }];
}
