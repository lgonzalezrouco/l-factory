import { Array, Effect, Result, Schema } from "effect";
import { SqlClient, type SqlError } from "effect/sql";
import {
  isRunning,
  TicketState,
  transition,
  type RunStage,
  type TicketEvent,
  type TransitionRejected,
} from "../domain/ticket/ticket.js";
import { StoredTicketUndecodable, TicketNotFound, type TicketId } from "./ticket-store.js";

export type RunPosition =
  | { readonly running: true; readonly stage: RunStage }
  | { readonly running: false };

export const positionOf = (state: TicketState): RunPosition =>
  isRunning(state) ? { running: true, stage: state._tag } : { running: false };

export type ApplyEventError =
  | TicketNotFound
  | StoredTicketUndecodable
  | TransitionRejected
  | SqlError.SqlError;

const LockedTicket = Schema.Struct({
  state: TicketState,
  org_id: Schema.String,
  project_id: Schema.String,
});

export const applyEvent = (
  ticketId: TicketId,
  event: TicketEvent,
): Effect.Effect<RunPosition, ApplyEventError, SqlClient.SqlClient> =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    return yield* sql.withTransaction(
      Effect.gen(function* () {
        const rows = yield* sql`
          SELECT state, org_id, project_id FROM tickets WHERE id = ${ticketId} FOR UPDATE
        `;
        const row = yield* Effect.fromOption(
          Array.head(rows),
          () => new TicketNotFound({ id: ticketId }),
        );
        const ticket = yield* Schema.decodeUnknownEffect(LockedTicket)(row).pipe(
          Effect.mapError((cause) => new StoredTicketUndecodable({ cause })),
        );
        const next = transition(ticket.state, event, "released");
        if (Result.isFailure(next)) return yield* next.failure;
        yield* sql`
          UPDATE tickets SET state = ${JSON.stringify(next.success)}::jsonb, version = version + 1
          WHERE id = ${ticketId}
        `;
        yield* sql`
          INSERT INTO ticket_events (ticket_id, org_id, project_id, seq, event)
          SELECT ${ticketId}, ${ticket.org_id}, ${ticket.project_id}, COALESCE(MAX(seq), 0) + 1,
            ${JSON.stringify(event)}::jsonb
          FROM ticket_events WHERE ticket_id = ${ticketId}
        `;
        return positionOf(next.success);
      }),
    );
  });
