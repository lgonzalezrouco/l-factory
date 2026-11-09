import { PgClient } from "@effect/sql-pg";
import { Config, Redacted } from "effect";

export const PgClientLive = PgClient.layerConfig({
  url: Config.Redacted("DATABASE_URL").pipe(
    Config.withDefault(Redacted.make("postgres://factory:factory@localhost:5432/factory")),
  ),
});
