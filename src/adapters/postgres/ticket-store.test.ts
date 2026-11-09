import { PgClient } from "@effect/sql-pg";
import { expect, layer } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { TicketId, TicketStore } from "../../application/ticket-store.js";
import { TestDatabase } from "./test-database.js";
import { TicketStorePostgres } from "./ticket-store.js";

layer(TicketStorePostgres.pipe(Layer.provideMerge(TestDatabase)), { timeout: "2 minutes" })(
  "postgres ticket store",
  (it) => {
    it.effect("lists a created ticket in the new state", () =>
      Effect.gen(function* () {
        const store = yield* TicketStore;
        const created = yield* store.create({ title: "hello", body: "world" });

        expect(created).toMatchObject({
          title: "hello",
          body: "world",
          state: { _tag: "new" },
          version: 1,
        });
        expect(yield* store.list).toEqual([created]);
      }),
    );

    it.effect("refuses to read a stored state outside the nine", () =>
      Effect.gen(function* () {
        const store = yield* TicketStore;
        const sql = yield* PgClient.PgClient;
        const id = TicketId.make("8f0d6a8e-2f5b-4c1e-9a57-3f0c2d1b7e64");
        yield* Effect.acquireRelease(
          sql`
            INSERT INTO tickets (id, title, body, state, version)
            VALUES (${id}, 'cancelled', '', '{"_tag":"cancelled"}', 1)
          `,
          () => sql`DELETE FROM tickets WHERE id = ${id}`.pipe(Effect.orDie),
        );

        expect((yield* Effect.flip(store.get(id)))._tag).toBe("SchemaError");
        expect((yield* Effect.flip(store.list))._tag).toBe("SchemaError");
      }),
    );
  },
);
