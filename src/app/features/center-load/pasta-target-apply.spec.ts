/* SPDX-License-Identifier: GPL-3.0-or-later */
import { Joint } from '../../shared/classes/joint.model';
import { MoveJointCommand } from '../controls/edit-command/move-joint.command';
import { ContextElementRef } from '../controls/edit-command/dehydration-context';
describe('Applying a pasta optimization', () => {
  const create = () => {
    const joints = [new Joint(0, 0, 0, true), new Joint(1, 1, 0, true), new Joint(2, 0.5, 0.2, false)];
    const members = [{ a: joints[0], b: joints[2] }, { a: joints[1], b: joints[2] }];
    const bridge = { joints, members };
    let values = [1, 2], reject = false;
    const session = { snapshot: () => ({}), publish: (counts: readonly number[]) => {
      if (reject) return false; values = Array.from(counts); return true;
    } };
    const target = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0.6, y: 0.3 }];
    const command = () => MoveJointCommand.forPasta(bridge as never, target, session as never, [1, 2], [4, 5]);
    return { joints, members, bridge, target, command, session, values: () => values, reject: () => { reject = true; } };
  };
  it('applies and undoes geometry and counts together without replacing members', () => {
    const t = create(), command = t.command(), originalMember = t.members[0];
    command.do(); expect(t.joints[2].x).toBe(0.6); expect(t.values()).toEqual([4, 5]);
    expect(t.members[0]).toBe(originalMember); expect(t.members[0].b).toBe(t.joints[2]);
    command.undo(); expect(t.joints[2].x).toBe(0.5); expect(t.joints[2].y).toBe(0.2); expect(t.values()).toEqual([1, 2]);
    command.do(); expect(t.joints[2].y).toBe(0.3); expect(t.values()).toEqual([4, 5]);
  });
  it('rejects moving a fixed joint before making changes', () => {
    const t = create(); t.target[0].x = 0.1;
    expect(() => t.command()).toThrowError(/fixed joint/); expect(t.joints[0].x).toBe(0);
  });
  it('rolls coordinate changes back when count application fails', () => {
    const t = create(), command = t.command(); t.reject();
    expect(() => command.do()).toThrow(); expect(t.joints[2].x).toBe(0.5); expect(t.values()).toEqual([1, 2]);
  });
  it('supports a counts-only result as one undoable operation', () => {
    const t = create(), target = t.joints.map(j => ({ x: j.x, y: j.y }));
    const command = MoveJointCommand.forPasta(t.bridge as never, target, t.session as never, [1, 2], [3, 4]);
    command.do(); expect(t.values()).toEqual([3, 4]); command.undo(); expect(t.values()).toEqual([1, 2]);
    expect(t.joints[2].x).toBe(0.5);
  });
  it('retains coordinate undo through the existing move-joint serialization tag', () => {
    const t = create(), command = t.command(), extern: Joint[] = [];
    command.do();
    const context = { getJointRef: (joint: Joint): ContextElementRef => {
      if (t.joints.includes(joint)) return { bridge: joint.index };
      extern.push(new Joint(joint.index, joint.x, joint.y, joint.isFixed)); return { extern: extern.length - 1 };
    } };
    const state = JSON.parse(JSON.stringify(command.dehydrate(context as never)));
    const reader = { rehydrateJointRef: (ref: ContextElementRef) => ref.bridge !== undefined ? t.joints[ref.bridge] : extern[ref.extern!] };
    const restored = MoveJointCommand.rehydrate(reader as never, state, t.bridge as never, {} as never);
    restored.undo(); expect(t.joints[2].x).toBe(0.5); restored.do(); expect(t.joints[2].x).toBe(0.6);
    expect(state.tag).toBe('move-joint');
  });
});
