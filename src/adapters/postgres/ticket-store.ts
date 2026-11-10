import { PgClient } from "@effect/sql-pg";
import { Array, Effect, Layer, Schema } from "effect";
import type { SqlError } from "effect/sql";
import {
  StoredTicketUndecodable,
  Ticket,
  TicketHistoryEntry,
  TicketNotFound,
  TicketStore,
  TicketStoreUnavailable,
} from "../../application/ticket-store.js";
import type { OrgId } from "../../application/tenancy.js";
import type { TicketState } from "../../domain/ticket/ticket.js";

const initialState: TicketState = { _tag: "new" };
const undecodable = Effect.mapError(
  (cause: Schema.SchemaError) => new StoredTicketUndecodable({ cause }),
);
const decodeTickets = (rows: unknown) =>
  Schema.decodeUnknownEffect(Schema.Array(Ticket))(rows).pipe(undecodable);
const decodeTicket = (rows: unknown) =>
  Schema.decodeUnknownEffect(Schema.Tuple([Ticket]))(rows).pipe(undecodable);

const decodeHistory = (rows: unknown) =>
  Schema.decodeUnknownEffect(Schema.Array(TicketHistoryEntry))(rows).pipe(undecodable);

const unavailable = Effect.mapError(
  (cause: SqlError.SqlError) => new TicketStoreUnavailable({ cause }),
);

export const TicketStorePostgres = Layer.effect(TicketStore)(
  Effect.gen(function* () {
    const sql = yield* PgClient.PgClient;
    const columns = sql.literal(`id, title, body, state, version, created_at AS "createdAt"`);
    const inOrg = <A>(org: OrgId, statement: Effect.Effect<A, SqlError.SqlError>) =>
      sql`SELECT set_config('app.org_id', ${org}, true)`.pipe(
        Effect.andThen(statement),
        sql.withTransaction,
        unavailable,
      );

    return TicketStore.of({
      create: (org, { title, body }) =>
        inOrg(
          org,
          sql`
            INSERT INTO tickets (org_id, project_id, title, body, state, version)
            VALUES (
              ${org},
              (SELECT id FROM projects ORDER BY created_at, id LIMIT 1),
              ${title},
              ${body},
              ${sql.json(initialState)},
              1
            )
            RETURNING ${columns}
          `,
        ).pipe(
          Effect.flatMap(decodeTicket),
          Effect.map(([ticket]) => ticket),
        ),
      list: (org) =>
        inOrg(org, sql`SELECT ${columns} FROM tickets ORDER BY created_at, id`).pipe(
          Effect.flatMap(decodeTickets),
        ),
      get: (org, id) =>
        inOrg(org, sql`SELECT ${columns} FROM tickets WHERE id = ${id}`).pipe(
          Effect.flatMap(decodeTickets),
          Effect.flatMap((tickets) =>
            Effect.fromOption(Array.head(tickets), () => new TicketNotFound({ id })),
          ),
        ),
      history: (org, id) =>
        inOrg(
          org,
          sql`SELECT seq, event, at FROM ticket_events WHERE ticket_id = ${id} ORDER BY seq`,
        ).pipe(Effect.flatMap(decodeHistory)),
    });
  }),
);
