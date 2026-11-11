import { NodeHttpServer, NodeServices } from "@effect/platform-node";
import { PgClient } from "@effect/sql-pg";
import { expect, layer } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { Command } from "effect/cli";
import { HttpClient, HttpClientRequest, HttpRouter } from "effect/http";
import { HttpApiClient } from "effect/http-api";
import { TestConsole } from "effect/testing";
import { ApiTokensPostgres } from "../adapters/postgres/api-tokens.js";
import { NotifierPostgres } from "../adapters/postgres/notifier.js";
import {
  TestDatabaseApi,
  TestDatabaseOwner,
  TestOrgs,
  TestOrgsLive,
} from "../adapters/postgres/test-database.js";
import { TicketRuns } from "../application/ticket-runs.js";
import { TicketStorePostgres } from "../adapters/postgres/ticket-store.js";
import { FactoryApi } from "../api/definition.js";
import { ApiLive } from "../server/api.js";
import { FactoryClient } from "./client.js";
import { factory } from "./factory.js";

const NoTicketRuns = Layer.succeed(TicketRuns)(
  TicketRuns.of({ start: () => Effect.void, cancel: () => Effect.void }),
);

const Api = HttpRouter.serve(ApiLive, { disableListenLog: true, disableLogger: true }).pipe(
  Layer.provide(
    Layer.mergeAll(TicketStorePostgres, ApiTokensPostgres, NotifierPostgres, NoTicketRuns),
  ),
  Layer.provide(TestDatabaseApi),
  Layer.provideMerge(TestOrgsLive),
  Layer.provideMerge(TestDatabaseOwner),
  Layer.provideMerge(NodeHttpServer.layerTest),
);

const Cli = Layer.effect(FactoryClient)(
  TestOrgs.use((orgs) =>
    HttpApiClient.make(FactoryApi, {
      transformClient: HttpClient.mapRequest(HttpClientRequest.bearerToken(orgs.default.token)),
    }),
  ),
).pipe(
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

      expect(yield* run("status")).toContain(
        `${id}  new                                   write the cli`,
      );
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

  it.effect("prints the state each event in a ticket's history led to", () =>
    Effect.gen(function* () {
      const [created] = yield* run("create", "--title", "with history");
      const id = String(created).slice(0, 36);
      const sql = yield* PgClient.PgClient;
      yield* sql`UPDATE tickets SET created_at = '2026-01-01T00:00:00Z' WHERE id = ${id}`;
      yield* sql`
        INSERT INTO ticket_events (ticket_id, org_id, project_id, seq, event, at)
        SELECT tickets.id, org_id, project_id, seq, event::jsonb, at::timestamptz
        FROM tickets, (VALUES
          (2, '{"_tag":"StepSucceeded","stage":"triage"}', '2026-01-01T00:00:02Z'),
          (1, '{"_tag":"TriageStarted"}', '2026-01-01T00:00:01Z')
        ) AS events (seq, event, at)
        WHERE tickets.id = ${id}
      `;

      expect(yield* run("status", id)).toEqual([
        `${id}  new                                   with history`,
        "history:",
        "  0  2026-01-01T00:00:00.000Z  created                     new",
        "  1  2026-01-01T00:00:01.000Z  TriageStarted               triage",
        "  2  2026-01-01T00:00:02.000Z  StepSucceeded stage=triage  spec",
      ]);
    }),
  );

  it.effect("names the state of a ticket that has nothing to approve", () =>
    Effect.gen(function* () {
      const [created] = yield* run("create", "--title", "approve twice");
      const id = String(created).slice(0, 36);

      expect(yield* run("approve", id)).toEqual([
        `${id}  triage                                approve twice`,
      ]);
      expect(yield* Effect.flip(run("approve", id))).toMatchObject({
        _tag: "UserError",
        userMessage: `ticket ${id} is triage, which has nothing to approve`,
      });
    }),
  );

  it.effect("pauses a running ticket at its stage and approve resumes it", () =>
    Effect.gen(function* () {
      const [created] = yield* run("create", "--title", "pause and resume");
      const id = String(created).slice(0, 36);
      yield* run("approve", id);

      expect(yield* run("pause", id)).toEqual(["paused at triage"]);
      expect(yield* run("approve", id)).toEqual([
        `${id}  triage                                pause and resume`,
      ]);
    }),
  );

  it.effect("names the state of a ticket that cannot be paused", () =>
    Effect.gen(function* () {
      const [created] = yield* run("create", "--title", "never started");
      const id = String(created).slice(0, 36);

      expect(yield* Effect.flip(run("pause", id))).toMatchObject({
        _tag: "UserError",
        userMessage: `ticket ${id} is new, which cannot be paused`,
      });
    }),
  );

  it.effect("kills a ticket, which then cannot be killed again", () =>
    Effect.gen(function* () {
      const [created] = yield* run("create", "--title", "kill me");
      const id = String(created).slice(0, 36);

      expect(yield* run("kill", id)).toEqual(["killed"]);
      expect(yield* Effect.flip(run("kill", id))).toMatchObject({
        _tag: "UserError",
        userMessage: `ticket ${id} is failed (killed), which cannot be killed`,
      });
    }),
  );

  it.effect("prints an unread notification above the queue once", () =>
    Effect.gen(function* () {
      const [created] = yield* run("create", "--title", "crashes in building");
      const id = String(created).slice(0, 36);
      const sql = yield* PgClient.PgClient;
      yield* sql`
        INSERT INTO notifications (org_id, ticket_id, kind, body)
        SELECT org_id, id, 'run-failed', ${`ticket ${id} failed at building after 3 attempts`}
        FROM tickets WHERE id = ${id}
      `;

      const first = yield* run("status");
      const second = yield* run("status");

      expect(first[0]).toBe(`! ticket ${id} failed at building after 3 attempts`);
      expect(second.filter((line) => String(line).startsWith("!"))).toEqual([]);
    }),
  );

  it.effect("asks for FACTORY_API_TOKEN when the API rejects the request", () =>
    Effect.gen(function* () {
      const anonymous = yield* HttpApiClient.make(FactoryApi);
      const error = yield* Effect.flip(
        run("status").pipe(Effect.provideService(FactoryClient, anonymous)),
      );

      expect(error).toMatchObject({
        _tag: "UserError",
        userMessage:
          "the factory API rejected the request: set FACTORY_API_TOKEN to a valid API token",
      });
    }),
  );
});
