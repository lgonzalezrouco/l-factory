import { Result, Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  isRunning,
  type RunStage,
  type Status,
  type TransitionRejected,
  transition,
  type WorkItemEvent,
  WorkItemState,
} from "./work-item.js";

type EventTag = WorkItemEvent["_tag"];
type Outcome = WorkItemState | TransitionRejected["_tag"];

const outcome = (result: Result.Result<WorkItemState, TransitionRejected>): Outcome =>
  Result.isSuccess(result) ? result.success : result.failure._tag;

const states = {
  new: { _tag: "new" },
  triage: { _tag: "triage" },
  spec: { _tag: "spec" },
  building: { _tag: "building" },
  review: { _tag: "review" },
  "waiting-on-human": { _tag: "waiting-on-human", asker: "building" },
  ready: { _tag: "ready" },
  merged: { _tag: "merged" },
  failed: { _tag: "failed", reason: "budget" },
} as const satisfies { readonly [S in Status]: WorkItemState };

const allStates = Object.values(states);

// A run state receives outcomes from its own run. The other states have no run,
// so each gets the outcome most plausibly delivered late to it.
const outcomeStage: { readonly [S in Status]: RunStage } = {
  new: "triage",
  triage: "triage",
  spec: "spec",
  building: "building",
  review: "review",
  "waiting-on-human": "building",
  ready: "review",
  merged: "review",
  failed: "building",
};

const eventsFor = (stage: RunStage) =>
  ({
    TriageStarted: { _tag: "TriageStarted" },
    StepSucceeded: { _tag: "StepSucceeded", stage },
    NeedsHuman: { _tag: "NeedsHuman", stage },
    HumanAnswered: { _tag: "HumanAnswered" },
    RunFailed: { _tag: "RunFailed", stage, reason: "retries-exhausted" },
    PrMerged: { _tag: "PrMerged" },
  }) as const satisfies { readonly [E in EventTag]: WorkItemEvent };

const x = "InvalidTransition";

// oxfmt-ignore
const approved: { readonly [S in Status]: { readonly [E in EventTag]: Outcome } } = {
  new:                { TriageStarted: { _tag: "triage" }, StepSucceeded: x,                    NeedsHuman: x,                                               HumanAnswered: x,                    RunFailed: x,                                               PrMerged: x },
  triage:             { TriageStarted: x,                  StepSucceeded: { _tag: "spec" },     NeedsHuman: { _tag: "waiting-on-human", asker: "triage" },   HumanAnswered: x,                    RunFailed: { _tag: "failed", reason: "retries-exhausted" }, PrMerged: x },
  spec:               { TriageStarted: x,                  StepSucceeded: { _tag: "building" }, NeedsHuman: { _tag: "waiting-on-human", asker: "spec" },     HumanAnswered: x,                    RunFailed: { _tag: "failed", reason: "retries-exhausted" }, PrMerged: x },
  building:           { TriageStarted: x,                  StepSucceeded: { _tag: "review" },   NeedsHuman: { _tag: "waiting-on-human", asker: "building" }, HumanAnswered: x,                    RunFailed: { _tag: "failed", reason: "retries-exhausted" }, PrMerged: x },
  review:             { TriageStarted: x,                  StepSucceeded: { _tag: "ready" },    NeedsHuman: { _tag: "waiting-on-human", asker: "review" },   HumanAnswered: x,                    RunFailed: { _tag: "failed", reason: "retries-exhausted" }, PrMerged: x },
  "waiting-on-human": { TriageStarted: x,                  StepSucceeded: x,                    NeedsHuman: x,                                               HumanAnswered: { _tag: "building" }, RunFailed: x,                                               PrMerged: x },
  ready:              { TriageStarted: x,                  StepSucceeded: x,                    NeedsHuman: x,                                               HumanAnswered: x,                    RunFailed: x,                                               PrMerged: { _tag: "merged" } },
  merged:             { TriageStarted: x,                  StepSucceeded: x,                    NeedsHuman: x,                                               HumanAnswered: x,                    RunFailed: x,                                               PrMerged: x },
  failed:             { TriageStarted: x,                  StepSucceeded: x,                    NeedsHuman: x,                                               HumanAnswered: x,                    RunFailed: x,                                               PrMerged: x },
};

const cells = (Object.keys(approved) as Array<Status>).flatMap((status) =>
  (Object.keys(approved[status]) as Array<EventTag>).map((event) => [status, event] as const),
);

