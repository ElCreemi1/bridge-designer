/* SPDX-License-Identifier: GPL-3.0-or-later */
import { bridgePanelIndices, PastaBridgeControlsState } from './pasta-bridge-controls-state.service';
import { PastaBridgeControlsComponent } from './pasta-bridge-controls.component';
import { Subject } from 'rxjs';

describe('Full-bridge control wiring', () => {
  it('resolves displayed M numbers without confusing them with array positions', () => {
    expect(bridgePanelIndices('M9, 2; m7', [2, 7, 9])).toEqual([2, 0, 1]);
    for (const text of ['', 'M0', 'M1.5', 'M99', 'M2,2']) expect(() => bridgePanelIndices(text, [2, 7, 9])).toThrow();
  });
  it('preserves layout across mode switches but resets it for changed connectivity', () => {
    const state = new PastaBridgeControlsState(), b = {}, members = [{}, {}];
    state.synchronize(b, members, 'A'); state.top = 'M2'; state.bottom = 'M1'; state.braceStrands = 3;
    state.synchronize(b, members, 'A'); expect(state.top).toBe('M2'); expect(state.braceStrands).toBe(3);
    state.synchronize(b, members, 'B'); expect(state.top).toBe(''); expect(state.bottom).toBe(''); expect(state.massG).toBe(2000);
  });
  const fixture = () => {
    const joints = [{ x: 0, y: 0 }, { x: 0.5, y: 0 }, { x: 1, y: 0 }, { x: 0.5, y: 0.2 }];
    const ends = [[0, 1], [1, 2], [0, 3], [1, 3], [2, 3]];
    const bridge = { bridge: { joints, members: ends.map(([a, b], i) => ({ a: { index: a }, b: { index: b }, number: i + 1 })) },
      designConditions: { isPasta: true, loadedJointCount: 3, isPier: false, isArch: false, isLeftAnchorage: false, isRightAnchorage: false } };
    const state = new PastaBridgeControlsState(), broker = { editCommandCompletion: new Subject(), loadBridgeCompletion: new Subject() };
    const c = new PastaBridgeControlsComponent(state, bridge as never, { read: () => [2, 2, 3, 1, 3] } as never,
      broker as never, { maxStrandLengthM: 0.6 } as never, { setStaticResponse: () => {} } as never, { markForCheck: () => {} } as never);
    c.ngOnInit(); state.top = 'M3,M5'; state.bottom = 'M1,M2';
    return { c, state, broker };
  };
  it('runs the 3D solver with a total 2 kg load and clears stale results on error', () => {
    const { c, state } = fixture(); c.run();
    expect(c.result).toBeDefined(); expect(c.result!.memberForces.length).toBe(18); expect(c.result!.totalStrandCount).toBe(30);
    expect(c.message).toContain('full 3D solver'); state.massG = NaN; c.run();
    expect(c.result).toBeUndefined(); expect(c.message).toContain('Total hanging mass'); c.ngOnDestroy();
  });
  it('invalidates edited results and resets panel assignments on bridge load', () => {
    const { c, state, broker } = fixture(); c.run(); expect(c.result).toBeDefined();
    broker.editCommandCompletion.next(null); expect(c.result).toBeUndefined(); expect(state.top).toBe('M3,M5');
    broker.loadBridgeCompletion.next(null); expect(state.top).toBe(''); expect(state.bottom).toBe(''); c.ngOnDestroy();
  });
});
