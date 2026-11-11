import { NodeHttpServer } from "@effect/platform-node";
import { PgClient } from "@effect/sql-pg";
import { expect, layer } from "@effect/vitest";
import { Effect, Layer, Redacted } from "effect";
import { HttpClient, HttpClientRequest, HttpClientResponse, HttpRouter } from "effect/http";
import { ApiTokensPostgres } from "../adapters/postgres/api-tokens.js";
import { NotifierPostgres } from "../adapters/postgres/notifier.js";
import {
  TestDatabaseApi,
  TestDatabaseOwner,
  TestOrgs,
  TestOrgsLive,
} from "../adapters/postgres/test-database.js";
import { TicketRuns, TicketRunsUnavailable } from "../application/ticket-runs.js";
import { Ticket, type TicketId } from "../application/ticket-store.js";
import { TicketStorePostgres } from "../adapters/postgres/ticket-store.js";
import { ApiLive } from "./api.js";

const started: Array<TicketId> = [];
const cancelled: Array<TicketId> = [];
let temporalDown = false;
const RecordingTicketRuns = Layer.succeed(TicketRuns)(
  TicketRuns.of({
    start: (id) => Effect.sync(() => started.push(id)),
    cancel: (id) =>
      temporalDown
        ? Effect.fail(new TicketRunsUnavailable({ cause: "connection refused" }))
        : Effect.sync(() => cancelled.push(id)),
  }),
);

const Server = HttpRouter.serve(ApiLive, { disableListenLog: true, disableLogger: true }).pipe(
  Layer.provide(
    Layer.mergeAll(TicketStorePostgres, ApiTokensPostgres, NotifierPostgres, RecordingTicketRuns),
  ),
  Layer.provide(TestDatabaseApi),
  Layer.provideMerge(TestOrgsLive),
  Layer.provideMerge(TestDatabaseOwner),
  Layer.provideMerge(NodeHttpServer.layerTest),
);

const postTicket = (body: unknown, token?: Redacted.Redacted<string>) =>
  HttpClientRequest.post("/tickets").pipe(
    HttpClientRequest.bodyJsonUnsafe(body),
    (request) => (token === undefined ? request : HttpClientRequest.bearerToken(request, token)),
    HttpClient.execute,
  );

const postAction = (action: string) => (id: string, token: Redacted.Redacted<string>) =>
  HttpClientRequest.post(`/tickets/${id}/${action}`).pipe(
    HttpClientRequest.bearerToken(token),
    HttpClient.execute,
  );
const approveTicket = postAction("approve");
const pauseTicket = postAction("pause");
const killTicket = postAction("kill");

const createTicket = (title: string, token: Redacted.Redacted<string>) =>
  postTicket({ title }, token).pipe(Effect.flatMap(HttpClientResponse.schemaBodyJson(Ticket)));

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

  it.effect("approving a new ticket starts its run in triage", () =>
    Effect.gen(function* () {
      const token = yield* adminToken;
      const { id } = yield* createTicket("approve me", token);
      started.length = 0;

      const response = yield* approveTicket(id, token);

      expect(response.status).toBe(200);
      expect(yield* response.json).toMatchObject({ id, state: { _tag: "triage" } });
      expect(started).toEqual([id]);
    }),
  );

  it.effect("refuses a second approval of a ticket already in triage", () =>
    Effect.gen(function* () {
      const token = yield* adminToken;
      const { id } = yield* createTicket("approve twice", token);
      yield* approveTicket(id, token);

      const response = yield* approveTicket(id, token);

      expect(response.status).toBe(409);
    }),
  );

  it.effect("reports an approval of an unknown ticket as missing", () =>
    Effect.gen(function* () {
      const response = yield* approveTicket(
        "00000000-0000-4000-8000-000000000000",
        yield* adminToken,
      );

      expect(response.status).toBe(404);
    }),
  );

  it.effect("pausing a running ticket parks it waiting on a human and cancels its run", () =>
    Effect.gen(function* () {
      const token = yield* adminToken;
      const { id } = yield* createTicket("pause me", token);
      yield* approveTicket(id, token);
      cancelled.length = 0;

      const response = yield* pauseTicket(id, token);

      expect(response.status).toBe(200);
      expect(yield* response.json).toMatchObject({
        id,
        state: { _tag: "waiting-on-human", asker: "triage" },
      });
      expect(cancelled).toEqual([id]);
    }),
  );

  it.effect("refuses to pause a ticket that is not running and leaves its run alone", () =>
    Effect.gen(function* () {
      const token = yield* adminToken;
      const { id } = yield* createTicket("not running", token);
      cancelled.length = 0;

      const response = yield* pauseTicket(id, token);

      expect(response.status).toBe(409);
      expect(cancelled).toEqual([]);
    }),
  );

  it.effect("killing a ticket ends it as failed and cancels its run", () =>
    Effect.gen(function* () {
      const token = yield* adminToken;
      const { id } = yield* createTicket("kill me", token);
      cancelled.length = 0;

      const response = yield* killTicket(id, token);

      expect(response.status).toBe(200);
      expect(yield* response.json).toMatchObject({
        id,
        state: { _tag: "failed", reason: "killed" },
      });
      expect(cancelled).toEqual([id]);
    }),
  );

  it.effect("reports a kill of an unknown ticket as missing", () =>
    Effect.gen(function* () {
      const response = yield* killTicket("00000000-0000-4000-8000-000000000000", yield* adminToken);

      expect(response.status).toBe(404);
    }),
  );

  it.effect("refuses the kill switch to a member who is not an org admin", () =>
    Effect.gen(function* () {
      const sql = yield* PgClient.PgClient;
      const { orgId } = (yield* TestOrgs).default;
      const token = "fct_dev-member-token";
      yield* sql`
        WITH dev AS (INSERT INTO users (login) VALUES ('dev') RETURNING id),
        member AS (
          INSERT INTO memberships (user_id, org_id, role) SELECT id, ${orgId}, 'dev' FROM dev
          RETURNING user_id
        )
        INSERT INTO api_tokens (token_hash, user_id, org_id)
        SELECT encode(sha256(convert_to(${token}, 'UTF8')), 'hex'), user_id, ${orgId} FROM member
      `;

      const response = yield* HttpClientRequest.put("/kill-switch").pipe(
        HttpClientRequest.bodyJsonUnsafe({ engaged: true }),
        HttpClientRequest.bearerToken(token),
        HttpClient.execute,
      );

      expect(response.status).toBe(403);
    }),
  );

  it.effect("pauses a running ticket even when its run cannot be cancelled", () =>
    Effect.gen(function* () {
      const token = yield* adminToken;
      const { id } = yield* createTicket("temporal down", token);
      yield* approveTicket(id, token);
      temporalDown = true;

      const response = yield* pauseTicket(id, token).pipe(
        Effect.ensuring(Effect.sync(() => (temporalDown = false))),
      );

      expect(response.status).toBe(200);
      expect(yield* response.json).toMatchObject({
        id,
        state: { _tag: "waiting-on-human", asker: "triage" },
      });
    }),
  );
});
