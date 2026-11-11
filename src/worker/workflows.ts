import { proxyActivities } from "@temporalio/workflow";
import type { StepOutcome } from "../application/agent.js";
import type { RunStage, TicketEvent } from "../domain/ticket/ticket.js";
import type { TicketRunActivities } from "./activities.js";

const { applyEvent } = proxyActivities<TicketRunActivities>({
  startToCloseTimeout: "10 seconds",
});

const { runAgentStep } = proxyActivities<TicketRunActivities>({
  startToCloseTimeout: "5 minutes",
  heartbeatTimeout: "5 seconds",
});

const outcomeEvent: Record<StepOutcome, (stage: RunStage) => TicketEvent> = {
  succeeded: (stage) => ({ _tag: "StepSucceeded", stage }),
  "needs-input": (stage) => ({ _tag: "NeedsHuman", stage }),
};

export async function ticketRun(ticketId: string): Promise<void> {
  let position = await applyEvent(ticketId, { _tag: "TriageStarted" });
  while (position.running) {
    const outcome = await runAgentStep(ticketId, position.stage);
    position = await applyEvent(ticketId, outcomeEvent[outcome](position.stage));
  }
}
