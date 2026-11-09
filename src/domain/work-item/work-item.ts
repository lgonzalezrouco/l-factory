/**
 * Work-item state machine (R-10, R-11). Pure: no I/O, no clock, no Temporal (D-21).
 *
 * The application layer calls `transition` once per incoming event and acts on
 * the state it returns.
 */
import { Data, Result, Schema } from "effect";

/**
 * The only list of run-bearing states. An item has an active run exactly when
 * its state is one of these (R-10). The kill switch, the asker field, and
 * `isRunning` all read it.
 */
export const RunStage = Schema.Literals(["triage", "spec", "building", "review"]);
export type RunStage = typeof RunStage.Type;

/** Why a run ended in `failed`: over budget (R-19) or out of retries (R-20). */
export const FailureReason = Schema.Literals(["budget", "retries-exhausted"]);
export type FailureReason = typeof FailureReason.Type;

/**
 * The nine R-10 states. `_tag` is the state name, so `Status` derives from this
 * union and the transition table, a mapped type over `Status`, fails to compile
 * when a tenth member appears.
 *
 * The run-bearing states share one member tagged by `RunStage`, so their list is
 * not repeated. Only two states carry a payload. "Waiting on human" remembers
 * which stage asked, and `failed` keeps why it failed. Neither can be built
 * without its payload, and the asker cannot name a stage that has no run.
 */
export const WorkItemState = Schema.Union([
  Schema.TaggedStruct("new", {}),
  Schema.Struct({ _tag: RunStage }),
  Schema.TaggedStruct("waiting-on-human", { asker: RunStage }),
  Schema.TaggedStruct("ready", {}),
  Schema.TaggedStruct("merged", {}),
  Schema.TaggedStruct("failed", { reason: FailureReason }),
]);
export type WorkItemState = typeof WorkItemState.Type;
export type Status = WorkItemState["_tag"];

/** Intersection, not `Extract`, so the shared run-stage member narrows too. */
type StateOf<S extends Status> = WorkItemState & { readonly _tag: S };

/** True when the item has an active run. The application starts a run for `state._tag` when this holds. */
export const isRunning = (state: WorkItemState): state is StateOf<RunStage> =>
  Schema.is(RunStage)(state._tag);

/**
 * Inputs to the machine. The three run outcomes (R-78 `done`, `needs-input`,
 * `failed`) carry the stage whose run produced them, so a duplicate or late
 * outcome from an earlier stage is rejected instead of advancing the item a
 * second time.
 */
export const WorkItemEvent = Schema.TaggedUnion({
  TriageStarted: {},
  StepSucceeded: { stage: RunStage },
  NeedsHuman: { stage: RunStage },
  HumanAnswered: {},
  RunFailed: { stage: RunStage, reason: FailureReason },
  PrMerged: {},
});
export type WorkItemEvent = typeof WorkItemEvent.Type;
type EventTag = WorkItemEvent["_tag"];
type EventOf<E extends EventTag> = Extract<WorkItemEvent, { readonly _tag: E }>;

/** Global kill switch (R-11). While engaged, no transition may enter a run-bearing state. */
export type KillSwitch = "engaged" | "released";

/** The table has no cell for this (state, event) pair, or a run outcome named another stage. */
export class InvalidTransition extends Data.TaggedError("InvalidTransition")<{
  readonly from: WorkItemState;
  readonly event: WorkItemEvent;
}> {}

/** The transition is legal but would start a run while the kill switch is engaged. The item stays in `from`. */
export class KillSwitchEngaged extends Data.TaggedError("KillSwitchEngaged")<{
  readonly from: WorkItemState;
  readonly event: WorkItemEvent;
  readonly blocked: RunStage;
}> {}

export type TransitionRejected = InvalidTransition | KillSwitchEngaged;

type Cell<S extends Status, E extends EventTag> = (
  state: StateOf<S>,
  event: EventOf<E>,
) => WorkItemState;
type Row<S extends Status> = { readonly [E in EventTag]?: Cell<S, E> };
/** One row per status, required. A missing cell is an invalid transition. */
type Table = { readonly [S in Status]: Row<S> };

const advancesTo = (next: WorkItemState): Row<RunStage> => ({
  StepSucceeded: () => next,
  NeedsHuman: (state) => ({ _tag: "waiting-on-human", asker: state._tag }),
  RunFailed: (_, event) => ({ _tag: "failed", reason: event.reason }),
});

const table: Table = {
  new: { TriageStarted: () => ({ _tag: "triage" }) },
  triage: advancesTo({ _tag: "spec" }),
  spec: advancesTo({ _tag: "building" }),
  building: advancesTo({ _tag: "review" }),
  review: advancesTo({ _tag: "ready" }),
  "waiting-on-human": { HumanAnswered: (state) => ({ _tag: state.asker }) },
  ready: { PrMerged: () => ({ _tag: "merged" }) },
  merged: {},
  failed: {},
};

type AnyCell = (state: WorkItemState, event: WorkItemEvent) => WorkItemState;

const lookup = (state: WorkItemState, event: WorkItemEvent): WorkItemState | undefined => {
  if ("stage" in event && event.stage !== state._tag) return undefined;
  // Row and column are picked by `state._tag` and `event._tag`, so the cell's
  // narrowed parameter types hold. TypeScript cannot correlate the two indexes.
  const cell = table[state._tag][event._tag] as AnyCell | undefined;
  return cell?.(state, event);
};

/**
 * Applies one event to one state. Total and deterministic, and refusals come
 * back as typed failures, never thrown.
 *
 * Replaying an event that was already applied is refused with
 * `InvalidTransition`, because no state accepts the event that led into it.
 * A duplicate delivery therefore cannot move an item twice.
 */
export const transition = (
  state: WorkItemState,
  event: WorkItemEvent,
  killSwitch: KillSwitch,
): Result.Result<WorkItemState, TransitionRejected> => {
  const next = lookup(state, event);
  if (next === undefined) return Result.fail(new InvalidTransition({ from: state, event }));
  if (killSwitch === "engaged" && isRunning(next)) {
    return Result.fail(new KillSwitchEngaged({ from: state, event, blocked: next._tag }));
  }
  return Result.succeed(next);
};
