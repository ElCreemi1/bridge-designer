/* Copyright (c) 2025-2026 Gene Ressler
   SPDX-License-Identifier: GPL-3.0-or-later */
import { Subject } from 'rxjs';
import { centerLoadShares } from './center-load';
import { CenterLoadAnalysisService } from './center-load-analysis.service';
import { BridgeService } from '../../shared/services/bridge.service';
import { EventBrokerService } from '../../shared/services/event-broker.service';
import { DeckType, LoadType } from '../../shared/services/design-conditions.service';
import { InventoryService } from '../../shared/services/inventory.service';
import { Joint } from '../../shared/classes/joint.model';
import { Member } from '../../shared/classes/member.model';

describe('center-load distribution', () => {
  it('loads an existing midpoint joint directly', () => {
    expect(centerLoadShares([0, 4, 8], 100)).toEqual([{ jointIndex: 1, forceKN: 100 }]);
  });
  it('preserves total force and moment for a nonuniform bracketing panel', () => {
    const xs = [0, 2, 7, 10], shares = centerLoadShares(xs, 100);
    expect(shares[0].forceKN).toBeCloseTo(40, 10);
    expect(shares[1].forceKN).toBeCloseTo(60, 10);
    expect(shares.reduce((sum, share) => sum + share.forceKN, 0)).toBeCloseTo(100, 10);
    expect(shares.reduce((sum, share) => sum + share.forceKN * xs[share.jointIndex], 0)).toBeCloseTo(500, 10);
  });
  it('handles zero load and rejects invalid geometry or force', () => {
    expect(centerLoadShares([0, 4, 8], 0)[0].forceKN).toBe(0);
    expect(() => centerLoadShares([0, 4, 8], -1)).toThrow();
    expect(() => centerLoadShares([0, 4, 8], NaN)).toThrow();
    expect(() => centerLoadShares([0, 4, 8], Infinity)).toThrow();
    expect(() => centerLoadShares([0, 4, 4], 10)).toThrow();
    expect(() => centerLoadShares([0, 8], 10)).toThrow();
  });
});

describe('center-load analysis with the existing stiffness solver', () => {
  let solver: CenterLoadAnalysisService;
  let members: Member[];
  let area: number, e: number;
  beforeEach(() => {
    spyOn(console, 'log');
    const stock = new InventoryService(), material = stock.materials[0], shape = stock.getShape(0, 22);
    area = shape.area; e = material.e;
    const joints = [new Joint(0, 0, 0, true), new Joint(1, 4, 0, true), new Joint(2, 8, 0, true), new Joint(3, 4, 4, false)];
    members = [[0, 1], [1, 2], [0, 3], [3, 2], [1, 3]].map(([a, b], i) => new Member(i, joints[a], joints[b], material, shape));
    const bridge = {
      bridge: { joints, members }, isPassingSlendernessCheck: true,
      designConditions: { loadedJointCount: 3, deckType: DeckType.MEDIUM_STRENGTH, loadType: LoadType.STANDARD_TRUCK,
        isPier: false, isArch: false, isLeftAnchorage: false, isRightAnchorage: false },
    } as unknown as BridgeService;
    const broker = { editCommandCompletion: new Subject(), loadBridgeCompletion: new Subject() } as unknown as EventBrokerService;
    solver = new CenterLoadAnalysisService(bridge, broker);
  });
  afterEach(() => solver.ngOnDestroy());
  it('matches incremental forces of a symmetric five-member reference truss', () => {
    const dead = solver.run(0), loaded = solver.run(100);
    const expected = [50, 50, -100 / Math.SQRT2, -100 / Math.SQRT2, 100];
    expected.forEach((force, i) => expect(loaded.memberForces[i] - dead.memberForces[i]).toBeCloseTo(force, 6));
  });
  it('matches the virtual-work center deflection of the reference truss', () => {
    const dead = solver.run(0), loaded = solver.run(100);
    const expected = -100 * (6 + 4 * Math.SQRT2) / (e * area);
    expect(loaded.centerDeflectionM - dead.centerDeflectionM).toBeCloseTo(expected, 9);
  });
  it('scales only the added load and leaves bridge-member report data unchanged', () => {
    const before = members.map(member => [member.maxCompression, member.maxTension, member.compressionStrength, member.tensionStrength]);
    const dead = solver.run(0), one = solver.run(100), two = solver.run(200);
    members.forEach((_member, i) => expect(two.memberForces[i] - dead.memberForces[i]).toBeCloseTo(2 * (one.memberForces[i] - dead.memberForces[i]), 6));
    expect(members.map(member => [member.maxCompression, member.maxTension, member.compressionStrength, member.tensionStrength])).toEqual(before);
  });
  it('rejects out-of-range loads and reports an unstable bridge without fabricated results', () => {
    expect(() => solver.run(1001)).toThrow();
    members.pop();
    expect(() => solver.run(100)).toThrowError(/unstable/i);
  });
});
