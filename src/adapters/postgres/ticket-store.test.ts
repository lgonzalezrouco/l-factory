import { PgClient } from "@effect/sql-pg";
import { expect, layer } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { TicketId, TicketStore } from "../../application/ticket-store.js";
import { TestDatabaseApi, TestDatabaseOwner, TestOrgs, TestOrgsLive } from "./test-database.js";
import { TicketStorePostgres } from "./ticket-store.js";

const Store = Layer.mergeAll(
  TicketStorePostgres.pipe(Layer.provide(TestDatabaseApi)),
  TestOrgsLive,
).pipe(Layer.provideMerge(TestDatabaseOwner));

layer(Store, { timeout: "2 minutes" })("postgres ticket store", (it) => {
  it.effect("lists a created ticket in the new state", () =>
    Effect.gen(function* () {
      const store = yield* TicketStore;
      const { orgId } = (yield* TestOrgs).default;
      const created = yield* store.create(orgId, { title: "hello", body: "world" });

      expect(created).toMatchObject({
        title: "hello",
        body: "world",
        state: { _tag: "new" },
        version: 1,
      });
      expect(yield* store.list(orgId)).toEqual([created]);
    }),
  );

  it.effect("refuses to read a stored state outside the nine", () =>
    Effect.gen(function* () {
      const store = yield* TicketStore;
      const sql = yield* PgClient.PgClient;
      const { orgId } = (yield* TestOrgs)["second-org"];
      const id = TicketId.make("8f0d6a8e-2f5b-4c1e-9a57-3f0c2d1b7e64");
      yield* Effect.acquireRelease(
        sql`
          INSERT INTO tickets (id, org_id, project_id, title, body, state, version)
          SELECT ${id}, ${orgId}, id, 'cancelled', '', '{"_tag":"cancelled"}', 1
          FROM projects WHERE org_id = ${orgId}
        `,
        () => sql`DELETE FROM tickets WHERE id = ${id}`.pipe(Effect.orDie),
      );

      expect((yield* Effect.flip(store.get(orgId, id)))._tag).toBe("StoredTicketUndecodable");
      expect((yield* Effect.flip(store.list(orgId)))._tag).toBe("StoredTicketUndecodable");
    }),
  );
});
