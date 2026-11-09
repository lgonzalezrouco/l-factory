import { Effect, Layer } from "effect";
import { HttpApiBuilder, HttpApiError, HttpApiMiddleware } from "effect/http-api";
import { FactoryApi } from "../api/definition.js";
import { TicketStore } from "../application/ticket-store.js";

const TicketsHandlers = HttpApiBuilder.group(FactoryApi, "tickets", (handlers) =>
  Effect.gen(function* () {
    const store = yield* TicketStore;
    return handlers
      .handle("create", ({ payload }) =>
        store.create({ title: payload.title, body: payload.body ?? "" }).pipe(Effect.orDie),
      )
      .handle("list", () => store.list.pipe(Effect.orDie))
      .handle("get", ({ params }) =>
        store.get(params.id).pipe(
          Effect.catchTag("TicketNotFound", () => Effect.fail(new HttpApiError.NotFound())),
          Effect.orDie,
        ),
      );
  }),
);

export const ApiLive = HttpApiBuilder.layer(FactoryApi).pipe(
  Layer.provide(TicketsHandlers),
  Layer.provide(HttpApiMiddleware.layerProblemDetails({ includeDetails: true })),
);
