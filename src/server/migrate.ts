import { NodeRuntime } from "@effect/platform-node";
import { Effect } from "effect";
import { PgClientOwner } from "../adapters/postgres/client.js";
import { migrate } from "../adapters/postgres/migrate.js";

migrate.pipe(
  Effect.tap((applied) => Effect.log(`applied ${applied.length} migrations`)),
  Effect.provide(PgClientOwner),
  NodeRuntime.runMain,
);
