/* SPDX-License-Identifier: GPL-3.0-or-later */
import { Subject } from 'rxjs';
import { PastaStrandSessionService, pastaBundleWidth } from './pasta-strand-session.service';
describe('Pasta drafting strand session', () => {
  const create = () => {
    const a = {}, b = {};
    const bridge = { bridge: { members: [a, b] } };
    const broker = { loadBridgeCompletion: new Subject(), editCommandCompletion: new Subject(),
      draftingPanelInvalidation: new Subject() };
    const session = new PastaStrandSessionService(bridge as never, broker as never);
    return { session, bridge, broker, a, b };
  };
  it('starts at one strand and retains exact optimized counts across reads', () => {
    const { session, a, b } = create();
    expect(session.read()).toEqual([1, 1]);
    expect(session.publish([4, 12], session.snapshot())).toBeTrue();
    expect(session.read()).toEqual([4, 12]);
    expect(session.countFor(a)).toBe(4); expect(session.countFor(b)).toBe(12);
  });
  it('copies counts so callers cannot corrupt the saved session', () => {
    const { session } = create(), values = [3, 5];
    session.publish(values, session.snapshot()); values[0] = 99;
    const read = session.read(); read[1] = 99;
    expect(session.read()).toEqual([3, 5]);
  });
  it('resets on same-length topology changes and rejects old optimizer data', () => {
    const { session, bridge } = create(), snapshot = session.snapshot();
    session.publish([4, 6], snapshot);
    bridge.bridge.members[0] = {};
    expect(session.read()).toEqual([1, 1]);
    expect(session.publish([4, 6], snapshot)).toBeFalse();
  });
  it('preserves counts when joint positions change but members are unchanged', () => {
    const { session, broker } = create(); session.publish([2, 7], session.snapshot());
    broker.editCommandCompletion.next(undefined);
    expect(session.read()).toEqual([2, 7]);
  });
  it('resets when a bridge is loaded, even if its member objects are reused', () => {
    const { session, broker } = create(), snapshot = session.snapshot(); session.publish([2, 7], snapshot);
    broker.loadBridgeCompletion.next(undefined); expect(session.read()).toEqual([1, 1]);
    expect(session.publish([2, 7], snapshot)).toBeFalse();
  });
  it('rejects invalid counts without replacing valid counts', () => {
    const { session } = create(), snapshot = session.snapshot(); session.publish([2, 7], snapshot);
    for (const counts of [[0, 1], [1.5, 2], [NaN, 1], [10001, 1], [1]]) {
      expect(session.publish(counts, snapshot)).toBeFalse();
    }
    expect(session.read()).toEqual([2, 7]);
  });
  it('requests a redraw after an optimized count changes', () => {
    const { session, broker } = create(); let redraws = 0;
    broker.draftingPanelInvalidation.subscribe(() => redraws++);
    session.publish([4, 2], session.snapshot()); expect(redraws).toBe(1);
    session.publish([4, 2], session.snapshot()); expect(redraws).toBe(1);
  });
  it('makes schematic bundles wider without unbounded strokes', () => {
    expect(pastaBundleWidth(1)).toBe(2);
    expect(pastaBundleWidth(4)).toBeGreaterThan(pastaBundleWidth(1));
    expect(pastaBundleWidth(10000)).toBe(16);
  });
});
