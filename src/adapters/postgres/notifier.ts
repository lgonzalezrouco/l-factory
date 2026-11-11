import { PgClient } from "@effect/sql-pg";
import { Effect, Layer, Schema } from "effect";
import type { SqlError } from "effect/sql";
import {
  Notification,
  Notifier,
  NotifierUnavailable,
  StoredNotificationUndecodable,
} from "../../application/notifier.js";

const unavailable = Effect.mapError(
  (cause: SqlError.SqlError) => new NotifierUnavailable({ cause }),
);

const decodeNotifications = (rows: unknown) =>
  Schema.decodeUnknownEffect(Schema.Array(Notification))(rows).pipe(
    Effect.mapError((cause) => new StoredNotificationUndecodable({ cause })),
  );

export const NotifierPostgres = Layer.effect(Notifier)(
  Effect.gen(function* () {
    const sql = yield* PgClient.PgClient;
    return Notifier.of({
      notify: ({ ticketId, kind, body }) =>
        sql`
          INSERT INTO notifications (org_id, ticket_id, kind, body)
          SELECT org_id, id, ${kind}, ${body} FROM tickets WHERE id = ${ticketId}
          ON CONFLICT (ticket_id, kind) DO NOTHING
        `.pipe(Effect.asVoid, unavailable),
      takeUnread: (org) =>
        sql`SELECT set_config('app.org_id', ${org}, true)`.pipe(
          Effect.andThen(sql`
            WITH taken AS (
              UPDATE notifications SET read_at = now() WHERE read_at IS NULL
              RETURNING ticket_id AS "ticketId", kind, body, created_at AS "createdAt"
            )
            SELECT * FROM taken ORDER BY "createdAt", "ticketId"
          `),
          sql.withTransaction,
          unavailable,
          Effect.flatMap(decodeNotifications),
        ),
    });
  }),
);
