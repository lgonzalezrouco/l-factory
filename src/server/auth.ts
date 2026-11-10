import { Effect, Layer } from "effect";
import { HttpApiError } from "effect/http-api";
import { Authorization } from "../api/definition.js";
import { ApiTokens, CurrentPrincipal } from "../application/tenancy.js";

export const AuthorizationLive = Layer.effect(Authorization)(
  Effect.gen(function* () {
    const tokens = yield* ApiTokens;
    return Authorization.of({
      bearer: (httpEffect, { credential }) =>
        tokens.authenticate(credential).pipe(
          Effect.orDie,
          Effect.flatMap((principal) =>
            Effect.fromOption(principal, () => new HttpApiError.Unauthorized()),
          ),
          Effect.flatMap((principal) =>
            Effect.provideService(httpEffect, CurrentPrincipal, principal),
          ),
        ),
    });
  }),
);
