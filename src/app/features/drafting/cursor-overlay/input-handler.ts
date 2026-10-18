/* Copyright (c) 2025-2026 Gene Ressler
   SPDX-License-Identifier: GPL-3.0-or-later */
import { inject } from '@angular/core';
import { DraftingNavigationService } from '../shared/drafting-navigation.service';

export type InputHandlerSet = {
  handlePointerEnter?: (event: PointerEvent) => void;
  handlePointerLeave?: (event: PointerEvent) => void;
  handlePointerMove?: (event: PointerEvent) => void;
  handlePointerDown?: (event: PointerEvent) => void;
  handlePointerUp?: (event: PointerEvent) => void;
  handlePointerCancel?: (event: PointerEvent) => void;
  handleDocumentKeyDown?: (event: KeyboardEvent) => void;
};

/** Construct within an Angular injection context, or pass a navigation service explicitly. */
export class InputEventDelegator {
  public handlerSet: InputHandlerSet = {};
  private static readonly registered = new WeakMap<HTMLCanvasElement, InputEventDelegator[]>();
  constructor(private readonly navigation: DraftingNavigationService = inject(DraftingNavigationService)) {}

  public register(canvas: HTMLCanvasElement): void {
    const existing = InputEventDelegator.registered.get(canvas);
    if (existing) { if (!existing.includes(this)) existing.push(this); return; }
    const delegates: InputEventDelegator[] = [this];
    InputEventDelegator.registered.set(canvas, delegates);
    const dispatch = (name: Exclude<keyof InputHandlerSet, 'handleDocumentKeyDown'>, event: PointerEvent) => {
      for (const delegate of delegates) delegate.handlerSet[name]?.(event);
    };
    // Capture-phase navigation sees both fingers before the single-pointer editing filters.
    this.navigation.register(canvas, event => dispatch('handlePointerCancel', event));
    const accepts = (event: PointerEvent) => event.pointerType !== 'touch' || event.isPrimary;
    canvas.addEventListener('pointerenter', event => { if (accepts(event)) dispatch('handlePointerEnter', event); });
    canvas.addEventListener('pointerleave', event => { if (accepts(event)) dispatch('handlePointerLeave', event); });
    canvas.addEventListener('pointermove', event => { if (accepts(event)) dispatch('handlePointerMove', event); });
    canvas.addEventListener('pointerdown', event => {
      if (!accepts(event)) return;
      if (event.pointerType === 'touch') dispatch('handlePointerMove', event);
      dispatch('handlePointerDown', event);
    });
    canvas.addEventListener('pointerup', event => { if (accepts(event)) dispatch('handlePointerUp', event); });
    canvas.addEventListener('pointercancel', event => { if (accepts(event)) dispatch('handlePointerCancel', event); });
    document.addEventListener('keydown', event => {
      for (const delegate of delegates) delegate.handlerSet.handleDocumentKeyDown?.(event);
    });
  }
}
