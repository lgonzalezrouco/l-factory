import { PgClient } from "@effect/sql-pg";
import { describe, expect, it, layer } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { TestDatabaseOwner, TestOrgs, TestOrgsLive } from "../adapters/postgres/test-database.js";
import { approvalEvent, approve } from "./approve.js";
import { TicketId } from "./ticket-store.js";

describe("approval event", () => {
  it("starts triage on a new ticket, answers a waiting one, and merges a ready one", () => {
    expect(approvalEvent).toEqual({
      new: { _tag: "TriageStarted" },
      triage: undefined,
      spec: undefined,
      building: undefined,
      review: undefined,
      "waiting-on-human": { _tag: "HumanAnswered" },
      ready: { _tag: "PrMerged" },
      merged: undefined,
      failed: undefined,
    });
  });
});

layer(Layer.provideMerge(TestOrgsLive, TestDatabaseOwner), { timeout: "2 minutes" })(
  "approve",
  (it) => {
    const insertTicket = (id: TicketId, state: string) =>
      Effect.gen(function* () {
        const sql = yield* PgClient.PgClient;
        const { orgId } = (yield* TestOrgs).default;
        yield* sql`
          INSERT INTO tickets (id, org_id, project_id, title, body, state, version)
          SELECT ${id}, ${orgId}, id, 'approve', '', ${state}::jsonb, 1
          FROM projects WHERE org_id = ${orgId}
        `;
        return orgId;
      });

    it.effect("resumes the stage that asked when a waiting ticket is approved", () =>
      Effect.gen(function* () {
        const id = TicketId.make("5d2e8a41-7c3b-4f6e-9a1d-2b8c4e6f0a17");
        const orgId = yield* insertTicket(id, '{"_tag":"waiting-on-human","asker":"spec"}');

        expect(yield* approve(orgId, id)).toEqual({ running: true, stage: "spec" });
      }),
    );

    it.effect("refuses to approve a ticket in a run stage", () =>
      Effect.gen(function* () {
        const id = TicketId.make("9a4c1f7e-3b2d-4e8a-b6c5-0d1e2f3a4b5c");
        const orgId = yield* insertTicket(id, '{"_tag":"triage"}');

        expect(yield* Effect.flip(approve(orgId, id))).toMatchObject({
          _tag: "NoApproval",
          state: { _tag: "triage" },
        });
      }),
    );
  },
);
