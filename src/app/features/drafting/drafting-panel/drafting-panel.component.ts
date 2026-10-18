/* Copyright (c) 2025-2026 Gene Ressler
   SPDX-License-Identifier: GPL-3.0-or-later */

import { PastaSettingsService } from '../../../shared/services/pasta-settings.service';
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  ViewChild,
} from '@angular/core';
import { EditCommand } from '../../../shared/classes/editing';
import { Geometry, Graphics, Point2D } from '../../../shared/classes/graphics';
import { Joint } from '../../../shared/classes/joint.model';
import { Member } from '../../../shared/classes/member.model';
import { BridgeService } from '../../../shared/services/bridge.service';
import { DesignRenderingService } from '../../../shared/services/design-rendering.service';
import { EventBrokerService, EventOrigin, LoadBridgeRequestData } from '../../../shared/services/event-broker.service';
import { FormsModule } from '@angular/forms';
import { ViewportTransform2D } from '../../../shared/services/viewport-transform.service';
import { AddJointCommand } from '../../controls/edit-command/add-joint.command';
import { AddMemberCommand } from '../../controls/edit-command/add-member.command';
import { DeleteJointCommand } from '../../controls/edit-command/delete-joint.command';
import { DeleteMembersCommand } from '../../controls/edit-command/delete-members.command';
import { CursorOverlayComponent } from '../cursor-overlay/cursor-overlay.component';
import { SelectedElementsService } from '../shared/selected-elements-service';
import { UndoManagerService } from '../shared/undo-manager.service';
import { ToolSelectorComponent } from '../../controls/tool-selector/tool-selector.component';
import { DesignGridDensity, DesignGridService } from '../../../shared/services/design-grid.service';
import { MoveJointCommand } from '../../controls/edit-command/move-joint.command';
import { BridgeSketchModel } from '../../../shared/classes/bridge-sketch.model';
import { GuideKnob, GuidesService } from '../shared/guides.service';
import { Labels, LabelsService } from '../shared/labels.service';
import { Draggable } from '../shared/hot-element-drag.service';
import { Utility } from '../../../shared/classes/utility';
import { ToastComponent } from '../../toast/toast/toast.component';
import { ToastError } from '../../toast/toast/toast-error';
import { DesignConditions } from '../../../shared/services/design-conditions.service';
import { ElementSelectorService } from '../shared/element-selector.service';
import { SaveMarkService } from '../../save-load/save-mark.service';

