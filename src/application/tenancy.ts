import { Context, Data, Effect, Option, Redacted, Schema } from "effect";

export const OrgId = Schema.String.check(Schema.isUUID()).pipe(Schema.brand("OrgId"));
export type OrgId = typeof OrgId.Type;

export const UserId = Schema.String.check(Schema.isUUID()).pipe(Schema.brand("UserId"));
export type UserId = typeof UserId.Type;

export const Principal = Schema.Struct({
  userId: UserId,
  orgId: OrgId,
  role: Schema.Literals(["admin", "dev", "area-owner"]),
});
export type Principal = typeof Principal.Type;

export class CurrentPrincipal extends Context.Service<CurrentPrincipal, Principal>()(
  "l-factory/CurrentPrincipal",
) {}

export class ApiTokensUnavailable extends Data.TaggedError("ApiTokensUnavailable")<{
  readonly cause: unknown;
}> {}

export class ApiTokens extends Context.Service<
  ApiTokens,
  {
    readonly authenticate: (
      token: Redacted.Redacted<string>,
    ) => Effect.Effect<Option.Option<Principal>, ApiTokensUnavailable>;
  }
>()("l-factory/ApiTokens") {}
