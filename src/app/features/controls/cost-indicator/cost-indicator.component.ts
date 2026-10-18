/* Copyright (c) 2025-2026 Gene Ressler
   SPDX-License-Identifier: GPL-3.0-or-later */

import { Component } from '@angular/core';
import { BridgeCostService } from '../../../shared/services/bridge-cost.service';
import { DOLLARS_FORMATTER } from '../../../shared/classes/utility';
import { BridgeService } from '../../../shared/services/bridge.service';

/** A cost indicator toolbar widget. */
@Component({
    selector: 'cost-indicator',
    templateUrl: './cost-indicator.component.html',
    styleUrl: './cost-indicator.component.css'
})
export class CostIndicatorComponent {
  readonly toDollars = DOLLARS_FORMATTER.format;

  constructor(
    private readonly bridgeCostService: BridgeCostService,
    private readonly bridgeService: BridgeService,
  ) {}

  /** The pasta site has no steel cost; it shows total strand length instead. */
  get isPasta(): boolean {
    return this.bridgeService.designConditions.isPasta;
  }

  get pastaText(): string {
    const bridge = this.bridgeService.bridge;
    const lengthM = bridge.members.reduce((sum, member) => sum + this.bridgeService.getPastaLengthM(member), 0);
    return `Pasta: ${lengthM.toFixed(2)} m`;
  }

  get cost(): number {
    return this.bridgeCostService.allCosts;
  }
}
