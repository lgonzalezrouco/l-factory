import { PgClient } from "@effect/sql-pg";
import { Array, Effect, Layer, Schema } from "effect";
import type { SqlError } from "effect/sql";
import {
  Ticket,
  TicketNotFound,
  TicketStore,
  TicketStoreUnavailable,
} from "../../application/ticket-store.js";
import type { TicketState } from "../../domain/ticket/ticket.js";

const initialState: TicketState = { _tag: "new" };
const decodeTickets = Schema.decodeUnknownEffect(Schema.Array(Ticket));
const decodeTicket = Schema.decodeUnknownEffect(Schema.Tuple([Ticket]));

const unavailable = Effect.mapError(
  (cause: SqlError.SqlError) => new TicketStoreUnavailable({ cause }),
);

export const TicketStorePostgres = Layer.effect(TicketStore)(
  Effect.gen(function* () {
    const sql = yield* PgClient.PgClient;
    const columns = sql.literal(`id, title, body, state, version, created_at AS "createdAt"`);

    return TicketStore.of({
      create: ({ title, body }) =>
        sql`
          INSERT INTO tickets (title, body, state, version)
          VALUES (${title}, ${body}, ${sql.json(initialState)}, 1)
          RETURNING ${columns}
        `.pipe(
          unavailable,
          Effect.flatMap(decodeTicket),
          Effect.map(([ticket]) => ticket),
        ),
      list: sql`SELECT ${columns} FROM tickets ORDER BY created_at, id`.pipe(
        unavailable,
        Effect.flatMap(decodeTickets),
      ),
      get: (id) =>
        sql`SELECT ${columns} FROM tickets WHERE id = ${id}`.pipe(
          unavailable,
          Effect.flatMap(decodeTickets),
          Effect.flatMap((tickets) => Effect.fromOption(Array.head(tickets))),
          Effect.catchTag("NoSuchElementError", () => Effect.fail(new TicketNotFound({ id }))),
        ),
    });
  }),
);
