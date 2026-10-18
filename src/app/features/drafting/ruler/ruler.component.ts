/* Copyright (c) 2025-2026 Gene Ressler
   SPDX-License-Identifier: GPL-3.0-or-later */

import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, HostBinding, Input, ViewChild } from '@angular/core';
import { ViewportTransform2D } from '../../../shared/services/viewport-transform.service';
import { CommonModule } from '@angular/common';
import { Graphics } from '../../../shared/classes/graphics';
import { BridgeService } from '../../../shared/services/bridge.service';
import { DesignGridDensity, DesignGridService } from '../../../shared/services/design-grid.service';
import { EventBrokerService } from '../../../shared/services/event-broker.service';

@Component({
    selector: 'ruler',
    imports: [CommonModule],
    templateUrl: './ruler.component.html',
    styleUrl: './ruler.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class RulerComponent implements AfterViewInit {
  readonly thickness = 30;
  // Cover both orientations so rotating a phone after startup does not truncate the ruler.
  readonly screenWidth = Math.max(screen.availWidth, screen.availHeight);
  readonly screenHeight = Math.max(screen.availWidth, screen.availHeight);

  @Input({ required: true }) position!: 'bottom' | 'left';
  @ViewChild('ruler') ruler!: ElementRef<HTMLCanvasElement>;
  @HostBinding('style.display') display: string = 'block';

  constructor(
    private readonly bridgeService: BridgeService,
    private readonly designGridService: DesignGridService,
    private readonly eventBrokerService: EventBrokerService,
    private readonly viewportTransform: ViewportTransform2D,
  ) {}

  public set visible(value: boolean) {
    this.display = value ? 'block' : 'none';
  }

  private get ctx(): CanvasRenderingContext2D {
    return Graphics.getContext(this.ruler);
  }

  private render(ctx: CanvasRenderingContext2D): void {
    const savedTextAlign = ctx.textAlign;
    const savedTextBaseline = ctx.textBaseline;

    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    if (this.position === 'bottom') {
      this.renderBottomRuler(ctx);
    } else {
      this.renderLeftRuler(ctx);
    }

    ctx.textBaseline = savedTextBaseline;
    ctx.textAlign = savedTextAlign;
  }

  private renderBottomRuler(ctx: CanvasRenderingContext2D) {
    const grid = this.designGridService.grid;
    const extent = this.bridgeService.siteInfo.spanExtent;
    const startGrid = grid.xformWorldToGrid(extent.x0);
    const endGrid = grid.xformWorldToGrid(extent.x1);
    const gridIncrement = grid.snapMultiple;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let xGrid: number = startGrid; xGrid <= endGrid; xGrid += gridIncrement) {
      this.renderTopTick(ctx, xGrid);
    }
  }

  private renderLeftRuler(ctx: CanvasRenderingContext2D) {
    const grid = this.designGridService.grid;
    const extent = this.bridgeService.siteInfo.spanExtent;
    const startGrid = grid.xformWorldToGrid(extent.y0);
    const endGrid = grid.xformWorldToGrid(extent.y1);
    const gridIncrement = grid.snapMultiple;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let yGrid: number = startGrid; yGrid <= endGrid; yGrid += gridIncrement) {
      this.renderRightTick(ctx, yGrid);
    }
  }

  /**
   * Tick label, or undefined for none. Steel sites label every coarse tick in meters. The pasta
   * site labels multiples of 5, 10, 20 or 50 cm, whichever keeps labels readable (coarse ticks are 2.5 cm apart).
   */
  private label(world: number, density: DesignGridDensity): string | undefined {
    if (density !== DesignGridDensity.COARSE) return undefined;
    const conditions = this.bridgeService.designConditions;
    if (!conditions.isPasta) return world.toFixed();
    const cm = Math.round(world * conditions.displayScale * 1000) / 10;
    // Widen the label step on small screens so labels stay at least ~28 px apart.
    const pxPerCm = this.viewportTransform.worldToViewportDistance(1 / (100 * conditions.displayScale));
    const step = [5, 10, 20, 50].find(s => s * pxPerCm >= 28) ?? 100;
    return Math.abs(cm % step) < 1e-9 ? cm.toFixed() : undefined;
  }

  private getTickSize(density: number): number {
    return [8, 6, 3][density] || 0;
  }

  private renderTopTick(ctx: CanvasRenderingContext2D, xGrid: number) {
    const density = DesignGridService.getDensityOfGrid(xGrid);
    const xWorld = this.designGridService.grid.xformGridToWorld(xGrid);
    const xViewport = this.viewportTransform.worldToViewportX(xWorld);
    const yTick = this.getTickSize(density);
    ctx.beginPath();
    ctx.moveTo(xViewport, 0);
    ctx.lineTo(xViewport, yTick);
    ctx.stroke();
    const label = this.label(xWorld, density);
    if (label !== undefined) {
      ctx.fillText(label, xViewport, yTick + 2);
    }
  }

  private renderRightTick(ctx: CanvasRenderingContext2D, yGrid: number) {
    const density = DesignGridService.getDensityOfGrid(yGrid);
    const yWorld = this.designGridService.grid.xformGridToWorld(yGrid);
    const yViewport = this.viewportTransform.worldToViewportY(yWorld);
    const xTick = this.thickness - this.getTickSize(density);
    ctx.beginPath();
    ctx.moveTo(this.thickness, yViewport);
    ctx.lineTo(xTick, yViewport);
    ctx.stroke();
    const label = this.label(yWorld, density);
    if (label !== undefined) {
      ctx.fillText(label, xTick - 2, yViewport);
    }
  }

  ngAfterViewInit(): void {
    this.render(this.ctx);
    this.eventBrokerService.draftingPanelInvalidation.subscribe(info => {
      if (info.data === 'viewport') {
        // Skip graphic-only invalidations.
        this.render(this.ctx);
      }
    });
    this.eventBrokerService.gridDensityChange.subscribe(() => this.render(this.ctx));
  }
}
