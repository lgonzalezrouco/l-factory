import { Data, Result, Schema } from "effect";

export const RunStage = Schema.Literals(["triage", "spec", "building", "review"]);
export type RunStage = typeof RunStage.Type;

export const FailureReason = Schema.Literals(["budget", "retries-exhausted", "killed"]);
export type FailureReason = typeof FailureReason.Type;

export const TicketState = Schema.Union([
  Schema.TaggedStruct("new", {}),
  Schema.Struct({ _tag: RunStage }),
  Schema.TaggedStruct("waiting-on-human", { asker: RunStage }),
  Schema.TaggedStruct("ready", {}),
  Schema.TaggedStruct("merged", {}),
  Schema.TaggedStruct("failed", { reason: FailureReason }),
]);
export type TicketState = typeof TicketState.Type;
export type Status = TicketState["_tag"];

/** Intersection, not `Extract`, so the shared run-stage member narrows too. */
type StateOf<S extends Status> = TicketState & { readonly _tag: S };

export const isRunning = (state: TicketState): state is StateOf<RunStage> =>
  Schema.is(RunStage)(state._tag);

export const TicketEvent = Schema.TaggedUnion({
  TriageStarted: {},
  StepSucceeded: { stage: RunStage },
  NeedsHuman: { stage: RunStage },
  HumanAnswered: {},
  RunFailed: { stage: RunStage, reason: FailureReason },
  PrMerged: {},
  Paused: {},
  Killed: {},
});
export type TicketEvent = typeof TicketEvent.Type;
type EventTag = TicketEvent["_tag"];
type EventOf<E extends EventTag> = Extract<TicketEvent, { readonly _tag: E }>;

export type KillSwitch = "engaged" | "released";

export class InvalidTransition extends Data.TaggedError("InvalidTransition")<{
  readonly from: TicketState;
  readonly event: TicketEvent;
}> {}

export class KillSwitchEngaged extends Data.TaggedError("KillSwitchEngaged")<{
  readonly from: TicketState;
  readonly event: TicketEvent;
  readonly blocked: RunStage;
}> {}

export type TransitionRejected = InvalidTransition | KillSwitchEngaged;

type Cell<S extends Status, E extends EventTag> = (
  state: StateOf<S>,
  event: EventOf<E>,
) => TicketState;
type Row<S extends Status> = { readonly [E in EventTag]?: Cell<S, E> };
type Table = { readonly [S in Status]: Row<S> };

const killed = (): TicketState => ({ _tag: "failed", reason: "killed" });

const advancesTo = (next: TicketState): Row<RunStage> => ({
  StepSucceeded: () => next,
  NeedsHuman: (state) => ({ _tag: "waiting-on-human", asker: state._tag }),
  RunFailed: (_, event) => ({ _tag: "failed", reason: event.reason }),
  Paused: (state) => ({ _tag: "waiting-on-human", asker: state._tag }),
  Killed: killed,
});

const table: Table = {
  new: { TriageStarted: () => ({ _tag: "triage" }), Killed: killed },
  triage: advancesTo({ _tag: "spec" }),
  spec: advancesTo({ _tag: "building" }),
  building: advancesTo({ _tag: "review" }),
  review: advancesTo({ _tag: "ready" }),
  "waiting-on-human": { HumanAnswered: (state) => ({ _tag: state.asker }), Killed: killed },
  ready: { PrMerged: () => ({ _tag: "merged" }), Killed: killed },
  merged: {},
  failed: {},
};

const isStaleOutcome = (state: TicketState, event: TicketEvent): boolean =>
  "stage" in event && event.stage !== state._tag;

const lookup = <S extends Status, E extends EventTag>(
  state: StateOf<S>,
  event: EventOf<E>,
): TicketState | undefined => {
  if (isStaleOutcome(state, event)) return undefined;
  const row: Row<S> = table[state._tag];
  const cell: Cell<S, E> | undefined = row[event._tag];
  return cell?.(state, event);
};

export const transition = (
  state: TicketState,
  event: TicketEvent,
  killSwitch: KillSwitch,
): Result.Result<TicketState, TransitionRejected> => {
  const next = lookup(state, event);
  if (next === undefined) return Result.fail(new InvalidTransition({ from: state, event }));
  if (killSwitch === "engaged" && isRunning(next)) {
    return Result.fail(new KillSwitchEngaged({ from: state, event, blocked: next._tag }));
  }
  return Result.succeed(next);
};