@Component({
  selector: 'drafting-panel',
  templateUrl: './drafting-panel.component.html',
  styleUrl: './drafting-panel.component.scss',
  imports: [CursorOverlayComponent, FormsModule, ToastComponent, ToolSelectorComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DraftingPanelComponent implements AfterViewInit {
  // Fixed backing surface clipped by the wrapper; cover both orientations so rotating a phone
  // after startup does not leave part of the panel undrawn.
  width: number = Math.max(screen.availWidth, screen.availHeight) * devicePixelRatio;
  height: number = Math.max(screen.availWidth, screen.availHeight) * devicePixelRatio;
  @ViewChild('wrapper') wrapper!: ElementRef<HTMLDivElement>;
  @ViewChild('draftingPanel') draftingPanel!: ElementRef<HTMLCanvasElement>;
  @ViewChild('cursorLayer') cursorLayer!: ElementRef<CursorOverlayComponent>;
  @ViewChild('titleBlock') titleBlock!: ElementRef<HTMLDivElement>;

  constructor(
    readonly bridgeService: BridgeService,
    private readonly changeDetector: ChangeDetectorRef,
    private readonly designGridService: DesignGridService,
    private readonly designRenderingService: DesignRenderingService,
    private readonly elementSelectionService: ElementSelectorService,
    private readonly eventBrokerService: EventBrokerService,
    private readonly guideService: GuidesService,
    private readonly labelsService: LabelsService,
    private readonly saveMarkService: SaveMarkService,
    private readonly selectedElementsService: SelectedElementsService,
    private readonly undoManagerService: UndoManagerService,
    private readonly viewportTransform: ViewportTransform2D,
    private readonly pastaSettingsService: PastaSettingsService,
  ) {}

  private get ctx(): CanvasRenderingContext2D {
    return Graphics.getContext(this.draftingPanel);
  }

  handleResize(): void {
    this.eventBrokerService.draftingViewportPendingChange.next({ origin: EventOrigin.DRAFTING_PANEL, data: undefined });
    const parent = Utility.assertNotNull(this.draftingPanel.nativeElement.parentElement);
    const w = parent.clientWidth;
    const h = parent.clientHeight;
    this.viewportTransform.setViewport(0, h - 1, w - 1, 1 - h);
    this.viewportTransform.setWindow(this.bridgeService.siteInfo.drawingWindow);
    this.eventBrokerService.draftingPanelInvalidation.next({ origin: EventOrigin.DRAFTING_PANEL, data: 'viewport' });
  }

  /** Suppresses context menu. */
  ignore(): boolean {
    return false;
  }

  /** Renders the panel, optionally with draggable elements missing, e.g. because they're being dragged. */
  private render(draggable?: Draggable | undefined): void {
    this.designRenderingService.render(this.ctx);
    if (!(draggable instanceof Labels)) {
      this.labelsService.render(this.ctx);
    }
    if (!(draggable instanceof GuideKnob)) {
      this.guideService.render(this.ctx);
    }
  }

  /**
   * Loads a bridge as current, optionally invalidates the save mark. This means the new bridge
   * is not backed by whatever file may have been backing the previous one. E.g. loading a new or sample
   * bridge should invalidate, but loading a previous iteration should not.
   */
  private loadBridge(data: LoadBridgeRequestData): void {
    const bridge = data.bridge;
    this.eventBrokerService.selectNoneRequest.next({ origin: EventOrigin.DRAFTING_PANEL, data: undefined });
    const bridgeGridDensity = DesignGridService.getDensityOfWorldPoints(bridge.joints);
    this.selectGridDensity(bridgeGridDensity);
    this.bridgeService.setBridge(bridge, data.draftingPanelState);
    this.handleResize();
    this.changeDetector.detectChanges(); // Updates title block.
    this.eventBrokerService.loadBridgeCompletion.next({ origin: EventOrigin.DRAFTING_PANEL, data: bridge });
    if (data.invalidateSavedMark) {
      this.saveMarkService.invalidateSavedMark();
    }
  }

  private loadSketch(sketch: BridgeSketchModel) {
    const sketchDensity = DesignGridService.getDensityOfWorldPoints(sketch.joints);
    if (sketchDensity > this.designGridService.grid.density) {
      this.selectGridDensity(sketchDensity);
    }
    this.bridgeService.sketch = sketch;
    this.render();
  }

  handleAddJointRequest(joint: Joint): void {
    if (this.bridgeService.bridge.joints.length >= DesignConditions.MAX_JOINT_COUNT) {
      throw new ToastError('tooManyJointsError');
    }
    if (this.bridgeService.findJointAt(joint)) {
      throw new ToastError('duplicateJointError');
    }
    const command = AddJointCommand.create(
      joint,
      this.bridgeService.bridge,
      this.selectedElementsService.selectedElements,
    );
    this.undoManagerService.do(command);
  }

  handleAddMemberRequest(member: Member): void {
    if (this.bridgeService.getMemberWithJoints(member.a, member.b)) {
      throw new ToastError('duplicateMemberError');
    }
    if (this.bridgeService.isMemberIntersectingHighPier(member.a, member.b)) {
      throw new ToastError('highPierError');
    }
    const command = AddMemberCommand.create(
      member,
      this.bridgeService.bridge,
      this.selectedElementsService.selectedElements,
    );
    this.undoManagerService.do(command);
  }

  handleDeleteRequest(element: Joint | Member): void {
    const bridge = this.bridgeService.bridge;
    const selectedElements = this.selectedElementsService.selectedElements;
    const command: EditCommand =
      element instanceof Joint
        ? new DeleteJointCommand(element, bridge, selectedElements)
        : DeleteMembersCommand.forMember(element, bridge, selectedElements);
    this.undoManagerService.do(command);
  }

  handleDeleteSelectionRequest(): void {
    if (this.selectedElementsService.isSelectionEmpty) {
      return;
    }
    const bridge = this.bridgeService.bridge;
    const selectedElements = this.selectedElementsService.selectedElements;
    const joint = this.selectedElementsService.getSelectedJoint(bridge);
    const command: EditCommand = joint
      ? new DeleteJointCommand(joint, bridge, selectedElements)
      : DeleteMembersCommand.forSelectedMembers(selectedElements, this.bridgeService);
    this.undoManagerService.do(command);
    // We just deleted the selection. Everyone else needs to know.
    this.elementSelectionService.sendSelectedElementsChange(EventOrigin.DRAFTING_PANEL);
  }

  /** Handles reports from cursor overlay at start and end of draggable dragging. */
  handleDragCursorActive(draggable: Draggable | undefined) {
    this.render(draggable);
  }

  handleMoveJointRequest({ joint, newLocation }: { joint: Joint; newLocation: Point2D }): void {
    // Quietly do nothing for zero displacement move attempt.
    if (Geometry.areColocated2D(newLocation, joint)) {
      throw new ToastError('noError');
    }
    // Don't allow move onto an existing joint.
    if (this.bridgeService.findJointAt(newLocation)) {
      throw new ToastError('moveJointError');
    }
    // Don't allow move onto high pier.
    if (this.bridgeService.isMovedJointIntersectingHighPier(joint, newLocation)) {
      throw new ToastError('highPierError');
    }
    const bridge = this.bridgeService.bridge;
    const selectedElements = this.selectedElementsService.selectedElements;
    const command = MoveJointCommand.create(joint, newLocation, bridge, selectedElements);
    this.undoManagerService.do(command);
  }

  // IMPORTANT: Following 2 methods rely on the coincidence that selector indices are the same as density enum values.

  /** Sets the design grid density from the selection widget (menu or button) index. */
  handleSelectGridDensity(selectorIndex: number) {
    if (
      DesignGridDensity.COARSE <= selectorIndex &&
      selectorIndex <= DesignGridDensity.FINE &&
      selectorIndex != this.designGridService.grid.density
    ) {
      this.designGridService.grid.density = selectorIndex;
      this.eventBrokerService.gridDensityChange.next({ origin: EventOrigin.DRAFTING_PANEL, data: undefined });
    }
  }

  /** Sets all grid density selection widgets using given value. */
  selectGridDensity(density: DesignGridDensity): void {
    if (density !== DesignGridDensity.ERROR) {
      this.eventBrokerService.gridDensitySelection.next({ origin: EventOrigin.DRAFTING_PANEL, data: density });
    }
  }

  /** Stops edit keys from bubbling up to the global handler while focus on title block. */
  handleTitleBlockKeyDown(event: KeyboardEvent) {
    event.stopPropagation();
  }

  ngAfterViewInit(): void {
    new ResizeObserver(() => this.handleResize()).observe(this.wrapper.nativeElement);
    this.eventBrokerService.deleteSelectionRequest.subscribe(() => this.handleDeleteSelectionRequest());
    this.eventBrokerService.draftingPanelInvalidation.subscribe(() => this.render());
    this.pastaSettingsService.maxStrandLengthChange.subscribe(() => this.render());
    this.eventBrokerService.gridDensitySelection.subscribe(info => this.handleSelectGridDensity(info.data));
    this.eventBrokerService.loadBridgeRequest.subscribe(info => this.loadBridge(info.data));
    this.eventBrokerService.attachSketchRequest.subscribe(info => this.loadSketch(info.data));
    this.eventBrokerService.selectedElementsChange.subscribe(() => this.render());
    this.eventBrokerService.titleBlockToggle.subscribe(info => {
      this.titleBlock.nativeElement.style.display = info.data ? '' : 'none';
    });
    this.eventBrokerService.editCommandCompletion.subscribe(() => this.render());
    this.handleResize();
  }
}
