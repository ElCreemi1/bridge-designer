/* Copyright (c) 2025-2026 Gene Ressler
   SPDX-License-Identifier: GPL-3.0-or-later */

import { Injectable } from '@angular/core';
import { RenderingService } from './rendering.service';
import { EventBrokerService, EventOrigin } from '../../../shared/services/event-broker.service';
import { KeyboardService } from '../pane/keyboard.service';

export type FrameRenderer = (clockMillis: number, elapsedMillis: number) => void;

export const enum AnimationState {
  STOPPED,
  RUNNING,
  PAUSED,
}

/**
 * Container for general purpose logic that starts, runs, and pauses/unpauses an animation.
 *                              ,-------.
 *                              v       |
 * A state machine: STOPPED -> RUN--->PAUSE. Attempts to make other transitions are ignored.
 *                     ^        |       |
 *                     '--------'<------'
 * Provides for "now" real world time vs. simulation clock time, which stops in the PAUSE state.
 */
@Injectable({ providedIn: 'root' })
export class AnimationService {
  /** State of the animation state machine. */
  private _state: AnimationState = AnimationState.STOPPED;
  /** Base "now" value for converting to simulation clock time. */
  private clockBaseMillis: number | undefined;
  /** Running count of frames in the current second of "now" time. */
  private frameCount: number = 0;
  /** Base "now" value for converting to elapsed time since frame started. */
  private frameBaseMillis: number | undefined;
  /** Previous frame's clock value, which the visible frame is based on. */
  private lastClockMillis: number | undefined;
  /** Previous frame's "now" value. */
  private lastNowMillis: number | undefined;
  /** Total total time in the current "now" second spent in rendering code. */
  private totalRenderMillis: number = 0;
  /** Incremented on each start and stop so a stale loop from an earlier start exits. */
  private loopGeneration: number = 0;
  private pendingFrame: number | undefined;
  private pendingTimeout: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly eventBrokerService: EventBrokerService,
    private readonly keyboardService: KeyboardService,
    private readonly renderService: RenderingService,
  ) {
    eventBrokerService.flyThruAnimationPauseRequest.subscribe(info => {
      if (info.data) {
        this.pause();
      } else {
        this.unpause();
      }
    });
  }

  /** Returns the current state of animation. */
  public get state(): AnimationState {
    return this._state;
  }

  /** Starts calls to the registered renderer at the frame rate with clock at zero. */
  public start(): void {
    if (this._state !== AnimationState.STOPPED) {
      return;
    }
    this._state = AnimationState.RUNNING;
    const generation = ++this.loopGeneration;
    const render = (nowMillis: number): void => {
      this.pendingFrame = undefined;
      if (this._state === AnimationState.STOPPED || generation !== this.loopGeneration) {
        return; // Skips scheduling next loop iteration.
      }
      // Handle first frame.
      if (this.lastClockMillis === undefined || this.lastNowMillis === undefined) {
        this.lastClockMillis = this.lastNowMillis = nowMillis;
      }
      // Adjust clock base on first frame and after unpause.
      if (this.clockBaseMillis === undefined) {
        this.clockBaseMillis = nowMillis - this.lastClockMillis;
      }
      const clockMillis =
        this._state === AnimationState.PAUSED ? this.lastClockMillis : nowMillis - this.clockBaseMillis;
      // Remember "now" before rendering, render, then add elapsed time to total.
      const frameStartMillis = performance.now();
      this.renderService.renderFrame(nowMillis, nowMillis - this.lastNowMillis, clockMillis);
      this.totalRenderMillis += performance.now() - frameStartMillis;
      // Save clock and now for next frame.
      this.lastClockMillis = clockMillis;
      this.lastNowMillis = nowMillis;

      // Track fps and fraction of time rendering to GPU.
      ++this.frameCount;
      if (!this.frameBaseMillis) {
        this.frameBaseMillis = nowMillis;
      } else if (nowMillis - this.frameBaseMillis > 1000) {
        if (this.keyboardService.debugState.isDisplayingDebugInfo) {
          // Since we're tallying once a second, 10 millis is 1 percent.
          const renderPercent = Math.round(this.totalRenderMillis * 0.1);
          this.eventBrokerService.displayDebugTextRequest.next({
            origin: EventOrigin.SERVICE,
            data: `${this.frameCount} fps, ${renderPercent}% render`,
          });
        }
        this.frameBaseMillis = nowMillis;
        this.frameCount = 0;
        this.totalRenderMillis = 0;
      }

      // Schedule next loop iteration.
      this.pendingFrame = requestAnimationFrame(render);
    };
    this.renderService.prepareToRender();
    // Kick off the animation loop. Scheduled so the resize handler can
    // set viewport and projection before first frame is rendered.
    this.pendingTimeout = setTimeout(() => {
      this.pendingTimeout = undefined;
      if (generation === this.loopGeneration) this.pendingFrame = requestAnimationFrame(render);
    });
  }

  /** Stops calls to the registered renderer. */
  public stop(): void {
    this._state = AnimationState.STOPPED;
    ++this.loopGeneration;
    if (this.pendingTimeout !== undefined) clearTimeout(this.pendingTimeout);
    if (this.pendingFrame !== undefined) cancelAnimationFrame(this.pendingFrame);
    this.pendingTimeout = this.pendingFrame = undefined;
  }

  /** When running, pauses the clock while the renderer is still called at the frame rate. */
  private pause(): void {
    if (this._state !== AnimationState.RUNNING) {
      return;
    }
    this._state = AnimationState.PAUSED;
  }

  /** When paused, unpauses the rendering clock. Rendering proceeds at the frame rate. */
  private unpause(): void {
    if (this._state !== AnimationState.PAUSED) {
      return;
    }
    this._state = AnimationState.RUNNING;
    // Reset base so clock will advance from the paused value.
    this.clockBaseMillis = undefined;
  }
}
