import { PgClient } from "@effect/sql-pg";
import { Array, Effect, Layer, Redacted, Schema } from "effect";
import { ApiTokens, ApiTokensUnavailable, Principal } from "../../application/tenancy.js";

export const ApiTokensPostgres = Layer.effect(ApiTokens)(
  Effect.gen(function* () {
    const sql = yield* PgClient.PgClient;

    return ApiTokens.of({
      authenticate: (token) =>
        sql`
          SELECT user_id AS "userId", org_id AS "orgId"
          FROM authenticate_api_token(${Redacted.value(token)})
        `.pipe(
          Effect.mapError((cause) => new ApiTokensUnavailable({ cause })),
          Effect.flatMap((rows) =>
            Schema.decodeUnknownEffect(Schema.Array(Principal))(rows).pipe(Effect.orDie),
          ),
          Effect.map(Array.head),
        ),
    });
  }),
);
