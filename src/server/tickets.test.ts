import { NodeHttpServer } from "@effect/platform-node";
import { expect, layer } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { HttpClient, HttpClientRequest, HttpRouter } from "effect/http";
import { TestDatabase } from "../adapters/postgres/test-database.js";
import { TicketStorePostgres } from "../adapters/postgres/ticket-store.js";
import { ApiLive } from "./api.js";

const Server = HttpRouter.serve(ApiLive, { disableListenLog: true, disableLogger: true }).pipe(
  Layer.provide(TicketStorePostgres),
  Layer.provide(TestDatabase),
  Layer.provideMerge(NodeHttpServer.layerTest),
);

const postTicket = (body: unknown) =>
  HttpClientRequest.post("/tickets").pipe(
    HttpClientRequest.bodyJsonUnsafe(body),
    HttpClient.execute,
  );

layer(Server, { timeout: "2 minutes" })("tickets api", (it) => {
  it.effect("creates a ticket in the new state", () =>
    Effect.gen(function* () {
      const response = yield* postTicket({ title: "hello" });

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
      const response = yield* postTicket({
        title: "hello",
        state: { _tag: "new", unknown: true },
      });

      expect(response.status).toBe(400);
      expect(yield* response.json).toMatchObject({ errors: [{ path: ["payload", "state"] }] });
    }),
  );
});
