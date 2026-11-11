import { fileURLToPath } from "node:url";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { Result } from "effect";
import { afterAll, beforeAll, expect, it } from "vitest";
import type { StepOutcome } from "../application/agent.js";
import {
  isRunning,
  transition,
  type RunStage,
  type TicketEvent,
  type TicketState,
} from "../domain/ticket/ticket.js";
import type { TicketRunActivities } from "./activities.js";

let env: TestWorkflowEnvironment;

beforeAll(async () => {
  env = await TestWorkflowEnvironment.createLocal();
}, 300_000);

afterAll(async () => {
  await env?.teardown();
});

const recordingActivities = (outcomes: Partial<Record<RunStage, StepOutcome | "crash">>) => {
  const applied: Array<TicketEvent> = [];
  const steps: Array<RunStage> = [];
  const notified: Array<[RunStage, number]> = [];
  let state: TicketState = { _tag: "new" };
  const activities: TicketRunActivities = {
    applyEvent: async (_, event) => {
      applied.push(event);
      state = Result.getOrThrow(transition(state, event, "released"));
      return isRunning(state) ? { running: true, stage: state._tag } : { running: false };
    },
    runAgentStep: async (_, stage) => {
      steps.push(stage);
      const outcome = outcomes[stage] ?? "succeeded";
      if (outcome === "crash") throw new Error(`${stage} crashed`);
      return outcome;
    },
    maxAttempts: async () => 3,
    notify: async (_, stage, attempts) => {
      notified.push([stage, attempts]);
    },
  };
  return { activities, applied, steps, notified, state: () => state };
};

const runTicket = async (activities: TicketRunActivities, workflowId: string) => {
  const worker = await Worker.create({
    connection: env.nativeConnection,
    taskQueue: workflowId,
    workflowsPath: fileURLToPath(new URL("workflows.ts", import.meta.url)),
    activities,
  });
  const handle = await env.client.workflow.start("ticketRun", {
    taskQueue: workflowId,
    workflowId,
    args: ["8f0d6a8e-2f5b-4c1e-9a57-3f0c2d1b7e64"],
  });
  await worker.runUntil(handle.result());
  return handle;
};

it("drives a ticket whose every step succeeds from new to ready", async () => {
  const { activities, applied, state } = recordingActivities({});

  await runTicket(activities, "ticket-succeeds");

  expect(applied).toEqual([
    { _tag: "TriageStarted" },
    { _tag: "StepSucceeded", stage: "triage" },
    { _tag: "StepSucceeded", stage: "spec" },
    { _tag: "StepSucceeded", stage: "building" },
    { _tag: "StepSucceeded", stage: "review" },
  ]);
  expect(state()).toEqual({ _tag: "ready" });
}, 120_000);

it("completes the execution when a step needs a human", async () => {
  const { activities, applied, state } = recordingActivities({ spec: "needs-input" });

  const handle = await runTicket(activities, "ticket-needs-human");

  expect((await handle.describe()).status.name).toBe("COMPLETED");
  expect(applied).toEqual([
    { _tag: "TriageStarted" },
    { _tag: "StepSucceeded", stage: "triage" },
    { _tag: "NeedsHuman", stage: "spec" },
  ]);
  expect(state()).toEqual({ _tag: "waiting-on-human", asker: "spec" });
}, 120_000);

it("fails the ticket and notifies once after the last attempt of a crashing step", async () => {
  const { activities, applied, steps, notified, state } = recordingActivities({
    building: "crash",
  });

  const handle = await runTicket(activities, "ticket-crashes");

  expect((await handle.describe()).status.name).toBe("COMPLETED");
  expect(steps).toEqual(["triage", "spec", "building", "building", "building"]);
  expect(applied).toEqual([
    { _tag: "TriageStarted" },
    { _tag: "StepSucceeded", stage: "triage" },
    { _tag: "StepSucceeded", stage: "spec" },
    { _tag: "RunFailed", stage: "building", reason: "retries-exhausted" },
  ]);
  expect(notified).toEqual([["building", 3]]);
  expect(state()).toEqual({ _tag: "failed", reason: "retries-exhausted" });
}, 120_000);
