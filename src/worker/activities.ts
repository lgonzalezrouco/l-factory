import { Context } from "@temporalio/activity";
import { Effect, type ManagedRuntime, Schema } from "effect";
import { SqlClient } from "effect/sql";
import { Agent, type StepOutcome } from "../application/agent.js";
import { applyEvent, type RunPosition } from "../application/apply-event.js";
import { TicketId } from "../application/ticket-store.js";
import { RunStage, TicketEvent } from "../domain/ticket/ticket.js";

export interface TicketRunActivities {
  readonly applyEvent: (ticketId: string, event: TicketEvent) => Promise<RunPosition>;
  readonly runAgentStep: (ticketId: string, stage: RunStage) => Promise<StepOutcome>;
}

const TicketBody = Schema.Tuple([Schema.Struct({ body: Schema.String, answered: Schema.Boolean })]);

export const makeActivities = (
  runtime: ManagedRuntime.ManagedRuntime<SqlClient.SqlClient | Agent, unknown>,
): TicketRunActivities => {
  const run = <A, E>(
    effect: (activity: Context) => Effect.Effect<A, E, SqlClient.SqlClient | Agent>,
  ): Promise<A> => {
    const activity = Context.current();
    return runtime.runPromise(effect(activity), { signal: activity.cancellationSignal });
  };

  return {
    applyEvent: (ticketId, event) =>
      run(() =>
        Effect.all([
          Schema.decodeEffect(TicketId)(ticketId),
          Schema.decodeEffect(TicketEvent)(event),
        ]).pipe(Effect.flatMap(([id, decoded]) => applyEvent(id, decoded))),
      ),
    runAgentStep: (ticketId, stage) =>
      run((activity) =>
        Effect.gen(function* () {
          const id = yield* Schema.decodeEffect(TicketId)(ticketId);
          const decodedStage = yield* Schema.decodeEffect(RunStage)(stage);
          const sql = yield* SqlClient.SqlClient;
          // Only HumanAnswered leaves waiting-on-human, so an earlier NeedsHuman from the
          // stage that is running again was answered.
          const [{ body, answered }] = yield* Schema.decodeUnknownEffect(TicketBody)(
            yield* sql`
              SELECT body, EXISTS (
                SELECT FROM ticket_events
                WHERE ticket_id = tickets.id
                  AND event = ${JSON.stringify({ _tag: "NeedsHuman", stage: decodedStage })}::jsonb
              ) AS answered
              FROM tickets WHERE id = ${id}
            `,
          );
          const agent = yield* Agent;
          return yield* agent.runStep(
            { ticketId: id, body, stage: decodedStage, answered },
            Effect.sync(() => activity.heartbeat()),
          );
        }),
      ),
  };
};
