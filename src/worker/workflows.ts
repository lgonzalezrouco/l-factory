import { ActivityFailure, isCancellation, proxyActivities } from "@temporalio/workflow";
import type { StepOutcome } from "../application/agent.js";
import type { RunStage, TicketEvent } from "../domain/ticket/ticket.js";
import type { TicketRunActivities } from "./activities.js";

const { applyEvent, maxAttempts, notify } = proxyActivities<TicketRunActivities>({
  startToCloseTimeout: "10 seconds",
});

type StepResult = StepOutcome | "retries-exhausted";

const outcomeEvent: Record<StepResult, (stage: RunStage) => TicketEvent> = {
  succeeded: (stage) => ({ _tag: "StepSucceeded", stage }),
  "needs-input": (stage) => ({ _tag: "NeedsHuman", stage }),
  "retries-exhausted": (stage) => ({ _tag: "RunFailed", stage, reason: "retries-exhausted" }),
};

const exhausted = (error: unknown): "retries-exhausted" => {
  if (error instanceof ActivityFailure && !isCancellation(error)) return "retries-exhausted";
  throw error;
};

export async function ticketRun(ticketId: string): Promise<void> {
  // Workflow code cannot read the worker's config, so it asks an activity once and the
  // answer is replayed from history.
  const maximumAttempts = await maxAttempts();
  const { runAgentStep } = proxyActivities<TicketRunActivities>({
    startToCloseTimeout: "5 minutes",
    heartbeatTimeout: "5 seconds",
    retry: { maximumAttempts, initialInterval: "1 second" },
  });

  let position = await applyEvent(ticketId, { _tag: "TriageStarted" });
  while (position.running) {
    const { stage } = position;
    const result = await runAgentStep(ticketId, stage).catch(exhausted);
    position = await applyEvent(ticketId, outcomeEvent[result](stage));
    if (result === "retries-exhausted") await notify(ticketId, stage, maximumAttempts);
  }
}
