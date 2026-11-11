import { Effect, Schema } from "effect";
import { SqlClient, type SqlError } from "effect/sql";
import type { InvalidTransition } from "../domain/ticket/ticket.js";
import { applyEventInOrg, type ApplyEventError } from "./apply-event.js";
import { OrgId } from "./tenancy.js";
import { TicketRuns } from "./ticket-runs.js";
import { TicketId } from "./ticket-store.js";

const RunningTickets = Schema.Array(Schema.Struct({ id: TicketId, org_id: OrgId }));

export const engage: Effect.Effect<
  number,
  Exclude<ApplyEventError, InvalidTransition>,
  SqlClient.SqlClient | TicketRuns
> = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const runs = yield* TicketRuns;
  yield* sql`UPDATE kill_switch SET engaged = true`;
  const running = yield* Schema.decodeUnknownEffect(RunningTickets)(
    yield* sql`SELECT id, org_id FROM running_tickets()`,
  ).pipe(Effect.orDie);
  const paused = yield* Effect.filter(running, ({ id, org_id }) =>
    applyEventInOrg(org_id, id, { _tag: "Paused" }).pipe(
      Effect.as(true),
      Effect.catchTag("InvalidTransition", () => Effect.succeed(false)),
    ),
  );
  yield* Effect.forEach(paused, ({ id }) =>
    runs
      .cancel(id)
      .pipe(
        Effect.catchTag("TicketRunsUnavailable", ({ cause }) =>
          Effect.logWarning(
            `ticket ${id} is paused, but its run could not be cancelled and ends at its next step`,
            cause,
          ),
        ),
      ),
  );
  return paused.length;
});

export const release: Effect.Effect<void, SqlError.SqlError, SqlClient.SqlClient> =
  SqlClient.SqlClient.use((sql) => sql`UPDATE kill_switch SET engaged = false`).pipe(Effect.asVoid);
