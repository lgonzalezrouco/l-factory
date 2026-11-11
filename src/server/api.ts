import { Effect, Layer } from "effect";
import { HttpApiBuilder, HttpApiError, HttpApiMiddleware } from "effect/http-api";
import { FactoryApi } from "../api/definition.js";
import { CurrentPrincipal } from "../application/tenancy.js";
import { TicketRuns } from "../application/ticket-runs.js";
import { TicketStore } from "../application/ticket-store.js";
import { AuthorizationLive } from "./auth.js";

const TicketsHandlers = HttpApiBuilder.group(FactoryApi, "tickets", (handlers) =>
  Effect.gen(function* () {
    const store = yield* TicketStore;
    const runs = yield* TicketRuns;
    return handlers
      .handle("create", ({ payload }) =>
        CurrentPrincipal.use(({ orgId }) =>
          store.create(orgId, { title: payload.title, body: payload.body ?? "" }),
        ).pipe(
          Effect.tap((ticket) => runs.start(ticket.id)),
          Effect.orDie,
        ),
      )
      .handle("list", () =>
        CurrentPrincipal.use(({ orgId }) => store.list(orgId)).pipe(Effect.orDie),
      )
      .handle("get", ({ params }) =>
        CurrentPrincipal.use(({ orgId }) => store.get(orgId, params.id)).pipe(
          Effect.catchTag("TicketNotFound", () => Effect.fail(new HttpApiError.NotFound())),
          Effect.orDie,
        ),
      )
      .handle("history", ({ params }) =>
        CurrentPrincipal.use(({ orgId }) => store.history(orgId, params.id)).pipe(Effect.orDie),
      );
  }),
);

export const ApiLive = HttpApiBuilder.layer(FactoryApi).pipe(
  Layer.provide(TicketsHandlers),
  Layer.provide(AuthorizationLive),
  Layer.provide(HttpApiMiddleware.layerProblemDetails({ includeDetails: true })),
);
