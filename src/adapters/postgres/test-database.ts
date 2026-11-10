import { PgClient } from "@effect/sql-pg";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { Context, Effect, Layer, Option, Record, Redacted } from "effect";
import { migrate } from "./migrate.js";
import { fixtures, seed, type Seeded } from "./seed.js";

class MigratedPostgres extends Context.Service<
  MigratedPostgres,
  { readonly owner: Redacted.Redacted<string>; readonly api: Redacted.Redacted<string> }
>()("l-factory/test/MigratedPostgres") {}

const MigratedPostgresLive = Layer.effect(MigratedPostgres)(
  Effect.gen(function* () {
    const container = yield* Effect.acquireRelease(
      Effect.promise(() => new PostgreSqlContainer("postgres:18.4-alpine").start()),
      (container) => Effect.promise(() => container.stop()),
    );
    const owner = Redacted.make(container.getConnectionUri());
    yield* migrate.pipe(Effect.provide(PgClient.layer({ url: owner })));
    const api = new URL(container.getConnectionUri());
    api.username = "factory_api";
    api.password = "factory_api";
    return { owner, api: Redacted.make(api.toString()) };
  }),
);

const clientAs = (role: "owner" | "api") =>
  Layer.unwrap(
    MigratedPostgres.use((database) => Effect.succeed(PgClient.layer({ url: database[role] }))),
  ).pipe(Layer.provide(MigratedPostgresLive));

export const TestDatabaseOwner = clientAs("owner");
export const TestDatabaseApi = clientAs("api");

export class TestOrgs extends Context.Service<
  TestOrgs,
  { readonly [Name in keyof typeof fixtures]: Seeded }
>()("l-factory/test/TestOrgs") {}

export const TestOrgsLive = Layer.effect(TestOrgs)(
  Effect.all(Record.map(fixtures, (fixture) => seed(fixture).pipe(Effect.map(Option.getOrThrow)))),
);
