/* Copyright (c) 2025-2026 Gene Ressler
   SPDX-License-Identifier: GPL-3.0-or-later */
import { AfterViewInit, ChangeDetectionStrategy, ChangeDetectorRef, Component, ElementRef, HostBinding, HostListener, ViewChild } from '@angular/core';
import { EventBrokerService, EventOrigin } from '../../../shared/services/event-broker.service';
import { Utility } from '../../../shared/classes/utility';
import { AnimationService } from '../rendering/animation.service';
import { GlService } from '../rendering/gl.service';
import { ViewportService } from '../rendering/viewport.service';
import { AnimationControlsOverlayService } from '../rendering/animation-controls-overlay.service';
import { FlyThruSettingsDialogComponent } from '../fly-thru-settings-dialog/fly-thru-settings-dialog.component';
import { KeyboardService } from './keyboard.service';
import { TextureService } from '../rendering/texture.service';
import { CenterLoadPanelComponent } from '../../center-load/center-load-panel.component';

@Component({
  selector: 'fly-thru-pane', imports: [FlyThruSettingsDialogComponent, CenterLoadPanelComponent],
  templateUrl: './fly-thru-pane.component.html', styleUrl: './fly-thru-pane.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FlyThruPaneComponent implements AfterViewInit {
  @HostBinding('style.display') display = 'none';
  @ViewChild('wrapper') wrapper!: ElementRef<HTMLDivElement>;
  @ViewChild('flyThruCanvas') flyThruCanvas!: ElementRef<HTMLCanvasElement>;
  width = screen.availWidth;
  height = screen.availHeight;
  centerLoadMode = false;
  private activePointer: number | undefined;
  constructor(
    private readonly animationControlsOverlayService: AnimationControlsOverlayService,
    private readonly animationService: AnimationService,
    private readonly changeDetector: ChangeDetectorRef,
    private readonly eventBrokerService: EventBrokerService,
    private readonly glService: GlService,
    private readonly keyBoardService: KeyboardService,
    private readonly textureService: TextureService,
    private readonly viewportService: ViewportService,
  ) {}
  setLoadMode(event: Event): void {
    this.finishPointer();
    this.centerLoadMode = (event.target as HTMLSelectElement).value === 'center';
    if (this.centerLoadMode) this.animationService.stop();
    else if (this.display !== 'none') {
      this.eventBrokerService.simulationReplayRequest.next({ origin: EventOrigin.APP, data: undefined });
      this.animationService.start();
    }
  }
  handlePointerDown(event: PointerEvent): void {
    if (this.centerLoadMode || event.button !== 0 || this.activePointer !== undefined || (event.pointerType === 'touch' && !event.isPrimary)) return;
    const ui = this.animationControlsOverlayService.overlayUi; if (!ui) return;
    event.preventDefault(); this.activePointer = event.pointerId;
    this.flyThruCanvas.nativeElement.setPointerCapture(event.pointerId);
    ui.acceptPointerMove(event.offsetX, event.offsetY); ui.acceptPointerDown(event.offsetX, event.offsetY);
  }
  handlePointerMove(event: PointerEvent): void {
    if (this.centerLoadMode || (event.pointerType === 'touch' && !event.isPrimary) ||
        (this.activePointer !== undefined && event.pointerId !== this.activePointer)) return;
    this.animationControlsOverlayService.overlayUi?.acceptPointerMove(event.offsetX, event.offsetY);
  }
  handlePointerUp(event: PointerEvent): void {
    if (event.button !== 0 || event.pointerId !== this.activePointer) return;
    this.finishPointer(event.offsetX, event.offsetY);
  }
  private finishPointer(x = -1, y = -1): void {
    const id = this.activePointer; if (id === undefined) return;
    this.activePointer = undefined;
    try { this.animationControlsOverlayService.overlayUi?.acceptPointerUp(x, y); }
    finally { const canvas = this.flyThruCanvas.nativeElement; if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id); }
  }
  @HostListener('document:keydown', ['$event'])
  handleKeyDown(event: KeyboardEvent): void {
    if (this.display !== 'none' && !this.centerLoadMode) this.keyBoardService.handleKey(event.key);
  }
  @HostListener('window:blur')
  handleBlur(): void { this.finishPointer(); }
  @HostListener('document:visibilitychange')
  handleVisibilityChange(): void { if (document.hidden) this.finishPointer(); }
  ignore(): boolean { return false; }
  private set isVisible(value: boolean) {
    if (!value) this.finishPointer();
    this.display = value ? 'block' : 'none'; this.changeDetector.detectChanges();
    if (value && !this.centerLoadMode) this.animationService.start(); else this.animationService.stop();
  }
  private handleResize(): void {
    const parent = Utility.assertNotNull(this.flyThruCanvas.nativeElement.parentElement);
    if (parent.clientWidth === 0 || parent.clientHeight === 0) return;
    this.viewportService.setViewport(this.width, this.height, parent.clientWidth, parent.clientHeight);
  }
  ngAfterViewInit(): void {
    const canvas = this.flyThruCanvas.nativeElement; canvas.style.touchAction = 'none';
    canvas.addEventListener('pointercancel', event => { if (event.pointerId === this.activePointer) this.finishPointer(); });
    canvas.addEventListener('lostpointercapture', event => { if (event.pointerId === this.activePointer) this.finishPointer(); });
    new ResizeObserver(() => this.handleResize()).observe(this.wrapper.nativeElement);
    this.glService.initialize(canvas); this.textureService.loadAllTextures();
    this.eventBrokerService.uiModeRequest.subscribe(info => { this.isVisible = info.data === 'animation'; });
  }
}
