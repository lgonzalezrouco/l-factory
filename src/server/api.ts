import { Effect, Layer } from "effect";
import { HttpApiBuilder, HttpApiError, HttpApiMiddleware } from "effect/http-api";
import { SqlClient } from "effect/sql";
import { FactoryApi, KillSwitchOn } from "../api/definition.js";
import { applyEventInOrg } from "../application/apply-event.js";
import { approve } from "../application/approve.js";
import { engage, release } from "../application/kill-switch.js";
import { Notifier } from "../application/notifier.js";
import { CurrentPrincipal } from "../application/tenancy.js";
import { TicketRuns } from "../application/ticket-runs.js";
import { TicketStore, type TicketId } from "../application/ticket-store.js";
import type { TicketEvent } from "../domain/ticket/ticket.js";
import { AuthorizationLive } from "./auth.js";

const TicketsHandlers = HttpApiBuilder.group(FactoryApi, "tickets", (handlers) =>
  Effect.gen(function* () {
    const store = yield* TicketStore;
    const runs = yield* TicketRuns;
    const sql = yield* SqlClient.SqlClient;
    const stopRun = (id: TicketId, event: TicketEvent) =>
      CurrentPrincipal.use(({ orgId }) =>
        Effect.gen(function* () {
          yield* applyEventInOrg(orgId, id, event);
          yield* runs
            .cancel(id)
            .pipe(
              Effect.catchTag("TicketRunsUnavailable", ({ cause }) =>
                Effect.logWarning(
                  `ticket ${id} is stopped, but its run could not be cancelled and ends at its next step`,
                  cause,
                ),
              ),
            );
          return yield* store.get(orgId, id);
        }),
      ).pipe(
        Effect.provideService(SqlClient.SqlClient, sql),
        Effect.catchTags({
          TicketNotFound: () => Effect.fail(new HttpApiError.NotFound()),
          InvalidTransition: () => Effect.fail(new HttpApiError.Conflict()),
        }),
        Effect.orDie,
      );
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
      )
      .handle("approve", ({ params }) =>
        CurrentPrincipal.use(({ orgId }) =>
          Effect.gen(function* () {
            const position = yield* approve(orgId, params.id);
            if (position.running) yield* runs.start(params.id);
            return yield* store.get(orgId, params.id);
          }),
        ).pipe(
          Effect.provideService(SqlClient.SqlClient, sql),
          Effect.catchTags({
            TicketNotFound: () => Effect.fail(new HttpApiError.NotFound()),
            NoApproval: () => Effect.fail(new HttpApiError.Conflict()),
            KillSwitchEngaged: () => Effect.fail(new KillSwitchOn()),
          }),
          Effect.catchTag(
            [
              "StoredTicketUndecodable",
              "InvalidTransition",
              "SqlError",
              "TicketRunsUnavailable",
              "TicketStoreUnavailable",
            ],
            Effect.die,
          ),
        ),
      )
      .handle("pause", ({ params }) => stopRun(params.id, { _tag: "Paused" }))
      .handle("kill", ({ params }) => stopRun(params.id, { _tag: "Killed" }));
  }),
);

const NotificationsHandlers = HttpApiBuilder.group(FactoryApi, "notifications", (handlers) =>
  Effect.gen(function* () {
    const notifier = yield* Notifier;
    return handlers.handle("read", () =>
      CurrentPrincipal.use(({ orgId }) => notifier.takeUnread(orgId)).pipe(Effect.orDie),
    );
  }),
);

const KillSwitchHandlers = HttpApiBuilder.group(FactoryApi, "killSwitch", (handlers) =>
  Effect.gen(function* () {
    const runs = yield* TicketRuns;
    const sql = yield* SqlClient.SqlClient;
    return handlers.handle("set", ({ payload: { engaged } }) =>
      Effect.gen(function* () {
        const { role } = yield* CurrentPrincipal;
        if (role !== "admin") return yield* new HttpApiError.Forbidden();
        const paused = engaged ? yield* engage : yield* release.pipe(Effect.as(0));
        return { engaged, paused };
      }).pipe(
        Effect.provideService(SqlClient.SqlClient, sql),
        Effect.provideService(TicketRuns, runs),
        Effect.orDie,
      ),
    );
  }),
);

export const ApiLive = HttpApiBuilder.layer(FactoryApi).pipe(
  Layer.provide([TicketsHandlers, NotificationsHandlers, KillSwitchHandlers]),
  Layer.provide(AuthorizationLive),
  Layer.provide(HttpApiMiddleware.layerProblemDetails({ includeDetails: true })),
);
