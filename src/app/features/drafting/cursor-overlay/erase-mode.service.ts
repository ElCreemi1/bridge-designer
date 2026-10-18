/* Copyright (c) 2025-2026 Gene Ressler
   SPDX-License-Identifier: GPL-3.0-or-later */
import { EventEmitter, Injectable } from '@angular/core';
import { Joint } from '../../../shared/classes/joint.model';
import { Member } from '../../../shared/classes/member.model';
import { HotElementService } from '../shared/hot-element.service';
import { Utility } from '../../../shared/classes/utility';
import { HotElementDragService } from '../shared/hot-element-drag.service';

@Injectable({ providedIn: 'root' })
export class EraseModeService {
  private _ctx: CanvasRenderingContext2D | undefined;
  private deleteRequest: EventEmitter<Joint | Member> | undefined;
  private touch: { id: number; x: number; y: number } | undefined;
  constructor(
    private readonly hotElementDragService: HotElementDragService,
    private readonly hotElementService: HotElementService,
  ) {}
  public initialize(ctx: CanvasRenderingContext2D, deleteRequest: EventEmitter<Joint | Member>): EraseModeService {
    this.touch = undefined; this._ctx = ctx; this.deleteRequest = deleteRequest; return this;
  }
  private get ctx(): CanvasRenderingContext2D { return Utility.assertNotUndefined(this._ctx); }
  private eraseHot(): void {
    const hot = this.hotElementService.hotElement;
    this.hotElementService.clearRenderedHotElement(this.ctx);
    if (hot instanceof Joint || hot instanceof Member) this.deleteRequest?.emit(hot);
  }
  handlePointerDown(event: PointerEvent): void {
    if (event.buttons !== 1 || this.hotElementDragService.isDragging()) return;
    if (event.pointerType === 'touch') {
      if (event.isPrimary) this.touch = { id: event.pointerId, x: event.clientX, y: event.clientY };
      return;
    }
    this.eraseHot();
  }
  handlePointerMove(event: PointerEvent): void {
    if (!this.hotElementDragService.isDragging()) {
      this.hotElementService.updateRenderedHotElement(this.ctx, event.offsetX, event.offsetY, { excludeFixedJoints: true });
    }
  }
  handlePointerUp(event: PointerEvent): void {
    const touch = this.touch; this.touch = undefined;
    if (!touch || touch.id !== event.pointerId || this.hotElementDragService.isDragging(event)) return;
    if (Math.hypot(event.clientX - touch.x, event.clientY - touch.y) > 12) return;
    const host = this.ctx.canvas.closest('.wrapper') ?? this.ctx.canvas;
    const bounds = host.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX >= bounds.right || event.clientY < bounds.top || event.clientY >= bounds.bottom) return;
    this.handlePointerMove(event);
    this.eraseHot();
  }
  handlePointerCancel(_event: PointerEvent): void { this.touch = undefined; }
}
