/* Copyright (c) 2026 ElCreemi1
   SPDX-License-Identifier: GPL-3.0-or-later */

import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';

/** Default longest single strand, meters (roughly standard dry spaghetti). */
export const DEFAULT_MAX_STRAND_LENGTH_M = 0.25;
const STORAGE_KEY = 'bridge-designer.pastaMaxStrandLengthM';

/** Pasta settings shared by drafting, the member table, and the 3D pasta panel. */
@Injectable({ providedIn: 'root' })
export class PastaSettingsService {
  private _maxStrandLengthM = DEFAULT_MAX_STRAND_LENGTH_M;
  /** Emits the new limit whenever it changes. */
  public readonly maxStrandLengthChange = new Subject<number>();

  constructor() {
    try {
      const stored = Number(localStorage.getItem(STORAGE_KEY));
      if (PastaSettingsService.isValidLength(stored)) this._maxStrandLengthM = stored;
    } catch {
      // Storage unavailable; keep the default.
    }
  }

  /** Longest single strand at the 1.00 m pasta scale, meters. Members longer than this are flagged. */
  public get maxStrandLengthM(): number {
    return this._maxStrandLengthM;
  }

  public set maxStrandLengthM(value: number) {
    if (!PastaSettingsService.isValidLength(value) || value === this._maxStrandLengthM) return;
    this._maxStrandLengthM = value;
    try {
      localStorage.setItem(STORAGE_KEY, String(value));
    } catch {
      // Ignore.
    }
    this.maxStrandLengthChange.next(value);
  }

  /** Whether a member of the given length at pasta scale, meters, is longer than one strand. */
  public isOverLength(pastaLengthM: number): boolean {
    return pastaLengthM > this._maxStrandLengthM * (1 + 1e-9);
  }

  public static isValidLength(value: number): boolean {
    return Number.isFinite(value) && value >= 0.01 && value <= 2;
  }
}
