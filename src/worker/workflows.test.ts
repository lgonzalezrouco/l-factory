import { fileURLToPath } from "node:url";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { Result } from "effect";
import { afterAll, beforeAll, expect, it } from "vitest";
import {
  isRunning,
  transition,
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

it("drives a ticket whose every step succeeds from new to ready", async () => {
  const applied: Array<TicketEvent> = [];
  let state: TicketState = { _tag: "new" };
  const activities: TicketRunActivities = {
    applyEvent: async (_, event) => {
      applied.push(event);
      state = Result.getOrThrow(transition(state, event, "released"));
      return isRunning(state) ? { running: true, stage: state._tag } : { running: false };
    },
    runAgentStep: async () => "succeeded",
  };
  const worker = await Worker.create({
    connection: env.nativeConnection,
    taskQueue: "test",
    workflowsPath: fileURLToPath(new URL("workflows.ts", import.meta.url)),
    activities,
  });

  await worker.runUntil(
    env.client.workflow.execute("ticketRun", {
      taskQueue: "test",
      workflowId: "ticket-test",
      args: ["8f0d6a8e-2f5b-4c1e-9a57-3f0c2d1b7e64"],
    }),
  );

  expect(applied).toEqual([
    { _tag: "TriageStarted" },
    { _tag: "StepSucceeded", stage: "triage" },
    { _tag: "StepSucceeded", stage: "spec" },
    { _tag: "StepSucceeded", stage: "building" },
    { _tag: "StepSucceeded", stage: "review" },
  ]);
  expect(state).toEqual({ _tag: "ready" });
}, 120_000);
