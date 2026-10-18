/* Copyright (c) 2025-2026 Gene Ressler
   SPDX-License-Identifier: GPL-3.0-or-later */
import { Injectable } from '@angular/core';
import { Rectangle2D } from '../../../shared/classes/graphics';
import { BridgeService } from '../../../shared/services/bridge.service';
import { EventBrokerService, EventOrigin } from '../../../shared/services/event-broker.service';
import { ViewportTransform2D } from '../../../shared/services/viewport-transform.service';

type Contact = { x: number; y: number };
type Pair = { x: number; y: number; distance: number };

/** Navigation changes the drafting camera, never bridge geometry. */
@Injectable({ providedIn: 'root' })
export class DraftingNavigationService {
  private readonly registered = new WeakSet<HTMLCanvasElement>();
  constructor(
    private readonly transform: ViewportTransform2D,
    private readonly bridge: BridgeService,
    private readonly broker: EventBrokerService,
  ) {}

  register(canvas: HTMLCanvasElement, cancelEditing: (event: PointerEvent) => void): void {
    if (this.registered.has(canvas)) return;
    this.registered.add(canvas);
    canvas.style.touchAction = 'none';
    const contacts = new Map<number, Contact>();
    let navigating = false;
    let previous: Pair | undefined;
    let zoom = 1;
    let updating = false;
    const pair = (): Pair | undefined => {
      const values = [...contacts.values()];
      if (values.length < 2) return undefined;
      const [a, b] = values;
      return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, distance: Math.hypot(a.x - b.x, a.y - b.y) };
    };
    const stop = (event: Event) => { event.preventDefault(); event.stopImmediatePropagation(); };
    const cancel = () => {
      const pointerId = contacts.keys().next().value;
      if (pointerId !== undefined) {
        cancelEditing(new PointerEvent('pointercancel', { pointerId, pointerType: 'touch', isPrimary: true }));
      }
    };
    const release = (id: number) => { if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id); };
    const apply = (before: Pair, after: Pair) => {
      if (before.distance < 1 || after.distance < 1) return;
      const bounds = canvas.getBoundingClientRect();
      const wrapper = canvas.closest('.wrapper') as HTMLElement | null;
      const width = (wrapper?.clientWidth ?? canvas.clientWidth) - 1;
      const height = (wrapper?.clientHeight ?? canvas.clientHeight) - 1;
      if (width <= 0 || height <= 0) return;
      const nextZoom = Math.max(1, Math.min(5, zoom * after.distance / before.distance));
      const ratio = nextZoom / zoom;
      const anchorX = this.transform.viewportToWorldX(before.x - bounds.left);
      const anchorY = this.transform.viewportToWorldY(before.y - bounds.top);
      const worldWidth = Math.abs(this.transform.viewportToWorldX(width) - this.transform.viewportToWorldX(0)) / ratio;
      const worldHeight = Math.abs(this.transform.viewportToWorldY(0) - this.transform.viewportToWorldY(height)) / ratio;
      const window = Rectangle2D.createEmpty();
      window.width = worldWidth;
      window.height = worldHeight;
      window.x0 = anchorX - (after.x - bounds.left) * worldWidth / width;
      window.y0 = anchorY - (height - (after.y - bounds.top)) * worldHeight / height;
      updating = true;
      try {
        this.broker.draftingViewportPendingChange.next({ origin: EventOrigin.SERVICE, data: undefined });
        this.transform.setWindow(nextZoom === 1 ? this.bridge.siteInfo.drawingWindow : window);
        zoom = nextZoom;
        this.broker.draftingPanelInvalidation.next({ origin: EventOrigin.SERVICE, data: 'viewport' });
      } finally { updating = false; }
    };
    this.broker.draftingViewportPendingChange.subscribe(() => { if (!updating) zoom = 1; });
    this.broker.loadBridgeCompletion.subscribe(() => { zoom = 1; });
    canvas.addEventListener('pointerdown', event => {
      if (event.pointerType !== 'touch') return;
      contacts.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (contacts.size >= 2) {
        if (!navigating) { cancel(); navigating = true; }
        for (const id of contacts.keys()) canvas.setPointerCapture(id);
        previous = pair();
        stop(event);
      } else if (navigating) stop(event);
    }, { capture: true, passive: false });
    canvas.addEventListener('pointermove', event => {
      if (event.pointerType !== 'touch' || !contacts.has(event.pointerId)) return;
      contacts.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (!navigating) return;
      const current = pair();
      if (previous && current) apply(previous, current);
      previous = current;
      stop(event);
    }, { capture: true, passive: false });
    const finish = (event: PointerEvent) => {
      if (event.pointerType !== 'touch') return;
      const wasNavigating = navigating;
      contacts.delete(event.pointerId);
      previous = pair();
      if (wasNavigating) { release(event.pointerId); stop(event); }
      if (contacts.size === 0) { navigating = false; previous = undefined; }
    };
    canvas.addEventListener('pointerup', finish, { capture: true, passive: false });
    canvas.addEventListener('pointercancel', finish, { capture: true, passive: false });
    canvas.addEventListener('contextmenu', event => { if (navigating) stop(event); }, true);
    const abandon = () => {
      cancel();
      for (const id of contacts.keys()) release(id);
      contacts.clear(); navigating = false; previous = undefined;
    };
    window.addEventListener('blur', abandon);
    document.addEventListener('visibilitychange', () => { if (document.hidden) abandon(); });
  }
}
