import { PgClient } from "@effect/sql-pg";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { Effect, Layer, Redacted } from "effect";
import { migrate } from "./migrate.js";

const Container = Layer.unwrap(
  Effect.acquireRelease(
    Effect.promise(() => new PostgreSqlContainer("postgres:18.4-alpine").start()),
    (container) => Effect.promise(() => container.stop()),
  ).pipe(
    Effect.map((container) => PgClient.layer({ url: Redacted.make(container.getConnectionUri()) })),
  ),
);

export const TestDatabase = Layer.effectDiscard(migrate).pipe(Layer.provideMerge(Container));