describe("R-10: the schema decodes exactly the nine states", () => {
  const decode = Schema.decodeUnknownResult(WorkItemState);

  it.each(allStates)("decodes $_tag", (state) => {
    expect(decode(state)).toEqual(Result.succeed(state));
  });

  it.each([
    ["an unknown state", { _tag: "cancelled" }],
    ["waiting on a state with no run", { _tag: "waiting-on-human", asker: "ready" }],
    ["failed without a reason", { _tag: "failed" }],
  ])("rejects %s", (_, input) => {
    expect(Result.isFailure(decode(input))).toBe(true);
  });
});

describe("R-10: only run stages have a running workflow, so waiting on human has none", () => {
  const running: { readonly [S in Status]: boolean } = {
    new: false,
    triage: true,
    spec: true,
    building: true,
    review: true,
    "waiting-on-human": false,
    ready: false,
    merged: false,
    failed: false,
  };

  it.each(allStates)("isRunning($_tag)", (state) => {
    expect(isRunning(state)).toBe(running[state._tag]);
  });
});

describe("R-11: every (state, event) pair follows the approved table", () => {
  it.each(cells)("%s + %s", (status, event) => {
    const result = transition(states[status], eventsFor(outcomeStage[status])[event], "released");
    expect(outcome(result)).toEqual(approved[status][event]);
  });
});

describe("R-11: HumanAnswered resumes the stage that asked", () => {
  // The grid covers asker "building". A second asker catches a resume to any fixed stage.
  it("resumes triage", () => {
    const waiting = { _tag: "waiting-on-human", asker: "triage" } as const;
    expect(outcome(transition(waiting, { _tag: "HumanAnswered" }, "released"))).toEqual({
      _tag: "triage",
    });
  });
});

describe("R-11: RunFailed keeps the reason the run reported", () => {
  // The grid covers "retries-exhausted". A second reason catches a cell that hardcodes one.
  it("keeps budget (R-19)", () => {
    const event = { _tag: "RunFailed", stage: "triage", reason: "budget" } as const;
    expect(outcome(transition(states.triage, event, "released"))).toEqual({
      _tag: "failed",
      reason: "budget",
    });
  });
});

describe("R-11: a redelivered run outcome from an earlier stage is refused", () => {
  // One guard compares the outcome's stage with the current state for all three
  // outcome events, so a stale stage is one equivalence class.
  it("spec + StepSucceeded from triage", () => {
    const result = transition(states.spec, { _tag: "StepSucceeded", stage: "triage" }, "released");
    expect(outcome(result)).toBe("InvalidTransition");
  });
});

describe("R-11: the engaged kill switch refuses every transition into a run stage", () => {
  it.each([
    ["new + TriageStarted", states.new, eventsFor("triage").TriageStarted, "triage"],
    ["triage + StepSucceeded", states.triage, eventsFor("triage").StepSucceeded, "spec"],
    ["spec + StepSucceeded", states.spec, eventsFor("spec").StepSucceeded, "building"],
    ["building + StepSucceeded", states.building, eventsFor("building").StepSucceeded, "review"],
    [
      "waiting-on-human + HumanAnswered",
      states["waiting-on-human"],
      { _tag: "HumanAnswered" },
      "building",
    ],
  ] as const)("%s", (_, state, event, blocked) => {
    const result = transition(state, event, "engaged");
    expect(Result.isFailure(result) && result.failure).toMatchObject({
      _tag: "KillSwitchEngaged",
      blocked,
    });
  });

  it("leaves the input state unchanged", () => {
    const state = { _tag: "waiting-on-human", asker: "spec" } as const;
    const before = structuredClone(state);
    const result = transition(state, { _tag: "HumanAnswered" }, "engaged");
    expect(Result.isFailure(result) && result.failure).toMatchObject({ from: before });
    expect(state).toEqual(before);
  });
});

describe("R-11: the engaged kill switch still allows transitions into non-run states", () => {
  it.each([
    [
      "spec + NeedsHuman",
      states.spec,
      eventsFor("spec").NeedsHuman,
      { _tag: "waiting-on-human", asker: "spec" },
    ],
    [
      "building + RunFailed",
      states.building,
      eventsFor("building").RunFailed,
      { _tag: "failed", reason: "retries-exhausted" },
    ],
    ["review + StepSucceeded", states.review, eventsFor("review").StepSucceeded, { _tag: "ready" }],
    ["ready + PrMerged", states.ready, eventsFor("review").PrMerged, { _tag: "merged" }],
  ] as const)("%s", (_, state, event, expected) => {
    expect(outcome(transition(state, event, "engaged"))).toEqual(expected);
  });
});
