/* Copyright (c) 2025-2026 Gene Ressler
   SPDX-License-Identifier: GPL-3.0-or-later */

import { EventEmitter, Injectable } from '@angular/core';
import { Joint } from '../../../shared/classes/joint.model';
import { Member } from '../../../shared/classes/member.model';
import { BridgeService } from '../../../shared/services/bridge.service';
import { InventorySelectionService } from '../../../shared/services/inventory-selection.service';
import { HotElementService } from '../shared/hot-element.service';
import { MemberCursorService } from '../shared/member-cursor.service';
import { Utility } from '../../../shared/classes/utility';
import { HotElementDragService } from '../shared/hot-element-drag.service';
import { GuideKnob } from '../shared/guides.service';
import { Labels } from '../shared/labels.service';

@Injectable({ providedIn: 'root' })
export class MembersModeService {
  private _ctx: CanvasRenderingContext2D | undefined;
  private addMemberRequest: EventEmitter<Member> | undefined;
  private readonly existingMemberJointIndices = new Set<number>();
  private touchAnchor: Joint | undefined;
  private touchStart: { x: number; y: number; pointerId: number } | undefined;

  constructor(
    private readonly bridgeService: BridgeService,
    private readonly hotElementDragService: HotElementDragService,
    private readonly hotElementService: HotElementService,
    private readonly inventorySelectionService: InventorySelectionService,
    private readonly memberCursorService: MemberCursorService,
  ) {}

  public initialize(ctx: CanvasRenderingContext2D, addMemberRequest: EventEmitter<Member>): MembersModeService {
    this.cancelTouch();
    this._ctx = ctx;
    this.addMemberRequest = addMemberRequest;
    return this;
  }

  private get ctx(): CanvasRenderingContext2D {
    return Utility.assertNotUndefined(this._ctx);
  }

  private rememberConnectedJoints(anchor: Joint): void {
    this.existingMemberJointIndices.clear();
    this.bridgeService.findConnectedJoints(anchor).forEach(joint =>
      this.existingMemberJointIndices.add(joint.index),
    );
  }

  private emitMember(anchor: Joint, target: Joint): void {
    const material = this.inventorySelectionService.material;
    const shape = this.inventorySelectionService.shape;
    if (!material || !shape) throw new Error('No material selected for new member');
    this.addMemberRequest?.emit(new Member(-1, anchor, target, material, shape));
    this.hotElementService.invalidate(this.ctx);
  }

  private cancelTouch(): void {
    if (this.touchAnchor) this.memberCursorService.end();
    this.touchAnchor = undefined;
    this.touchStart = undefined;
    this.existingMemberJointIndices.clear();
  }

  handlePointerDown(event: PointerEvent): void {
    if (event.buttons !== 1 << 0 || this.hotElementDragService.isDragging()) return;
    if (event.pointerType === 'touch') {
      if (event.isPrimary) {
        this.touchStart = { x: event.offsetX, y: event.offsetY, pointerId: event.pointerId };
      }
      return;
    }
    this.cancelTouch();
    const hotElement = this.hotElementService.hotElement;
    if (hotElement instanceof Joint) {
      this.rememberConnectedJoints(hotElement);
      this.memberCursorService.start(this.ctx, event.offsetX, event.offsetY, hotElement);
    }
  }

  handlePointerMove(event: PointerEvent): void {
    if (this.hotElementDragService.isDragging()) return;
    this.hotElementService.updateRenderedHotElement(this.ctx, event.offsetX, event.offsetY, {
      considerOnly: event.pointerType === 'touch' ? [Joint] : [Joint, GuideKnob, Labels],
      excludedJointIndices: this.existingMemberJointIndices,
    });
    this.memberCursorService.update(event.offsetX, event.offsetY, this.hotElementService.hotElement);
  }

  handlePointerUp(event: PointerEvent): void {
    if (event.pointerType === 'touch') {
      this.finishTouchTap(event);
      return;
    }
    if (event.button !== 0 || this.hotElementDragService.isDragging(event)) return;
    const anchor = this.memberCursorService.end();
    if (!anchor) return;
    this.existingMemberJointIndices.clear();
    const hotElement = this.hotElementService.hotElement;
    if (anchor !== hotElement && hotElement instanceof Joint) this.emitMember(anchor, hotElement);
  }

  private finishTouchTap(event: PointerEvent): void {
    const start = this.touchStart;
    this.touchStart = undefined;
    if (!start || start.pointerId !== event.pointerId || this.hotElementDragService.isDragging(event)) return;
    // A move is not a tap. Keep the first endpoint so the user can retry the second tap.
    if (Math.hypot(event.offsetX - start.x, event.offsetY - start.y) > 12) return;
    this.hotElementService.updateRenderedHotElement(this.ctx, event.offsetX, event.offsetY, {
      considerOnly: [Joint],
      excludedJointIndices: this.existingMemberJointIndices,
    });
    const target = this.hotElementService.hotElement;
    if (!(target instanceof Joint)) {
      this.cancelTouch();
      return;
    }
    if (!this.touchAnchor) {
      this.touchAnchor = target;
      this.rememberConnectedJoints(target);
      this.memberCursorService.start(this.ctx, event.offsetX, event.offsetY, target);
      return;
    }
    const anchor = this.touchAnchor;
    this.cancelTouch();
    if (anchor !== target) this.emitMember(anchor, target);
  }

  handlePointerCancel(event: PointerEvent): void {
    if (event.pointerType === 'touch') this.cancelTouch();
  }
}
