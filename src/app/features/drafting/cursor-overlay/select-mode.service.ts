/* Copyright (c) 2025-2026 Gene Ressler
   SPDX-License-Identifier: GPL-3.0-or-later */
import { EventEmitter, Injectable } from '@angular/core';
import { Point2D, Rectangle2D } from '../../../shared/classes/graphics';
import { ElementSelectorService } from '../shared/element-selector.service';
import { HotElementService } from '../shared/hot-element.service';
import { SelectCursorService } from '../shared/select-cursor.service';
import { JointCursorService } from '../shared/joint-cursor.service';
import { Joint } from '../../../shared/classes/joint.model';
import { BridgeService } from '../../../shared/services/bridge.service';
import { SelectedElementsService } from '../shared/selected-elements-service';
import { CoordinateService } from '../shared/coordinate.service';
import { DesignGrid, DesignGridService } from '../../../shared/services/design-grid.service';
import { EventOrigin } from '../../../shared/services/event-broker.service';
import { Utility } from '../../../shared/classes/utility';
import { HotElementDragService } from '../shared/hot-element-drag.service';
import { Member } from '../../../shared/classes/member.model';
import { GuideKnob } from '../shared/guides.service';
import { Labels } from '../shared/labels.service';

@Injectable({ providedIn: 'root' })
export class SelectModeService {
  private _ctx: CanvasRenderingContext2D | undefined;
  private initialHotJoint: Joint | undefined;
  private moveJointRequest: EventEmitter<{ joint: Joint; newLocation: Point2D }> | undefined;
  private movingJoint: Joint | undefined;
  private readonly cursor = Rectangle2D.createEmpty();
  private readonly validPoint = new Point2D();
  constructor(
    private readonly bridgeService: BridgeService,
    private readonly coordinateService: CoordinateService,
    private readonly elementSelectorService: ElementSelectorService,
    private readonly hotElementDragService: HotElementDragService,
    private readonly hotElementService: HotElementService,
    private readonly jointCursorService: JointCursorService,
    private readonly selectCursorService: SelectCursorService,
    private readonly selectedElementsService: SelectedElementsService,
  ) {}
  public initialize(ctx: CanvasRenderingContext2D, request: EventEmitter<{ joint: Joint; newLocation: Point2D }>): SelectModeService {
    if (this._ctx) this.cancel();
    this._ctx = ctx; this.moveJointRequest = request; return this;
  }
  private get ctx(): CanvasRenderingContext2D { return Utility.assertNotUndefined(this._ctx); }
  handlePointerDown(event: PointerEvent): void {
    if (event.buttons !== 1 || this.hotElementDragService.isDragging()) return;
    if (this.hotElementService.hotElement instanceof Joint) this.initialHotJoint = this.hotElementService.hotElement;
    this.selectCursorService.start(this.ctx, event.offsetX, event.offsetY);
  }
  handlePointerMove(event: PointerEvent): void {
    if (this.hotElementDragService.isDragging()) return;
    this.maybeSwitchToJointMove(event);
    if (this.movingJoint) { this.hotElementService.clearRenderedHotElement(this.ctx); }
    else {
      this.hideKeyboardJointMoveCursor();
      this.hotElementService.updateRenderedHotElement(this.ctx, event.offsetX, event.offsetY, {
        excludeFixedJoints: true, considerOnly: [Joint, Member, GuideKnob, Labels], invalidate: true,
      });
    }
    this.selectCursorService.update(event.offsetX, event.offsetY);
    this.jointCursorService.move(this.ctx, event.offsetX, event.offsetY);
  }
  handlePointerUp(event: PointerEvent): void {
    if (event.button !== 0 || this.hotElementDragService.isDragging(event)) return;
    const rectangle = this.selectCursorService.end(event.offsetX, event.offsetY, this.cursor);
    if (rectangle) {
      this.elementSelectorService.select(rectangle, event.ctrlKey, EventOrigin.DRAFTING_PANEL);
      this.hotElementService.invalidate(this.ctx);
    }
    if (this.movingJoint) {
      const newLocation = this.jointCursorService.end(this.ctx);
      this.moveJointRequest?.emit({ joint: this.movingJoint, newLocation });
    }
    this.movingJoint = this.initialHotJoint = undefined;
  }
  private cancel(): void {
    this.selectCursorService.abort();
    this.jointCursorService.end(this.ctx);
    this.movingJoint = this.initialHotJoint = undefined;
  }
  handlePointerCancel(_event: PointerEvent): void { this.cancel(); }
  handleDocumentKeyDown(event: KeyboardEvent): void {
    if (this.movingJoint || this.selectCursorService.isAnchored) return;
    const joint = this.selectedElementsService.getSelectedJoint(this.bridgeService.bridge);
    if (!joint) return;
    this.hotElementService.clearRenderedHotElement(this.ctx);
    let dx = 0, dy = 0;
    switch (event.key) {
      case 'ArrowUp': dy = DesignGrid.FINE_GRID_SIZE; break;
      case 'ArrowDown': dy = -DesignGrid.FINE_GRID_SIZE; break;
      case 'ArrowRight': dx = DesignGrid.FINE_GRID_SIZE; break;
      case 'ArrowLeft': dx = -DesignGrid.FINE_GRID_SIZE; break;
      default: return;
    }
    this.coordinateService.getNearbyWorldPointOnGrid(this.validPoint, joint, dx, dy, DesignGridService.FINEST_GRID);
    if (!this.jointCursorService.visible) {
      this.jointCursorService.startAtWorldPoint(this.validPoint, { grid: DesignGridService.FINEST_GRID }).show(this.ctx);
    } else { this.jointCursorService.moveToWorldPoint(this.ctx, this.validPoint); }
    this.moveJointRequest?.emit({ joint, newLocation: this.validPoint });
  }
  private hideKeyboardJointMoveCursor(): void {
    if (!this.movingJoint && this.jointCursorService.visible) this.jointCursorService.clear(this.ctx);
  }
  private maybeSwitchToJointMove(event: PointerEvent): void {
    if ((event.buttons & 1) === 0 || this.movingJoint || !this.initialHotJoint ||
        !this.selectCursorService.isAnchored || this.selectCursorService.diagonalSqr <= 9) return;
    this.selectCursorService.abort();
    this.movingJoint = this.initialHotJoint;
    this.elementSelectorService.selectJoint(this.movingJoint, EventOrigin.DRAFTING_PANEL);
    this.jointCursorService.start(event.offsetX, event.offsetY, {
      anchorJoints: this.bridgeService.findConnectedJoints(this.movingJoint),
    }).show(this.ctx);
  }
}
