/* Copyright (c) 2025-2026 Gene Ressler
   SPDX-License-Identifier: GPL-3.0-or-later */
import { EventEmitter, Injectable } from '@angular/core';
import { HotElementService } from './hot-element.service';
import { Utility } from '../../../shared/classes/utility';

export interface Draggable { draggableService: DraggableService; }
export interface DraggableService {
  move(ctx: CanvasRenderingContext2D, draggable: any, x: number, y: number, start?: boolean): void;
  clear(ctx: CanvasRenderingContext2D, end?: boolean): void;
}

@Injectable({ providedIn: 'root' })
export class HotElementDragService {
  private _ctx: CanvasRenderingContext2D | undefined;
  private dragging: Draggable | undefined;
  private pointerId: number | undefined;
  private dragEndEvent: PointerEvent | null = null;
  private dragCursorActive: EventEmitter<Draggable | undefined> | undefined;
  constructor(private readonly hotElementService: HotElementService) {}
  public initialize(ctx: CanvasRenderingContext2D, dragCursorActive: EventEmitter<Draggable | undefined>): HotElementDragService {
    this._ctx = ctx; this.dragCursorActive = dragCursorActive; return this;
  }
  public isDragging(event?: PointerEvent): boolean { return this.dragging !== undefined || event === this.dragEndEvent; }
  handlePointerDown(event: PointerEvent): void {
    const hot = this.hotElementService.hotElement;
    if (event.buttons !== 1 || !hot || !('draggableService' in hot)) return;
    this.ctx.canvas.setPointerCapture(event.pointerId);
    this.pointerId = event.pointerId;
    this.dragging = hot as unknown as Draggable;
    this.dragging.draggableService.move(this.ctx, this.dragging, event.offsetX, event.offsetY, true);
    this.dragCursorActive?.emit(this.dragging);
  }
  handlePointerMove(event: PointerEvent): void {
    if (this.dragging) this.dragging.draggableService.move(this.ctx, this.dragging, event.offsetX, event.offsetY, false);
  }
  private finish(event: PointerEvent): void {
    const dragging = this.dragging;
    if (!dragging) return;
    const id = this.pointerId;
    this.dragEndEvent = event;
    this.dragCursorActive?.emit(undefined);
    dragging.draggableService.clear(this.ctx, true);
    this.dragging = undefined; this.pointerId = undefined;
    if (id !== undefined && this.ctx.canvas.hasPointerCapture(id)) this.ctx.canvas.releasePointerCapture(id);
  }
  handlePointerUp(event: PointerEvent): void { if (event.button === 0) this.finish(event); }
  handlePointerCancel(event: PointerEvent): void { this.finish(event); }
  handlePointerLeave(): void { this.hotElementService.clearRenderedHotElement(this.ctx); }
  private get ctx(): CanvasRenderingContext2D { return Utility.assertNotUndefined(this._ctx); }
}
