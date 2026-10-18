/* Copyright (c) 2025-2026 Gene Ressler
   SPDX-License-Identifier: GPL-3.0-or-later */
import { AfterViewInit, ChangeDetectionStrategy, ChangeDetectorRef, Component, ElementRef, HostListener, OnDestroy, ViewChild } from '@angular/core';
import { Subscription } from 'rxjs';
import { jqxToggleButtonComponent, jqxToggleButtonModule } from 'jqwidgets-ng/jqxtogglebutton';
import { UiMode, UiStateService } from '../management/ui-state.service';
import { EventBrokerService, EventOrigin } from '../../../shared/services/event-broker.service';
import { SessionStateService } from '../../session-state/session-state.service';

type State = { selectedIndex: number; x?: number; y?: number };
type PaletteDrag = { pointerId: number; target: HTMLElement; clientX: number; clientY: number; x: number; y: number };

@Component({
  selector: 'tool-selector', imports: [jqxToggleButtonModule],
  templateUrl: './tool-selector.component.html', styleUrl: './tool-selector.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ToolSelectorComponent implements AfterViewInit, OnDestroy {
  private static readonly SESSION_STATE_KEY = 'toolSelector.component';
  readonly imgSize = 25;
  readonly buttonSize = window.matchMedia('(pointer: coarse)').matches ? 44 : 34;
  @ViewChild('palette') palette!: ElementRef<HTMLElement>;
  @ViewChild('jointsButton') jointsButton!: jqxToggleButtonComponent;
  @ViewChild('membersButton') membersButton!: jqxToggleButtonComponent;
  @ViewChild('selectButton') selectButton!: jqxToggleButtonComponent;
  @ViewChild('eraseButton') eraseButton!: jqxToggleButtonComponent;
  expanded = true;
  uiMode: UiMode = 'unknown';
  x = 12;
  y = 122;
  private drag: PaletteDrag | undefined;
  private readonly subscriptions = new Subscription();
  private readonly visualViewportResize = () => this.handleResize();

  constructor(
    private readonly eventBrokerService: EventBrokerService,
    private readonly uiStateService: UiStateService,
    private readonly sessionStateService: SessionStateService,
    private readonly changeDetector: ChangeDetectorRef,
  ) {}

  setExpanded(value: boolean): void {
    this.endDrag();
    this.eventBrokerService.toolsToggle.next({ origin: EventOrigin.TOOL_SELECTOR, data: value });
  }
  private get selectedIndex(): number {
    if (this.eraseButton.toggled()) return 3;
    if (this.selectButton.toggled()) return 2;
    if (this.membersButton.toggled()) return 1;
    return 0;
  }
  private clampPosition(): void {
    if (!this.palette || this.uiMode !== 'drafting') return;
    const bounds = this.palette.nativeElement.getBoundingClientRect();
    const viewport = window.visualViewport;
    const left = (viewport?.offsetLeft ?? 0) + 8;
    const top = (viewport?.offsetTop ?? 0) + 8;
    const width = viewport?.width ?? window.innerWidth;
    const height = viewport?.height ?? window.innerHeight;
    const paletteWidth = bounds.width || (this.expanded ? 4 * this.buttonSize + 22 : 72);
    const paletteHeight = bounds.height || (this.expanded ? 104 : 44);
    this.x = Math.max(left, Math.min(this.x, left + width - 16 - paletteWidth));
    this.y = Math.max(top, Math.min(this.y, top + height - 16 - paletteHeight));
  }
  private refresh(): void {
    if (!this.palette) return;
    this.changeDetector.detectChanges();
    this.clampPosition();
    this.changeDetector.detectChanges();
  }
  startDrag(event: PointerEvent): void {
    if (event.button !== 0 || this.drag || (event.pointerType === 'touch' && !event.isPrimary)) return;
    event.preventDefault(); event.stopPropagation();
    const target = event.currentTarget as HTMLElement;
    target.focus({ preventScroll: true });
    target.setPointerCapture(event.pointerId);
    this.drag = { pointerId: event.pointerId, target, clientX: event.clientX, clientY: event.clientY, x: this.x, y: this.y };
  }
  moveDrag(event: PointerEvent): void {
    const drag = this.drag; if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault(); event.stopPropagation();
    this.x = drag.x + event.clientX - drag.clientX;
    this.y = drag.y + event.clientY - drag.clientY;
    this.clampPosition(); this.changeDetector.detectChanges();
  }
  endDrag(event?: PointerEvent): void {
    const drag = this.drag; if (!drag || (event && event.pointerId !== drag.pointerId)) return;
    this.drag = undefined;
    if (drag.target.hasPointerCapture(drag.pointerId)) drag.target.releasePointerCapture(drag.pointerId);
  }
  moveWithKeyboard(event: KeyboardEvent): void {
    const amount = event.shiftKey ? 25 : 10;
    switch (event.key) {
      case 'ArrowLeft': this.x -= amount; break;
      case 'ArrowRight': this.x += amount; break;
      case 'ArrowUp': this.y -= amount; break;
      case 'ArrowDown': this.y += amount; break;
      default: return;
    }
    event.preventDefault(); event.stopPropagation(); this.refresh();
  }
  @HostListener('window:resize')
  handleResize(): void { this.endDrag(); this.refresh(); }
  @HostListener('window:blur')
  handleBlur(): void { this.endDrag(); }
  @HostListener('document:visibilitychange')
  handleVisibilityChange(): void { if (document.hidden) this.endDrag(); }

  ngAfterViewInit(): void {
    // This component is declared inside a canvas fallback tree. Move its existing
    // Angular-owned palette node to the body so ordinary HTML controls are rendered.
    // It is not a jqxWindow, so dialog-only phone positioning cannot pin its location.
    document.body.appendChild(this.palette.nativeElement);
    this.uiStateService.registerSelectButtons(
      [this.jointsButton, this.membersButton, this.selectButton, this.eraseButton],
      this.eventBrokerService.editModeSelection, true,
    );
    this.subscriptions.add(this.eventBrokerService.toolsToggle.subscribe(info => {
      this.endDrag(); this.expanded = info.data; this.refresh();
    }));
    this.subscriptions.add(this.eventBrokerService.uiModeRequest.subscribe(info => {
      if (info.data !== 'drafting') this.endDrag();
      this.uiMode = info.data; this.refresh();
    }));
    this.subscriptions.add(this.eventBrokerService.sessionStateSaveRequest.subscribe(() =>
      this.sessionStateService.recordState(ToolSelectorComponent.SESSION_STATE_KEY, { selectedIndex: this.selectedIndex, x: this.x, y: this.y }),
    ));
    this.subscriptions.add(this.eventBrokerService.sessionStateRestoreCompletion.subscribe(() => {
      const state = this.sessionStateService.getSavedState(ToolSelectorComponent.SESSION_STATE_KEY) as State | undefined;
      if (!state) return;
      if (typeof state.x === 'number' && Number.isFinite(state.x)) this.x = state.x;
      if (typeof state.y === 'number' && Number.isFinite(state.y)) this.y = state.y;
      const index = Number.isInteger(state.selectedIndex) && state.selectedIndex >= 0 && state.selectedIndex <= 3 ? state.selectedIndex : 0;
      this.eventBrokerService.editModeSelection.next({ origin: EventOrigin.TOOL_SELECTOR, data: index });
      this.refresh();
    }));
    window.visualViewport?.addEventListener('resize', this.visualViewportResize);
    this.refresh();
  }
  ngOnDestroy(): void {
    this.endDrag(); this.subscriptions.unsubscribe();
    window.visualViewport?.removeEventListener('resize', this.visualViewportResize);
    this.palette?.nativeElement.remove();
  }
}
