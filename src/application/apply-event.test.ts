import { PgClient } from "@effect/sql-pg";
import { expect, layer } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { TestDatabaseOwner, TestOrgs, TestOrgsLive } from "../adapters/postgres/test-database.js";
import { applyEvent } from "./apply-event.js";
import { TicketId } from "./ticket-store.js";

layer(Layer.provideMerge(TestOrgsLive, TestDatabaseOwner), { timeout: "2 minutes" })(
  "apply event",
  (it) => {
    it.effect("leaves the ticket unchanged when a step outcome is redelivered", () =>
      Effect.gen(function* () {
        const sql = yield* PgClient.PgClient;
        const { orgId } = (yield* TestOrgs).default;
        const id = TicketId.make("3b8f2c1e-6d4a-4f9b-8e2d-1c7a5b9e0f43");
        yield* sql`
          INSERT INTO tickets (id, org_id, project_id, title, body, state, version)
          SELECT ${id}, ${orgId}, id, 'redelivered', '', '{"_tag":"new"}', 1
          FROM projects WHERE org_id = ${orgId}
        `;
        yield* applyEvent(id, { _tag: "TriageStarted" });
        yield* applyEvent(id, { _tag: "StepSucceeded", stage: "triage" });

        const position = yield* applyEvent(id, { _tag: "StepSucceeded", stage: "triage" });

        expect(position).toEqual({ running: true, stage: "spec" });
        expect(
          yield* sql`
            SELECT version,
              (SELECT count(*)::int FROM ticket_events WHERE ticket_id = ${id}) AS events
            FROM tickets WHERE id = ${id}
          `,
        ).toEqual([{ version: 3, events: 2 }]);
      }),
    );
  },
);
