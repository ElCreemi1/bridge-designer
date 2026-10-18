/* Copyright (c) 2025-2026 Gene Ressler
   SPDX-License-Identifier: GPL-3.0-or-later */
import { Injectable, OnDestroy } from '@angular/core';
import { Subscription } from 'rxjs';
import { AnalysisService, AnalysisStatus } from '../../shared/services/analysis.service';
import { BridgeService } from '../../shared/services/bridge.service';
import { ContestParametersService } from '../../shared/services/contest-parameters.service';
import { EventBrokerService } from '../../shared/services/event-broker.service';
import { CenterLoadShare, centerLoadShares } from './center-load';

export type CenterLoadResult = {
  forceKN: number; shares: CenterLoadShare[]; displacements: Float64Array;
  memberForces: Float64Array; signedRatios: Float64Array;
  overStrengthCount: number; peakRatio: number; centerDeflectionM: number; slendernessFailed: boolean;
};

/** Component-scoped analyzer. Never publishes analysisCompletion or populates bridge-member results. */
@Injectable()
export class CenterLoadAnalysisService implements OnDestroy {
  private readonly unitAnalysis: AnalysisService;
  private readonly subscriptions = new Subscription();
  private ready = false;
  constructor(private readonly bridgeService: BridgeService, broker: EventBrokerService) {
    // The current solver multiplies axle input by 1.75 * 1.33. A private single-axle
    // configuration therefore supplies one applied kN at each interior deck joint.
    // No shared contest parameters, bridge data, or standard truck analyzer are modified.
    const unitAxle = 1 / (1.75 * 1.33);
    const parameters = new ContestParametersService({
      verbose: true, value: JSON.stringify({ xs: [unitAxle, 0], xh: [unitAxle, 0] }),
    });
    this.unitAnalysis = new AnalysisService(bridgeService, parameters, broker);
    this.subscriptions.add(broker.editCommandCompletion.subscribe(() => { this.ready = false; }));
    this.subscriptions.add(broker.loadBridgeCompletion.subscribe(() => { this.ready = false; }));
  }

  /**
   * Recover axial force directly from the solver's Float64 displacements. The
   * legacy force getter passes displacements through Float32 vec2 buffers, which
   * loses significant precision when subtracting dead load from dead-plus-unit load.
   * This is the same EA/L axial-force relation, without that intermediate rounding.
   */
  private memberForce64(loadCase: number, memberIndex: number): number {
    const member = this.bridgeService.bridge.members[memberIndex];
    const dx = member.b.x - member.a.x;
    const dy = member.b.y - member.a.y;
    const length = Math.hypot(dx, dy);
    if (!Number.isFinite(length) || length <= 0) throw new Error('A member has invalid length.');
    const displacementX = this.unitAnalysis.getJointDisplacementX(loadCase, member.b.index) -
      this.unitAnalysis.getJointDisplacementX(loadCase, member.a.index);
    const displacementY = this.unitAnalysis.getJointDisplacementY(loadCase, member.b.index) -
      this.unitAnalysis.getJointDisplacementY(loadCase, member.a.index);
    return (member.shape.area * member.material.e / length) *
      ((dx / length) * displacementX + (dy / length) * displacementY);
  }

  run(forceKN: number): CenterLoadResult {
    if (!Number.isFinite(forceKN) || forceKN < 0 || forceKN > 1000) throw new Error('Choose a force from 0 to 1000 kN.');
    const bridge = this.bridgeService.bridge;
    const deck = bridge.joints.slice(0, this.bridgeService.designConditions.loadedJointCount);
    const unitShares = centerLoadShares(deck.map(joint => joint.x), 1);
    if (unitShares.some(share => share.jointIndex === 0)) throw new Error('Unsupported center-load deck arrangement.');
    if (!this.ready) {
      this.unitAnalysis.analyzeQuietly({ populateBridgeMembers: false });
      if (this.unitAnalysis.status === AnalysisStatus.UNSTABLE || this.unitAnalysis.status === AnalysisStatus.NONE) {
        throw new Error('The bridge is unstable; add bracing or correct its connectivity before loading it.');
      }
      // Keep the original equilibrium check and tolerance; fix precision, not the test.
      for (const share of unitShares) {
        let vertical = 0;
        bridge.members.forEach((member, i) => {
          const sign = member.a.index === share.jointIndex ? 1 : member.b.index === share.jointIndex ? -1 : 0;
          if (sign) {
            const increment = this.memberForce64(share.jointIndex, i) - this.memberForce64(0, i);
            vertical += sign * increment * (member.b.y - member.a.y) / member.lengthM;
          }
        });
        // A vertically restrained deck joint absorbs the unit load directly: its increment is zero.
        if (Math.abs(vertical) > 1e-5 && Math.abs(vertical - 1) > 1e-5) {
          throw new Error('Unit-load normalization no longer matches the structural solver.');
        }
      }
      this.ready = true;
    }
    const combine = (get: (loadCase: number) => number): number => {
      const dead = get(0);
      const value = dead + forceKN * unitShares.reduce((sum, share) =>
        sum + share.forceKN * (get(share.jointIndex) - dead), 0);
      if (!Number.isFinite(value)) throw new Error('The solver returned a non-finite response.');
      return value;
    };
    const displacements = new Float64Array(2 * bridge.joints.length);
    bridge.joints.forEach((_joint, index) => {
      displacements[2 * index] = combine(loadCase => this.unitAnalysis.getJointDisplacementX(loadCase, index));
      displacements[2 * index + 1] = combine(loadCase => this.unitAnalysis.getJointDisplacementY(loadCase, index));
    });
    const memberForces = new Float64Array(bridge.members.length);
    const signedRatios = new Float64Array(bridge.members.length);
    let overStrengthCount = 0, peakRatio = 0;
    bridge.members.forEach((_member, index) => {
      const force = combine(loadCase => this.memberForce64(loadCase, index));
      const strength = force < 0 ? this.unitAnalysis.getMemberCompressiveStrength(index) : this.unitAnalysis.getMemberTensileStrength(index);
      if (!Number.isFinite(strength) || strength <= 0) throw new Error('A member has an invalid model strength.');
      memberForces[index] = force; signedRatios[index] = force / strength;
      const ratio = Math.abs(signedRatios[index]);
      peakRatio = Math.max(peakRatio, ratio);
      if (ratio > 1) overStrengthCount++;
    });
    return { forceKN, shares: centerLoadShares(deck.map(joint => joint.x), forceKN), displacements, memberForces, signedRatios,
      overStrengthCount, peakRatio,
      centerDeflectionM: unitShares.reduce((sum, share) => sum + share.forceKN * displacements[2 * share.jointIndex + 1], 0),
      slendernessFailed: !this.bridgeService.isPassingSlendernessCheck };
  }
  ngOnDestroy(): void { this.subscriptions.unsubscribe(); }
}
