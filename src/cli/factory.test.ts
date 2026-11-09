import { NodeHttpServer, NodeServices } from "@effect/platform-node";
import { PgClient } from "@effect/sql-pg";
import { expect, layer } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { Command } from "effect/cli";
import { HttpRouter } from "effect/http";
import { HttpApiClient } from "effect/http-api";
import { TestConsole } from "effect/testing";
import { TestDatabase } from "../adapters/postgres/test-database.js";
import { TicketStorePostgres } from "../adapters/postgres/ticket-store.js";
import { FactoryApi } from "../api/definition.js";
import { ApiLive } from "../server/api.js";
import { FactoryClient } from "./client.js";
import { factory } from "./factory.js";

const Api = HttpRouter.serve(ApiLive, { disableListenLog: true, disableLogger: true }).pipe(
  Layer.provide(TicketStorePostgres),
  Layer.provideMerge(TestDatabase),
  Layer.provideMerge(NodeHttpServer.layerTest),
);

const Cli = Layer.effect(FactoryClient)(HttpApiClient.make(FactoryApi)).pipe(
  Layer.provideMerge(Api),
  Layer.provideMerge(Layer.mergeAll(NodeServices.layer, TestConsole.layer)),
);

const run = (...args: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const before = (yield* TestConsole.logLines).length;
    yield* Command.runWith(factory, { version: "test" })(args);
    return (yield* TestConsole.logLines).slice(before);
  });

layer(Cli, { timeout: "2 minutes" })("factory cli", (it) => {
  it.effect("lists a ticket made with create in the queue that status prints", () =>
    Effect.gen(function* () {
      const [created] = yield* run("create", "--title", "write the cli");
      const id = String(created).slice(0, 36);

      expect(yield* run("status")).toContain(`${id}  new                          write the cli`);
    }),
  );

  it.effect("reports an unknown ticket id as missing", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(run("status", "00000000-0000-4000-8000-000000000000"));

      expect(error).toMatchObject({
        _tag: "UserError",
        userMessage: "no ticket 00000000-0000-4000-8000-000000000000",
      });
    }),
  );

  it.effect("prints a ticket's state and its event history in order", () =>
    Effect.gen(function* () {
      const [created] = yield* run("create", "--title", "with history");
      const id = String(created).slice(0, 36);
      const sql = yield* PgClient.PgClient;
      yield* sql`
        INSERT INTO ticket_events (ticket_id, seq, event, at) VALUES
          (${id}, 2, '{"_tag":"StepSucceeded","stage":"triage"}', '2026-01-01T00:00:02Z'),
          (${id}, 1, '{"_tag":"TriageStarted"}', '2026-01-01T00:00:01Z')
      `;

      expect(yield* run("status", id)).toEqual([
        `${id}  new                          with history`,
        "events:",
        "  1  2026-01-01T00:00:01.000Z  TriageStarted",
        "  2  2026-01-01T00:00:02.000Z  StepSucceeded stage=triage",
      ]);
    }),
  );
});
