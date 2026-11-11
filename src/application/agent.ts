import { Context, Data, Effect, Schema } from "effect";
import type { RunStage } from "../domain/ticket/ticket.js";
import type { TicketId } from "./ticket-store.js";

export const StepOutcome = Schema.Literals(["succeeded", "needs-input"]);
export type StepOutcome = typeof StepOutcome.Type;

export interface StepRequest {
  readonly ticketId: TicketId;
  readonly body: string;
  readonly stage: RunStage;
  readonly askedBefore: boolean;
}

export class AgentError extends Data.TaggedError("AgentError")<{
  readonly cause: unknown;
}> {}

export class Agent extends Context.Service<
  Agent,
  {
    readonly runStep: (
      request: StepRequest,
      heartbeat: Effect.Effect<void>,
    ) => Effect.Effect<StepOutcome, AgentError>;
  }
>()("l-factory/Agent") {}
