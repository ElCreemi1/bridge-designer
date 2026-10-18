/* Copyright (c) 2026 ElCreemi1
   SPDX-License-Identifier: GPL-3.0-or-later */

import { DesignConditions } from '../services/design-conditions.service';
import { ViewportTransform2D } from '../services/viewport-transform.service';

/** Colors for the pasta site drawing. */
const TABLE_FILL = '#e4d3b5';
const TABLE_STROKE = '#8a6d45';
const DECK_STROKE = '#9a9a9a';
const SUPPORT_STROKE = '#333333';
const SUPPORT_FILL = '#bfbfbf';

/** Height of support symbols below the deck joints, world meters (1.2 = 3 cm at pasta scale). */
const SUPPORT_HEIGHT = 1.2;

/**
 * Draws the 1.00 m pasta site: two tables whose edges carry the end deck joints, a pin support
 * on the left, a roller on the right, and a light deck line through the deck joints.
 */
export function renderPastaSite(
  ctx: CanvasRenderingContext2D,
  conditions: DesignConditions,
  transform: ViewportTransform2D,
  window: { x0: number; y0: number; width: number; height: number },
): void {
  ctx.save();
  const xLeft = conditions.xLeftmostDeckJoint;
  const xRight = conditions.xRightmostDeckJoint;
  const yTableTop = -SUPPORT_HEIGHT;
  const yBottom = window.y0 - 1;
  const vx = (x: number) => transform.worldToViewportX(x);
  const vy = (y: number) => transform.worldToViewportY(y);

  // Tables.
  ctx.fillStyle = TABLE_FILL;
  ctx.strokeStyle = TABLE_STROKE;
  ctx.lineWidth = 1;
  const drawTable = (x0: number, x1: number) => {
    const left = vx(x0), right = vx(x1), top = vy(yTableTop), bottom = vy(yBottom);
    ctx.fillRect(left, top, right - left, bottom - top);
    ctx.beginPath();
    ctx.moveTo(left, top);
    ctx.lineTo(right, top);
    ctx.moveTo(x0 < xLeft ? right : left, top);
    ctx.lineTo(x0 < xLeft ? right : left, bottom);
    ctx.stroke();
  };
  drawTable(window.x0 - 1, xLeft);
  drawTable(xRight, window.x0 + window.width + 1);

  // Deck line through the loaded joints.
  ctx.strokeStyle = DECK_STROKE;
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.moveTo(vx(xLeft), vy(0));
  ctx.lineTo(vx(xRight), vy(0));
  ctx.stroke();
  ctx.setLineDash([]);

  // Supports: pin on the left, roller on the right.
  const halfBase = transform.worldToViewportDistance(SUPPORT_HEIGHT * 0.6);
  const height = transform.worldToViewportDistance(SUPPORT_HEIGHT);
  ctx.strokeStyle = SUPPORT_STROKE;
  ctx.fillStyle = SUPPORT_FILL;
  ctx.lineWidth = 1;
  const triangle = (x: number, h: number) => {
    const px = vx(x), py = vy(0);
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px - halfBase, py + h);
    ctx.lineTo(px + halfBase, py + h);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  };
  triangle(xLeft, height);
  const rollerRadius = Math.max(1.5, height * 0.18);
  triangle(xRight, height - 2 * rollerRadius);
  for (const dx of [-0.5, 0.5]) {
    ctx.beginPath();
    ctx.arc(vx(xRight) + dx * halfBase, vy(0) + height - rollerRadius, rollerRadius, 0, 2 * Math.PI);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}
