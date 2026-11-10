import { PgClient } from "@effect/sql-pg";
import { Config, Redacted } from "effect";

const clientFor = (name: string, url: string) =>
  PgClient.layerConfig({
    url: Config.Redacted(name).pipe(Config.withDefault(Redacted.make(url))),
  });

export const PgClientOwner = clientFor(
  "DATABASE_URL",
  "postgres://factory:factory@localhost:5432/factory",
);

export const PgClientApi = clientFor(
  "DATABASE_API_URL",
  "postgres://factory_api:factory_api@localhost:5432/factory",
);
