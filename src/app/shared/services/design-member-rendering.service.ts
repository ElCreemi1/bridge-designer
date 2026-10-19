/* Copyright (c) 2025-2026 Gene Ressler
   SPDX-License-Identifier: GPL-3.0-or-later */
import { Injectable } from '@angular/core';
import { BridgeService } from './bridge.service';
import { PastaStrandSessionService, pastaBundleWidth } from '../../features/center-load/pasta-strand-session.service';
import { Geometry, Graphics, Point2D, Point2DInterface, Rectangle2D } from '../classes/graphics';
import { Member } from '../classes/member.model';
import { DesignJointRenderingService } from './design-joint-rendering.service';
import { InventoryService, Shape } from './inventory.service';
import { ViewportTransform2D } from './viewport-transform.service';
import { EventBrokerService, EventOrigin } from './event-broker.service';
import { AnalysisValidityService } from '../../features/controls/management/analysis-validity.service';

const enum Failure { NONE, TENSION, COMPRESSION }
const FAILURE_COLOR_TRANSFORMS = [[1, 0], [1, 1], [-1, -0.5]];

@Injectable({ providedIn: 'root' })
export class DesignMemberRenderingService {
  private static readonly OUTER_PALETTE = [DesignMemberRenderingService.createColors(0, 0), DesignMemberRenderingService.createColors(0, 0.9)];
  private static readonly HOT_OUTER_PALETTE = [DesignMemberRenderingService.createColors(0.3, 0), DesignMemberRenderingService.createColors(0.3, 0.9)];
  private static readonly INNER_PALETTE = [DesignMemberRenderingService.createInnerColors(0, 0), DesignMemberRenderingService.createInnerColors(0, 0.9)];
  private static readonly HOT_INNER_PALETTE = [DesignMemberRenderingService.createInnerColors(0.3, 0), DesignMemberRenderingService.createInnerColors(0.3, 0.9)];
  private readonly lineWidths: { outer: number; inner: number }[];
  private readonly pointA = new Point2D();
  private readonly pointB = new Point2D();
  private readonly labelRectangle = Rectangle2D.createEmpty();
  private showMemberNumbers = false;

