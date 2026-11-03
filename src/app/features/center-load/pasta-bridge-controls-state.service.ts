/* SPDX-License-Identifier: GPL-3.0-or-later */
import { Injectable } from '@angular/core';
import { DEFAULT_PASTA_PROPERTIES, PastaProperties } from './pasta-analysis';

/** Resolve displayed member numbers to current array indices; never guess chords. */
export function bridgePanelIndices(text: string, numbers: readonly number[]): number[] {
  const tokens = text.trim().split(/[\s,;]+/).filter(Boolean);
  if (!tokens.length) throw new Error('Enter the member numbers for both top and bottom bracing panels.');
  const seen = new Set<number>();
  return tokens.map(token => {
    const match = /^M?([1-9]\d*)$/i.exec(token), number = match ? Number(match[1]) : NaN;
    const index = numbers.indexOf(number);
    if (!Number.isSafeInteger(number) || index < 0 || seen.has(number)) throw new Error(`Invalid, missing or repeated member: ${token}`);
    seen.add(number); return index;
  });
}

/** Session-only inputs survive leaving/re-entering the numerical results view. */
@Injectable({ providedIn: 'root' })
export class PastaBridgeControlsState {
  massG = 2000;
  braceStrands = 1;
  top = '';
  bottom = '';
  props: PastaProperties = { ...DEFAULT_PASTA_PROPERTIES };
  private bridge: object | undefined;
  private members: readonly object[] = [];
  private connectivity = '';
  resetLayout(): void { this.top = ''; this.bottom = ''; this.braceStrands = 1; this.bridge = undefined; }
  synchronize(bridge: object, members: readonly object[], connectivity: string): void {
    if (bridge !== this.bridge || connectivity !== this.connectivity || members.length !== this.members.length || members.some((m, i) => m !== this.members[i])) {
      this.top = ''; this.bottom = ''; this.braceStrands = 1;
      this.bridge = bridge; this.members = members.slice(); this.connectivity = connectivity;
    }
  }
}
