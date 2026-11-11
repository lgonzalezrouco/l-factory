import { Array, Data, Effect, Schema } from "effect";
import { SqlClient } from "effect/sql";
import type { Status, TicketEvent } from "../domain/ticket/ticket.js";
import { TicketState } from "../domain/ticket/ticket.js";
import { applyEvent, type ApplyEventError, type RunPosition } from "./apply-event.js";
import type { OrgId } from "./tenancy.js";
import { StoredTicketUndecodable, TicketNotFound, type TicketId } from "./ticket-store.js";

export const approvalEvent: { readonly [S in Status]: TicketEvent | undefined } = {
  new: { _tag: "TriageStarted" },
  triage: undefined,
  spec: undefined,
  building: undefined,
  review: undefined,
  "waiting-on-human": { _tag: "HumanAnswered" },
  ready: { _tag: "PrMerged" },
  merged: undefined,
  failed: undefined,
};

export class NoApproval extends Data.TaggedError("NoApproval")<{
  readonly state: TicketState;
}> {}

const LockedState = Schema.Struct({ state: TicketState });

export const approve = (
  org: OrgId,
  id: TicketId,
): Effect.Effect<RunPosition, NoApproval | ApplyEventError, SqlClient.SqlClient> =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    return yield* sql.withTransaction(
      Effect.gen(function* () {
        yield* sql`SELECT set_config('app.org_id', ${org}, true)`;
        const rows = yield* sql`SELECT state FROM tickets WHERE id = ${id} FOR UPDATE`;
        const row = yield* Effect.fromOption(Array.head(rows), () => new TicketNotFound({ id }));
        const { state } = yield* Schema.decodeUnknownEffect(LockedState)(row).pipe(
          Effect.mapError((cause) => new StoredTicketUndecodable({ cause })),
        );
        const event = approvalEvent[state._tag];
        if (event === undefined) return yield* new NoApproval({ state });
        return yield* applyEvent(id, event);
      }),
    );
  });
