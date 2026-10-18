/* Copyright (c) 2025-2026 Gene Ressler
   SPDX-License-Identifier: GPL-3.0-or-later */

import { EventEmitter, Injectable } from '@angular/core';
import { Joint } from '../../../shared/classes/joint.model';
import { JointCursorService } from '../shared/joint-cursor.service';
import { HotElementService } from '../shared/hot-element.service';
import { Utility } from '../../../shared/classes/utility';
import { HotElementDragService } from '../shared/hot-element-drag.service';
import { GuideKnob } from '../shared/guides.service';
import { Labels } from '../shared/labels.service';
import { EventBrokerService } from '../../../shared/services/event-broker.service';

@Injectable({ providedIn: 'root' })
export class JointsModeService {
  private _ctx: CanvasRenderingContext2D | undefined;
  private addJointRequest: EventEmitter<Joint> | undefined;
  private touchPlacement: { pointerId: number; canvas: HTMLCanvasElement } | undefined;
  private readonly configuredCanvases = new WeakSet<HTMLCanvasElement>();

  constructor(
    private readonly hotElementDragService: HotElementDragService,
    private readonly hotElementService: HotElementService,
    private readonly jointCursorService: JointCursorService,
    eventBrokerService: EventBrokerService,
  ) {
    eventBrokerService.editModeSelection.subscribe(() => this.cancelTouchPlacement());
    eventBrokerService.loadBridgeCompletion.subscribe(() => this.cancelTouchPlacement());
    eventBrokerService.draftingViewportPendingChange.subscribe(() => this.cancelTouchPlacement());
  }

  public initialize(ctx: CanvasRenderingContext2D, addJointRequest: EventEmitter<Joint>): JointsModeService {
    this.cancelTouchPlacement();
    this._ctx = ctx;
    this.addJointRequest = addJointRequest;
    const canvas = ctx.canvas;
    if (!this.configuredCanvases.has(canvas)) {
      this.configuredCanvases.add(canvas);
      canvas.addEventListener('lostpointercapture', event => {
        if (this.touchPlacement?.canvas === canvas && this.touchPlacement.pointerId === event.pointerId) {
          this.cancelTouchPlacement();
        }
      });
      canvas.addEventListener('contextmenu', event => {
        if (this.touchPlacement?.canvas === canvas) {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
      }, true);
    }
    return this;
  }

  private get ctx(): CanvasRenderingContext2D {
    return Utility.assertNotUndefined(this._ctx);
  }

  private cancelTouchPlacement(): void {
    const placement = this.touchPlacement;
    if (!placement) return;
    this.touchPlacement = undefined;
    this.jointCursorService.end(this.ctx);
    if (placement.canvas.hasPointerCapture(placement.pointerId)) {
      placement.canvas.releasePointerCapture(placement.pointerId);
    }
  }

  handlePointerEnter(event: PointerEvent): void {
    if (!this.touchPlacement) this.jointCursorService.start(event.offsetX, event.offsetY).show(this.ctx);
  }

  handlePointerLeave(_event: PointerEvent): void {
    if (!this.touchPlacement) this.jointCursorService.clear(this.ctx);
  }

  handlePointerDown(event: PointerEvent): void {
    if (event.buttons !== 1 << 0 || this.hotElementDragService.isDragging()) return;
    if (event.pointerType === 'touch') {
      if (!event.isPrimary || this.touchPlacement) return;
      const canvas = this.ctx.canvas;
      canvas.setPointerCapture(event.pointerId);
      this.touchPlacement = { pointerId: event.pointerId, canvas };
      event.preventDefault();
      this.jointCursorService.clear(this.ctx).start(event.offsetX, event.offsetY).show(this.ctx);
      return;
    }
    // Preserve mouse click placement. Bridge edit handling validates the new joint.
    const locationWorld = this.jointCursorService.locationWorld;
    this.addJointRequest?.emit(new Joint(-1, locationWorld.x, locationWorld.y, false));
  }

  handlePointerMove(event: PointerEvent): void {
    if (this.hotElementDragService.isDragging()) return;
    if (this.touchPlacement) {
      if (event.pointerId === this.touchPlacement.pointerId) {
        this.jointCursorService.move(this.ctx, event.offsetX, event.offsetY, true);
      }
      return;
    }
    this.hotElementService.updateRenderedHotElement(this.ctx, event.offsetX, event.offsetY, {
      considerOnly: [GuideKnob, Labels],
    });
    if (this.hotElementService.hotElement) {
      this.jointCursorService.clear(this.ctx);
    } else {
      this.jointCursorService.move(this.ctx, event.offsetX, event.offsetY, true);
    }
  }

  handlePointerUp(event: PointerEvent): void {
    const placement = this.touchPlacement;
    if (!placement || placement.pointerId !== event.pointerId) return;
    const bounds = placement.canvas.getBoundingClientRect();
    const isInside = bounds.width > 0 && bounds.height > 0 &&
      event.clientX >= bounds.left && event.clientX < bounds.right &&
      event.clientY >= bounds.top && event.clientY < bounds.bottom;
    if (!isInside || this.hotElementDragService.isDragging(event)) {
      this.cancelTouchPlacement();
      return;
    }
    this.jointCursorService.move(this.ctx, event.offsetX, event.offsetY, true);
    const locationWorld = this.jointCursorService.locationWorld;
    const joint = new Joint(-1, locationWorld.x, locationWorld.y, false);
    // Clear capture and preview before emitting: an edit can synchronously change the viewport.
    this.cancelTouchPlacement();
    this.addJointRequest?.emit(joint);
  }

  handlePointerCancel(event: PointerEvent): void {
    if (this.touchPlacement?.pointerId === event.pointerId) this.cancelTouchPlacement();
  }
}
