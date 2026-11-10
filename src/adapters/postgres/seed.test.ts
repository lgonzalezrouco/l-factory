import { PgClient } from "@effect/sql-pg";
import { expect, layer } from "@effect/vitest";
import { Effect, Option } from "effect";
import { fixtures, seed } from "./seed.js";
import { TestDatabaseOwner } from "./test-database.js";

layer(TestDatabaseOwner, { timeout: "2 minutes" })("seed", (it) => {
  it.effect("leaves one org and one admin user when run twice", () =>
    Effect.gen(function* () {
      const sql = yield* PgClient.PgClient;
      const first = yield* seed(fixtures.default);
      const second = yield* seed(fixtures.default);

      expect([Option.isSome(first), Option.isSome(second)]).toEqual([true, false]);
      expect(yield* sql`SELECT name FROM orgs`).toEqual([{ name: "default" }]);
      expect(
        yield* sql`SELECT u.login, m.role FROM users u JOIN memberships m ON m.user_id = u.id`,
      ).toEqual([{ login: "admin", role: "admin" }]);
    }),
  );
});
