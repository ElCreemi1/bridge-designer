/* SPDX-License-Identifier: GPL-3.0-or-later */
import { Injectable } from '@angular/core';
import { BridgeService } from '../../shared/services/bridge.service';
import { EventBrokerService, EventOrigin } from '../../shared/services/event-broker.service';

export interface PastaStrandSnapshot { generation: number; members: readonly object[]; }

/** Session-only strand counts shared by the simulator and the drafting renderer.
 * Never modifies steel sizes, material properties, solver equations or bridge files.
 */
@Injectable({ providedIn: 'root' })
export class PastaStrandSessionService {
  private generation = 0;
  private bridgeRef: object | undefined;
  private members: object[] = [];
  private values: number[] = [];
  constructor(private readonly bridge: BridgeService, private readonly broker: EventBrokerService) {
    broker.loadBridgeCompletion.subscribe(() => {
      this.generation++; this.bridgeRef = undefined; this.members = []; this.values = []; this.invalidate();
    });
    broker.editCommandCompletion.subscribe(() => { this.synchronize(); this.invalidate(); });
  }
  private synchronize(): void {
    const current = this.bridge.bridge;
    if (current !== this.bridgeRef || current.members.length !== this.members.length ||
        current.members.some((member, i) => member !== this.members[i])) {
      this.generation++; this.bridgeRef = current; this.members = current.members.slice();
      this.values = new Array(this.members.length).fill(1);
    }
  }
  read(): number[] { this.synchronize(); return this.values.slice(); }
  snapshot(): PastaStrandSnapshot {
    this.synchronize(); return { generation: this.generation, members: this.members.slice() };
  }
  /** Refuse counts belonging to a replaced or re-indexed member collection. */
  publish(counts: readonly number[], snapshot: PastaStrandSnapshot): boolean {
    this.synchronize();
    if (snapshot.generation !== this.generation || snapshot.members.length !== this.members.length ||
        snapshot.members.some((member, i) => member !== this.members[i]) ||
        counts.length !== this.members.length || counts.some(n => !Number.isInteger(n) || n < 1 || n > 10000)) return false;
    if (counts.some((n, i) => n !== this.values[i])) {
      this.values = Array.from(counts); this.invalidate();
    }
    return true;
  }
  countFor(member: object): number {
    this.synchronize(); const index = this.members.indexOf(member);
    return index < 0 ? 1 : this.values[index];
  }
  private invalidate(): void {
    this.broker.draftingPanelInvalidation.next({ origin: EventOrigin.SERVICE, data: 'graphic' });
  }
}

/** Schematic widths only; not a physical section size or buckling calculation. */
export function pastaBundleWidth(count: number): number {
  return Math.min(16, 2 + 2 * Math.sqrt(Math.max(0, count - 1)));
}
