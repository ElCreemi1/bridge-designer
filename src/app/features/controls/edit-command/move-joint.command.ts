/* Copyright (c) 2025-2026 Gene Ressler
   SPDX-License-Identifier: GPL-3.0-or-later */
import { BridgeModel } from '../../../shared/classes/bridge.model';
import { EditCommand, EditEffect } from '../../../shared/classes/editing';
import { Point2DInterface } from '../../../shared/classes/graphics';
import { Joint } from '../../../shared/classes/joint.model';
import { SelectedElements } from '../../drafting/shared/selected-elements-service';
import { PastaStrandSessionService } from '../../center-load/pasta-strand-session.service';
import { ContextElementRef, RehydrationContext, DehydrationContext, DehydratedEditCommand, EditCommandTag } from './dehydration-context';
import { MemberSplitter, DehydratedMemberSplitter } from './member-splitter';

type BatchMove = { joint: Joint; toJoint: Joint };
type StrandEdit = { service: PastaStrandSessionService; before: number[]; after: number[] };

export class MoveJointCommand extends EditCommand {
  private _effectsMask: number = NaN;
  private constructor(
    private readonly joint: Joint, private readonly toJoint: Joint, private readonly bridge: BridgeModel,
    private readonly memberSplitter: MemberSplitter | undefined,
    private readonly batch?: BatchMove[], private readonly strandEdit?: StrandEdit,
  ) { super(batch ? 'Apply pasta target optimization' : `Move joint to (${toJoint.x}, ${toJoint.y})`); }

  public static create(joint: Joint, newLocation: Point2DInterface, bridge: BridgeModel, selectedElements: SelectedElements): MoveJointCommand {
    return new MoveJointCommand(joint, new Joint(joint.index, newLocation.x, newLocation.y, false), bridge,
      MemberSplitter.createForMove(bridge.joints, bridge.members, selectedElements.selectedMembers));
  }

  /** Apply already-validated optimizer geometry simultaneously, preserving all member identities.
   * Live undo/redo includes strand counts. Counts remain session-only, as before;
   * serialized commands retain coordinate undo, not material-count session data.
   */
  public static forPasta(bridge: BridgeModel, positions: readonly Point2DInterface[],
    service: PastaStrandSessionService, before: readonly number[], after: readonly number[]): MoveJointCommand {
    if (!bridge.joints.length || positions.length !== bridge.joints.length ||
        positions.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y)) ||
        [before, after].some(counts => counts.length !== bridge.members.length ||
          counts.some(n => !Number.isInteger(n) || n < 1 || n > 10000))) throw new Error('Invalid optimization result.');
    const batch: BatchMove[] = [];
    bridge.joints.forEach((joint, i) => {
      const p = positions[i];
      if (p.x === joint.x && p.y === joint.y) return;
      if (joint.isFixed) throw new Error('Optimization cannot move a fixed joint.');
      batch.push({ joint, toJoint: new Joint(joint.index, p.x, p.y, joint.isFixed) });
    });
    const first = batch[0] ?? { joint: bridge.joints[0], toJoint: new Joint(0, bridge.joints[0].x, bridge.joints[0].y, bridge.joints[0].isFixed) };
    return new MoveJointCommand(first.joint, first.toJoint, bridge, undefined, batch,
      { service, before: Array.from(before), after: Array.from(after) });
  }
  override get effectsMask(): number {
    if (this.batch) return EditEffect.JOINTS | EditEffect.MEMBERS | EditEffect.CHANGE;
    if (isNaN(this._effectsMask)) {
      this._effectsMask = this.memberSplitter!.hasSplit || this.bridge.members.some(member => member.hasJoint(this.joint))
        ? EditEffect.JOINTS | EditEffect.MEMBERS | EditEffect.CHANGE : EditEffect.JOINTS | EditEffect.CHANGE;
    }
    return this._effectsMask;
  }
  public override do(): void {
    if (this.batch) { this.exchangeBatch(this.strandEdit?.after); return; }
    const bridgeJoint = this.bridge.joints[this.toJoint.index];
    bridgeJoint.swapContents(this.toJoint);
    try { this.memberSplitter!.do(); }
    catch (error) { bridgeJoint.swapContents(this.toJoint); throw error; }
  }
  public override undo(): void {
    if (this.batch) { this.exchangeBatch(this.strandEdit?.before); return; }
    this.memberSplitter!.undo();
    this.bridge.joints[this.toJoint.index].swapContents(this.toJoint);
  }
  private exchangeBatch(counts?: number[]): void {
    const batch = this.batch!;
    if (batch.some(item => this.bridge.joints[item.joint.index] !== item.joint)) throw new Error('Bridge changed since optimization.');
    batch.forEach(item => item.joint.swapContents(item.toJoint));
    try {
      if (counts && this.strandEdit && !this.strandEdit.service.publish(counts, this.strandEdit.service.snapshot())) {
        throw new Error('Unable to apply strand counts.');
      }
    } catch (error) { batch.forEach(item => item.joint.swapContents(item.toJoint)); throw error; }
  }
  override dehydrate(context: DehydrationContext): State {
    const state: State = { tag: 'move-joint', joint: context.getJointRef(this.joint), toJoint: context.getJointRef(this.toJoint) };
    if (this.batch) state.batch = this.batch.map(item => ({ joint: context.getJointRef(item.joint), toJoint: context.getJointRef(item.toJoint) }));
    else state.splitter = this.memberSplitter!.dehydrate(context);
    return state;
  }
  static rehydrate(context: RehydrationContext, rawState: DehydratedEditCommand, bridge: BridgeModel, selectedElements: SelectedElements): MoveJointCommand {
    const state = rawState as State;
    if (state.batch) return new MoveJointCommand(context.rehydrateJointRef(state.joint), context.rehydrateJointRef(state.toJoint), bridge,
      undefined, state.batch.map(item => ({ joint: context.rehydrateJointRef(item.joint), toJoint: context.rehydrateJointRef(item.toJoint) })));
    return new MoveJointCommand(context.rehydrateJointRef(state.joint), context.rehydrateJointRef(state.toJoint), bridge,
      MemberSplitter.rehydrate(context, state.splitter!, bridge.joints, bridge.members, selectedElements));
  }
}
type State = {
  tag: EditCommandTag; joint: ContextElementRef; toJoint: ContextElementRef;
  splitter?: DehydratedMemberSplitter;
  batch?: { joint: ContextElementRef; toJoint: ContextElementRef }[];
};
