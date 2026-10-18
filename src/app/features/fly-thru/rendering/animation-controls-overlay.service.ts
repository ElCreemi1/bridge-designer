/* Copyright (c) 2025-2026 Gene Ressler
   SPDX-License-Identifier: GPL-3.0-or-later */
import { Injectable } from '@angular/core';
import { Overlay, OverlayDescriptor, OverlayService, OverlayUi } from './overlay.service';
import { EventBrokerService, EventOrigin } from '../../../shared/services/event-broker.service';
import { ViewService } from './view.service';
import { SimulationPhase } from './simulation-state.service';
import { ViewportService } from './viewport.service';

/** Icon indices match img/overlay.png and must remain stable. */
export enum OverlayIcon { HAND, HEAD, HOME, PAUSE, PLAY, REPLAY, SETTINGS, TRUCK, WALK }
enum Order { SETTINGS, PAUSE_PLAY_REPLAY, TRUCK, HOME, HEAD, HAND, WALK }
const ICON_ORDERS = [Order.HAND, Order.HEAD, Order.HOME, Order.PAUSE_PLAY_REPLAY,
  Order.PAUSE_PLAY_REPLAY, Order.PAUSE_PLAY_REPLAY, Order.SETTINGS, Order.TRUCK, Order.WALK];
const DIM_ALPHA = 0.2;
const FLY_THRU_OVERLAY_DESCRIPTOR: OverlayDescriptor = {
  imageArrayUrl: 'img/overlay.png',
  icons: ICON_ORDERS.map((order, index) => ({
    x0: 150, y0: -100 - 64 * order, width: 48, height: 48,
    initialAlpha: index === OverlayIcon.PLAY || index === OverlayIcon.REPLAY ? 0 : DIM_ALPHA,
  })),
};

@Injectable({ providedIn: 'root' })
export class AnimationControlsOverlayService {
  private overlay!: Overlay;
  public overlayUi!: OverlayUi;
  private dimAlpha = DIM_ALPHA;
  constructor(
    private readonly eventBrokerService: EventBrokerService,
    private readonly overlayService: OverlayService,
    private readonly viewService: ViewService,
    private readonly viewportService: ViewportService,
  ) {}

  private layout(): void {
    const compact = window.matchMedia('(pointer: coarse)').matches || this.viewportService.height < 560;
    const columns = Math.max(1, Math.min(7, Math.floor((this.viewportService.width - 24) / 56)));
    this.overlay.icons.forEach((icon, index) => {
      const order = ICON_ORDERS[index];
      icon.x0 = compact ? 12 + 56 * (order % columns) : 150;
      icon.y0 = compact ? -12 - 56 * Math.floor(order / columns) : -100 - 64 * order;
      icon.width = icon.height = compact ? 44 : 48;
    });
    this.overlay.arePositionsDirty = true;
  }

  public prepare(): void {
    const touch = window.matchMedia('(pointer: coarse)').matches;
    this.dimAlpha = touch ? 0.65 : DIM_ALPHA;
    const descriptor: OverlayDescriptor = {
      imageArrayUrl: FLY_THRU_OVERLAY_DESCRIPTOR.imageArrayUrl,
      icons: FLY_THRU_OVERLAY_DESCRIPTOR.icons.map(icon => ({
        ...icon, initialAlpha: icon.initialAlpha ? this.dimAlpha : 0,
      })),
    };
    this.overlay = this.overlayService.prepare(descriptor);
    this.layout();
    this.overlayUi = this.overlayService.attachUi(this.overlay, this.dimAlpha);
    this.viewService.provideUiHandlers(this.overlayUi);
    this.eventBrokerService.flyThruViewportChange.subscribe(() => this.layout());
    this.overlayUi.iconHandlerSets[OverlayIcon.PAUSE].handlePointerDown = () => {
      this.eventBrokerService.flyThruAnimationPauseRequest.next({ origin: EventOrigin.SERVICE, data: true });
      this.overlayUi.updateAlphas(OverlayIcon.PLAY, this.dimAlpha, OverlayIcon.PAUSE, 0, OverlayIcon.REPLAY, 0);
    };
    this.overlayUi.iconHandlerSets[OverlayIcon.PLAY].handlePointerDown = () => {
      this.eventBrokerService.flyThruAnimationPauseRequest.next({ origin: EventOrigin.SERVICE, data: false });
      this.overlayUi.updateAlphas(OverlayIcon.PLAY, 0, OverlayIcon.PAUSE, this.dimAlpha, OverlayIcon.REPLAY, 0);
    };
    this.overlayUi.iconHandlerSets[OverlayIcon.REPLAY].handlePointerDown = () => {
      this.eventBrokerService.simulationReplayRequest.next({ origin: EventOrigin.SERVICE, data: undefined });
      this.overlayUi.updateAlphas(OverlayIcon.PLAY, 0, OverlayIcon.PAUSE, this.dimAlpha, OverlayIcon.REPLAY, 0);
    };
    this.eventBrokerService.simulationPhaseChange.subscribe(info => {
      switch (info.data) {
        case SimulationPhase.DEAD_LOADING:
          this.overlayUi.updateAlphas(OverlayIcon.PLAY, 0, OverlayIcon.PAUSE, this.dimAlpha, OverlayIcon.REPLAY, 0); break;
        case SimulationPhase.COLLAPSING:
          this.overlayUi.updateAlphas(OverlayIcon.PLAY, 0, OverlayIcon.PAUSE, 0, OverlayIcon.REPLAY, this.dimAlpha); break;
      }
    });
  }
  public render(): void { this.overlayService.render(this.overlay); }
}
