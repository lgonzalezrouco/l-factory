import { randomBytes, randomUUID } from "node:crypto";
import { Effect, Option, Redacted } from "effect";
import { SqlClient } from "effect/sql";
import { OrgId } from "../../application/tenancy.js";

export interface Fixture {
  readonly org: string;
  readonly project: string;
  readonly login: string;
}

export const fixtures = {
  default: { org: "default", project: "default", login: "admin" },
  "second-org": { org: "second-org", project: "default", login: "second-admin" },
} as const satisfies Record<string, Fixture>;

export interface Seeded {
  readonly orgId: OrgId;
  readonly token: Redacted.Redacted<string>;
}

export const seed = (fixture: Fixture) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const userId = randomUUID();
    const orgId = OrgId.make(randomUUID());
    const token = `fct_${randomBytes(32).toString("base64url")}`;

    return yield* sql.withTransaction(
      Effect.gen(function* () {
        const created = yield* sql`
          INSERT INTO users (id, login) VALUES (${userId}, ${fixture.login})
          ON CONFLICT (login) DO NOTHING
          RETURNING id
        `;
        if (created.length === 0) return Option.none<Seeded>();
        yield* sql`INSERT INTO orgs (id, name) VALUES (${orgId}, ${fixture.org})`;
        yield* sql`INSERT INTO projects (org_id, name) VALUES (${orgId}, ${fixture.project})`;
        yield* sql`
          INSERT INTO memberships (user_id, org_id, role) VALUES (${userId}, ${orgId}, 'admin')
        `;
        yield* sql`
          INSERT INTO api_tokens (token_hash, user_id, org_id)
          VALUES (encode(sha256(convert_to(${token}, 'UTF8')), 'hex'), ${userId}, ${orgId})
        `;
        return Option.some<Seeded>({ orgId, token: Redacted.make(token) });
      }),
    );
  });
