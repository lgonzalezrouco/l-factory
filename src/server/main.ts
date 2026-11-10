import { createServer } from "node:http";
import { NodeHttpServer, NodeRuntime } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { HttpRouter } from "effect/http";
import { ApiTokensPostgres } from "../adapters/postgres/api-tokens.js";
import { PgClientApi } from "../adapters/postgres/client.js";
import { TicketStorePostgres } from "../adapters/postgres/ticket-store.js";
import { ApiLive } from "./api.js";

const port = 8080;

const Server = HttpRouter.serve(ApiLive, { disableListenLog: true }).pipe(
  Layer.provide(Layer.mergeAll(TicketStorePostgres, ApiTokensPostgres)),
  Layer.provide(PgClientApi),
  Layer.provide(NodeHttpServer.layer(createServer, { port })),
);

Effect.gen(function* () {
  yield* Layer.build(Server);
  yield* Effect.log(`server listening on :${port}`);
  return yield* Effect.never;
}).pipe(Effect.scoped, NodeRuntime.runMain);
