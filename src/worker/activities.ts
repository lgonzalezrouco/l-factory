import { Context } from "@temporalio/activity";
import { Effect, type ManagedRuntime, Schema } from "effect";
import { SqlClient } from "effect/sql";
import { Agent, type StepOutcome } from "../application/agent.js";
import { applyEvent, positionOf, type RunPosition } from "../application/apply-event.js";
import { Notifier } from "../application/notifier.js";
import { TicketId } from "../application/ticket-store.js";
import { type InvalidTransition, RunStage, TicketEvent } from "../domain/ticket/ticket.js";

export interface TicketRunActivities {
  readonly applyEvent: (ticketId: string, event: TicketEvent) => Promise<RunPosition>;
  readonly runAgentStep: (ticketId: string, stage: RunStage) => Promise<StepOutcome>;
  readonly maxAttempts: () => Promise<number>;
  readonly notify: (ticketId: string, stage: RunStage, attempts: number) => Promise<void>;
}

type WorkerServices = SqlClient.SqlClient | Agent | Notifier;

const followStoredPosition = (refused: InvalidTransition) =>
  Effect.succeed(positionOf(refused.from));

// The run ends here and the kill switch's pause pass parks the ticket waiting on a human.
const stopped: RunPosition = { running: false };

const TicketBody = Schema.Tuple([
  Schema.Struct({ body: Schema.String, askedBefore: Schema.Boolean }),
]);

export const makeActivities = (
  runtime: ManagedRuntime.ManagedRuntime<WorkerServices, unknown>,
  maxAttempts: number,
): TicketRunActivities => {
  const run = <A, E>(
    effect: (activity: Context) => Effect.Effect<A, E, WorkerServices>,
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
        ]).pipe(
          Effect.flatMap(([id, decoded]) => applyEvent(id, decoded)),
          Effect.catchTags({
            InvalidTransition: followStoredPosition,
            KillSwitchEngaged: () => Effect.succeed(stopped),
          }),
        ),
      ),
    runAgentStep: (ticketId, stage) =>
      run((activity) =>
        Effect.gen(function* () {
          const id = yield* Schema.decodeEffect(TicketId)(ticketId);
          const decodedStage = yield* Schema.decodeEffect(RunStage)(stage);
          const sql = yield* SqlClient.SqlClient;
          const [{ body, askedBefore }] = yield* Schema.decodeUnknownEffect(TicketBody)(
            yield* sql`
              SELECT body, EXISTS (
                SELECT FROM ticket_events
                WHERE ticket_id = tickets.id
                  AND event = ${JSON.stringify({ _tag: "NeedsHuman", stage: decodedStage })}::jsonb
              ) AS "askedBefore"
              FROM tickets WHERE id = ${id}
            `,
          );
          const agent = yield* Agent;
          return yield* agent.runStep(
            { ticketId: id, body, stage: decodedStage, askedBefore },
            Effect.sync(() => activity.heartbeat()),
          );
        }),
      ),
    maxAttempts: async () => maxAttempts,
    notify: (ticketId, stage, attempts) =>
      run(() =>
        Effect.gen(function* () {
          const id = yield* Schema.decodeEffect(TicketId)(ticketId);
          const decodedStage = yield* Schema.decodeEffect(RunStage)(stage);
          const notifier = yield* Notifier;
          yield* notifier.notify({
            ticketId: id,
            kind: "run-failed",
            body: `ticket ${id} failed at ${decodedStage} after ${attempts} attempts`,
          });
        }),
      ),
  };
};
