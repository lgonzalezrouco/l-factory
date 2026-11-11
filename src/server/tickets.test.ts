import { NodeHttpServer } from "@effect/platform-node";
import { expect, layer } from "@effect/vitest";
import { Effect, Layer, Redacted } from "effect";
import { HttpClient, HttpClientRequest, HttpRouter } from "effect/http";
import { ApiTokensPostgres } from "../adapters/postgres/api-tokens.js";
import {
  TestDatabaseApi,
  TestDatabaseOwner,
  TestOrgs,
  TestOrgsLive,
} from "../adapters/postgres/test-database.js";
import { TicketRuns } from "../application/ticket-runs.js";
import { TicketStorePostgres } from "../adapters/postgres/ticket-store.js";
import { ApiLive } from "./api.js";

const NoTicketRuns = Layer.succeed(TicketRuns)(TicketRuns.of({ start: () => Effect.void }));

const Server = HttpRouter.serve(ApiLive, { disableListenLog: true, disableLogger: true }).pipe(
  Layer.provide(Layer.mergeAll(TicketStorePostgres, ApiTokensPostgres, NoTicketRuns)),
  Layer.provide(TestDatabaseApi),
  Layer.provideMerge(TestOrgsLive.pipe(Layer.provide(TestDatabaseOwner))),
  Layer.provideMerge(NodeHttpServer.layerTest),
);

const postTicket = (body: unknown, token?: Redacted.Redacted<string>) =>
  HttpClientRequest.post("/tickets").pipe(
    HttpClientRequest.bodyJsonUnsafe(body),
    (request) => (token === undefined ? request : HttpClientRequest.bearerToken(request, token)),
    HttpClient.execute,
  );

const adminToken = TestOrgs.use((orgs) => Effect.succeed(orgs.default.token));

layer(Server, { timeout: "2 minutes" })("tickets api", (it) => {
  it.effect("creates a ticket in the new state", () =>
    Effect.gen(function* () {
      const response = yield* postTicket({ title: "hello" }, yield* adminToken);

      expect(response.status).toBe(201);
      expect(yield* response.json).toMatchObject({
        title: "hello",
        body: "",
        state: { _tag: "new" },
        version: 1,
      });
    }),
  );

  it.effect("rejects a posted state with an unknown field", () =>
    Effect.gen(function* () {
      const response = yield* postTicket(
        { title: "hello", state: { _tag: "new", unknown: true } },
        yield* adminToken,
      );

      expect(response.status).toBe(400);
      expect(yield* response.json).toMatchObject({ errors: [{ path: ["payload", "state"] }] });
    }),
  );

  it.effect("rejects a request without a token", () =>
    Effect.gen(function* () {
      const response = yield* postTicket({ title: "hello" });

      expect(response.status).toBe(401);
    }),
  );

  it.effect("rejects a request with an unknown token", () =>
    Effect.gen(function* () {
      const response = yield* postTicket(
        { title: "hello" },
        Redacted.make("fct_not-a-token-the-factory-issued"),
      );

      expect(response.status).toBe(401);
    }),
  );
});