  constructor(
    private readonly analysisValidityService: AnalysisValidityService,
    private readonly bridgeService: BridgeService,
    private readonly pastaStrands: PastaStrandSessionService,
    inventoryService: InventoryService,
    private readonly viewportTransform: ViewportTransform2D,
    eventBrokerService: EventBrokerService,
  ) {
    this.lineWidths = new Array(inventoryService.getShapes(0).length);
    for (let i = 0; i < this.lineWidths.length; i++) {
      const outer = DesignMemberRenderingService.getShapeStrokeWidth(inventoryService.getShape(0, i));
      let inner = 0.6 * outer;
      if (outer - inner < 2) inner = Math.max(1, outer - 2);
      this.lineWidths[i] = { outer, inner };
    }
    eventBrokerService.memberNumbersToggle.subscribe(info => {
      this.showMemberNumbers = info.data;
      eventBrokerService.draftingPanelInvalidation.next({ origin: EventOrigin.SERVICE, data: 'graphic' });
    });
  }
  public render(ctx: CanvasRenderingContext2D, member: Member, selected: boolean, mark: string | undefined): void {
    this.renderInternal(ctx, member, selected, mark, DesignMemberRenderingService.OUTER_PALETTE, DesignMemberRenderingService.INNER_PALETTE);
  }
  public renderHot(ctx: CanvasRenderingContext2D, member: Member, selected: boolean, mark: string | undefined): void {
    this.renderInternal(ctx, member, selected, mark, DesignMemberRenderingService.HOT_OUTER_PALETTE, DesignMemberRenderingService.HOT_INNER_PALETTE);
  }
  public clear(ctx: CanvasRenderingContext2D, member: Member): void {
    this.viewportTransform.worldToViewportPoint(this.pointA, member.a);
    this.viewportTransform.worldToViewportPoint(this.pointB, member.b);
    const pad = Math.max(this.bridgeService.designConditions.isPasta ? 64 : 0,
      2 * Math.max(DesignMemberRenderingService.getShapeStrokeWidth(member.shape), DesignJointRenderingService.JOINT_RADIUS_VIEWPORT));
    const rectangle = Rectangle2D.fromDiagonalPoints(this.pointA, this.pointB).pad(pad, pad);
    ctx.clearRect(rectangle.x0, rectangle.y0, rectangle.width, rectangle.height);
  }
  public getMemberWidthWorld(member: Member, minWidthViewport?: number): number {
    const visualWidth = this.bridgeService.designConditions.isPasta
      ? pastaBundleWidth(this.pastaStrands.countFor(member)) : this.lineWidths[member.shape.sizeIndex].outer;
    const width = Math.max(visualWidth, minWidthViewport ?? 0);
    return this.viewportTransform.viewportToWorldDistance(width);
  }
  private static getShapeStrokeWidth(shape: Shape): number {
    // Half the former visual stroke (0.07 and minimum 4). This does not change section properties.
    // Hot-element picking still requests its independent 10px minimum selection tolerance.
    return Math.max(shape.width * 0.035, 2);
  }
  private static createColors(intensification = 0, blueification = 0): string[][] {
    return FAILURE_COLOR_TRANSFORMS.map(([a, b]) => [
      Graphics.computeColor(96, 96, 96, intensification, a * blueification + b),
      Graphics.computeColor(64, 64, 64, intensification, a * blueification + b),
      Graphics.computeColor(192, 192, 192, intensification, a * blueification + b),
    ]);
  }
  private static createInnerColors(intensification = 0, blueification = 0): string[][] {
    return FAILURE_COLOR_TRANSFORMS.map(([a, b]) => [
      Graphics.computeColor(192, 192, 192, intensification, a * blueification + b),
      Graphics.computeColor(128, 128, 128, intensification, a * blueification + b),
      Graphics.computeColor(224, 224, 224, intensification, a * blueification + b),
    ]);
  }
  private getFailure(member: Member): Failure {
    if (!this.analysisValidityService.isLastAnalysisValid) return Failure.NONE;
    if (member.tensionForceStrengthRatio > 1) return Failure.TENSION;
    if (member.compressionForceStrengthRatio > 1) return Failure.COMPRESSION;
    return Failure.NONE;
  }
  private renderInternal(ctx: CanvasRenderingContext2D, member: Member, selected: boolean, mark: string | undefined, outerPalette: string[][][], innerPalette: string[][][]): void {
    const failure = this.bridgeService.designConditions.isPasta ? Failure.NONE : this.getFailure(member);
    const outer = outerPalette[+selected][failure][member.material.index];
    if (this.bridgeService.designConditions.isPasta) { this.renderPastaMember(ctx, member, outer, mark); return; }
    const inner = member.shape.section.shortName === 'Tube' ? innerPalette[+selected][failure][member.shape.section.index] : undefined;
    this.renderInWorldCoords(ctx, member.a, member.b, member.shape.sizeIndex, outer, inner,
      mark,
      this.showMemberNumbers || selected ? member.number : undefined);
  }
  /** Parallel strokes are schematic; the badge always reports the exact strand count. */
  private renderPastaMember(ctx: CanvasRenderingContext2D, member: Member, color: string, mark?: string): void {
    this.viewportTransform.worldToViewportPoint(this.pointA, member.a);
    this.viewportTransform.worldToViewportPoint(this.pointB, member.b);
    const a = this.pointA, b = this.pointB, count = this.pastaStrands.countFor(member);
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length < 1e-9) return;
    const nx = -(b.y - a.y) / length, ny = (b.x - a.x) / length;
    const width = pastaBundleWidth(count), drawn = Math.min(count, 7);
    ctx.save(); ctx.strokeStyle = color; ctx.lineCap = 'round'; ctx.lineWidth = count === 1 ? 2 : 1.2;
    ctx.setLineDash([]);
    for (let i = 0; i < drawn; i++) {
      const offset = drawn === 1 ? 0 : (i / (drawn - 1) - 0.5) * (width - 1.2);
      ctx.beginPath(); ctx.moveTo(a.x + nx * offset, a.y + ny * offset);
      ctx.lineTo(b.x + nx * offset, b.y + ny * offset); ctx.stroke();
    }
    if (mark) {
      Graphics.setTickLineDash(ctx, length, [2, 10]); ctx.strokeStyle = mark; ctx.lineWidth = width + 4;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    ctx.restore();
    this.renderMemberNumber(ctx, a, b, `M${member.number} ×${count}`, mark || color);
  }
  private renderInWorldCoords(ctx: CanvasRenderingContext2D, a: Point2DInterface, b: Point2DInterface, size: number, color: string, inner?: string, mark?: string, number?: number): void {
    this.viewportTransform.worldToViewportPoint(this.pointA, a);
    this.viewportTransform.worldToViewportPoint(this.pointB, b);
    this.renderInViewportCoords(ctx, this.pointA, this.pointB, size, color, inner, mark, number);
  }
  private renderInViewportCoords(ctx: CanvasRenderingContext2D, a: Point2DInterface, b: Point2DInterface, size: number, color: string, inner?: string, mark?: string, number?: number): void {
    const stroke = ctx.strokeStyle, width = ctx.lineWidth, cap = ctx.lineCap;
    const widths = this.lineWidths[size];
    const line = () => { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); };
    ctx.strokeStyle = color; ctx.lineWidth = widths.outer; ctx.lineCap = 'round'; line();
    if (inner) { ctx.strokeStyle = inner; ctx.lineWidth = widths.inner; line(); }
    if (mark) {
      const dash = ctx.getLineDash();
      Graphics.setTickLineDash(ctx, Geometry.distance2DPoints(a, b), [2, 10]);
      ctx.strokeStyle = mark; ctx.lineWidth = widths.outer + 4; line(); ctx.setLineDash(dash);
    }
    ctx.lineCap = cap; ctx.lineWidth = width; ctx.strokeStyle = stroke;
    if (number) this.renderMemberNumber(ctx, a, b, number, color);
  }
  private renderMemberNumber(ctx: CanvasRenderingContext2D, a: Point2DInterface, b: Point2DInterface, memberNumber: number | string, borderColor: string): void {
    const font = ctx.font, align = ctx.textAlign, baseline = ctx.textBaseline;
    const fill = ctx.fillStyle, stroke = ctx.strokeStyle;
    const x = (a.x + b.x) / 2, y = (a.y + b.y) / 2 + 1;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '12px sans-serif';
    const number = memberNumber.toString(), metrics = ctx.measureText(number);
    this.labelRectangle.x0 = x - metrics.actualBoundingBoxLeft;
    this.labelRectangle.width = metrics.width;
    this.labelRectangle.y0 = y - metrics.actualBoundingBoxAscent;
    this.labelRectangle.height = metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent;
    this.labelRectangle.pad(2, 2);
    ctx.beginPath(); ctx.strokeStyle = borderColor;
    ctx.rect(this.labelRectangle.x0, this.labelRectangle.y0, this.labelRectangle.width, this.labelRectangle.height);
    ctx.fillStyle = 'yellow'; ctx.fill(); ctx.stroke(); ctx.fillStyle = 'black'; ctx.fillText(number, x, y);
    ctx.strokeStyle = stroke; ctx.fillStyle = fill; ctx.textBaseline = baseline; ctx.textAlign = align; ctx.font = font;
  }
}
