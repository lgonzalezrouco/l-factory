import { PgClient } from "@effect/sql-pg";
import { expect, layer } from "@effect/vitest";
import { Context, Effect, Layer } from "effect";
import type { SqlError } from "effect/sql";
import type { OrgId } from "../../application/tenancy.js";
import { TestDatabaseApi, TestDatabaseOwner, TestOrgs, TestOrgsLive } from "./test-database.js";

class ApiSql extends Context.Service<ApiSql, PgClient.PgClient>()("l-factory/test/ApiSql") {}

const ApiSqlLive = Layer.effect(ApiSql)(PgClient.PgClient.use(Effect.succeed)).pipe(
  Layer.provide(TestDatabaseApi),
);

const insertTicket = (sql: PgClient.PgClient, org: OrgId, title: string) =>
  sql`
    INSERT INTO tickets (org_id, project_id, title, body, state, version)
    SELECT ${org}, id, ${title}, '', '{"_tag":"new"}', 1 FROM projects WHERE org_id = ${org}
    RETURNING id
  `;

const asApiInOrg = <A>(
  org: OrgId,
  statement: (sql: PgClient.PgClient) => Effect.Effect<A, SqlError.SqlError>,
) =>
  Effect.gen(function* () {
    const sql = yield* ApiSql;
    return yield* sql`SELECT set_config('app.org_id', ${org}, true)`.pipe(
      Effect.andThen(statement(sql)),
      sql.withTransaction,
    );
  });

layer(Layer.mergeAll(ApiSqlLive, TestOrgsLive).pipe(Layer.provideMerge(TestDatabaseOwner)), {
  timeout: "2 minutes",
})("org row-level security", (it) => {
  it.effect("shows the API role only the tickets of the org it is scoped to", () =>
    Effect.gen(function* () {
      const owner = yield* PgClient.PgClient;
      const orgs = yield* TestOrgs;
      yield* insertTicket(owner, orgs.default.orgId, "first org ticket");
      yield* insertTicket(owner, orgs["second-org"].orgId, "second org ticket");

      const titles = yield* asApiInOrg(
        orgs.default.orgId,
        (sql) => sql`
          SELECT title FROM tickets
          WHERE title IN ('first org ticket', 'second org ticket')
        `,
      );

      expect(titles).toEqual([{ title: "first org ticket" }]);
    }),
  );

  it.effect("refuses the API role a ticket written for another org", () =>
    Effect.gen(function* () {
      const orgs = yield* TestOrgs;
      const ownOrg = orgs.default.orgId;
      const otherOrg = orgs["second-org"].orgId;
      const otherProject = yield* asApiInOrg(
        otherOrg,
        (sql) => sql<{ readonly id: string }>`SELECT id FROM projects`,
      );

      yield* asApiInOrg(ownOrg, (sql) => insertTicket(sql, ownOrg, "own org ticket"));
      const error = yield* Effect.flip(
        asApiInOrg(
          ownOrg,
          (sql) => sql`
            INSERT INTO tickets (org_id, project_id, title, body, state, version)
            VALUES (${otherOrg}, ${otherProject[0]?.id}, 'foreign', '', '{"_tag":"new"}', 1)
          `,
        ),
      );

      expect(error.reason._tag).toBe("AuthorizationError");
    }),
  );
});
