import { PgClient } from "@effect/sql-pg";
import { expect, layer } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { TestDatabaseOwner, TestOrgs, TestOrgsLive } from "../adapters/postgres/test-database.js";
import { applyEvent } from "./apply-event.js";
import { TicketId } from "./ticket-store.js";

layer(Layer.provideMerge(TestOrgsLive, TestDatabaseOwner), { timeout: "2 minutes" })(
  "apply event",
  (it) => {
    const insertNewTicket = (id: TicketId) =>
      Effect.gen(function* () {
        const sql = yield* PgClient.PgClient;
        const { orgId } = (yield* TestOrgs).default;
        yield* sql`
          INSERT INTO tickets (id, org_id, project_id, title, body, state, version)
          SELECT ${id}, ${orgId}, id, 'apply event', '', '{"_tag":"new"}', 1
          FROM projects WHERE org_id = ${orgId}
        `;
      });

    const versionAndEvents = (id: TicketId) =>
      Effect.gen(function* () {
        const sql = yield* PgClient.PgClient;
        return yield* sql`
          SELECT version,
            (SELECT count(*)::int FROM ticket_events WHERE ticket_id = ${id}) AS events
          FROM tickets WHERE id = ${id}
        `;
      });

    it.effect("refuses a redelivered step outcome and leaves the ticket unchanged", () =>
      Effect.gen(function* () {
        const id = TicketId.make("3b8f2c1e-6d4a-4f9b-8e2d-1c7a5b9e0f43");
        yield* insertNewTicket(id);
        yield* applyEvent(id, { _tag: "TriageStarted" });
        yield* applyEvent(id, { _tag: "StepSucceeded", stage: "triage" });

        const error = yield* Effect.flip(
          applyEvent(id, { _tag: "StepSucceeded", stage: "triage" }),
        );

        expect(error._tag).toBe("InvalidTransition");
        expect(yield* versionAndEvents(id)).toEqual([{ version: 3, events: 2 }]);
      }),
    );

    it.effect("refuses a step outcome that arrives after a pause", () =>
      Effect.gen(function* () {
        const id = TicketId.make("7c2e9a41-5b3d-4e8f-a6c1-2d9f0b8e7a35");
        yield* insertNewTicket(id);
        yield* applyEvent(id, { _tag: "TriageStarted" });
        yield* applyEvent(id, { _tag: "Paused" });

        const error = yield* Effect.flip(
          applyEvent(id, { _tag: "StepSucceeded", stage: "triage" }),
        );

        expect(error._tag).toBe("InvalidTransition");
        expect(yield* versionAndEvents(id)).toEqual([{ version: 3, events: 2 }]);
      }),
    );
  },
);
