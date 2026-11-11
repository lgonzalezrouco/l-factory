import { PgClient } from "@effect/sql-pg";
import { expect, layer } from "@effect/vitest";
import { Context, Deferred, Effect, Fiber, Layer, Schedule } from "effect";
import { SqlClient } from "effect/sql";
import {
  TestDatabaseApi,
  TestDatabaseOwner,
  TestOrgs,
  TestOrgsLive,
} from "../adapters/postgres/test-database.js";
import type { TicketState } from "../domain/ticket/ticket.js";
import { applyEvent } from "./apply-event.js";
import { engage, release } from "./kill-switch.js";
import { TicketRuns } from "./ticket-runs.js";
import { TicketId } from "./ticket-store.js";

class ApiSql extends Context.Service<ApiSql, SqlClient.SqlClient>()("l-factory/test/ApiSql") {}

const cancelled: Array<TicketId> = [];
const RecordingTicketRuns = Layer.succeed(TicketRuns)(
  TicketRuns.of({
    start: () => Effect.void,
    cancel: (id) => Effect.sync(() => cancelled.push(id)),
  }),
);

const asApi = <A, E>(effect: Effect.Effect<A, E, SqlClient.SqlClient | TicketRuns>) =>
  Effect.gen(function* () {
    const api = yield* ApiSql;
    return yield* effect.pipe(
      Effect.provideService(SqlClient.SqlClient, api),
      Effect.provide(RecordingTicketRuns),
    );
  });

const Database = Layer.mergeAll(
  Layer.effect(ApiSql)(SqlClient.SqlClient).pipe(Layer.provide(TestDatabaseApi)),
  Layer.provideMerge(TestOrgsLive, TestDatabaseOwner),
);

layer(Database, { timeout: "2 minutes", excludeTestServices: true })("kill switch", (it) => {
  const insertTicket = (id: TicketId, state: TicketState) =>
    Effect.gen(function* () {
      const sql = yield* PgClient.PgClient;
      const { orgId } = (yield* TestOrgs).default;
      yield* sql`
        INSERT INTO tickets (id, org_id, project_id, title, body, state, version)
        SELECT ${id}, ${orgId}, id, 'kill switch', '', ${JSON.stringify(state)}::jsonb, 1
        FROM projects WHERE org_id = ${orgId}
      `;
    });

  const stateOf = (id: TicketId) =>
    Effect.gen(function* () {
      const sql = yield* PgClient.PgClient;
      return yield* sql`SELECT state FROM tickets WHERE id = ${id}`;
    });

  const untilEngageWaitsOnALock = Effect.gen(function* () {
    const sql = yield* PgClient.PgClient;
    return yield* sql`
      SELECT FROM pg_stat_activity
      WHERE wait_event_type = 'Lock' AND query LIKE 'UPDATE kill_switch%'
    `;
  }).pipe(
    Effect.repeat({
      until: (waiting) => waiting.length > 0,
      schedule: Schedule.spaced("20 millis"),
    }),
  );

  it.effect("pauses a ticket whose step commits while the switch is being engaged", () =>
    Effect.gen(function* () {
      const sql = yield* PgClient.PgClient;
      const id = TicketId.make("5d1e8b2a-9c4f-4a7e-b3d6-0f2a8c9e1b47");
      yield* insertTicket(id, { _tag: "triage" });
      const stepApplied = yield* Deferred.make<void>();
      const commitStep = yield* Deferred.make<void>();
      const step = yield* applyEvent(id, { _tag: "StepSucceeded", stage: "triage" }).pipe(
        Effect.andThen(Deferred.succeed(stepApplied, undefined)),
        Effect.andThen(Deferred.await(commitStep)),
        sql.withTransaction,
        Effect.forkChild,
      );
      yield* Deferred.await(stepApplied);
      cancelled.length = 0;

      const engaging = yield* asApi(engage).pipe(Effect.forkChild);
      yield* untilEngageWaitsOnALock;
      yield* Deferred.succeed(commitStep, undefined);
      yield* Fiber.join(step);
      const paused = yield* Fiber.join(engaging).pipe(
        Effect.ensuring(asApi(release).pipe(Effect.orDie)),
      );

      expect(paused).toBe(1);
      expect(yield* stateOf(id)).toEqual([{ state: { _tag: "waiting-on-human", asker: "spec" } }]);
      expect(cancelled).toEqual([id]);
    }),
  );

  it.effect("refuses to start a ticket while engaged and starts it after release", () =>
    Effect.gen(function* () {
      const id = TicketId.make("8a3c6f1d-2e7b-4d9a-a5c8-6b1f0e4d2c93");
      yield* insertTicket(id, { _tag: "new" });
      yield* asApi(engage);

      const refused = yield* Effect.flip(applyEvent(id, { _tag: "TriageStarted" }));
      yield* asApi(release);
      const started = yield* applyEvent(id, { _tag: "TriageStarted" });

      expect(refused._tag).toBe("KillSwitchEngaged");
      expect(started).toEqual({ running: true, stage: "triage" });
    }),
  );
});
