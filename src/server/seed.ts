import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Console, Effect, Layer, Option, Redacted } from "effect";
import { Command, Flag } from "effect/cli";
import { PgClientOwner } from "../adapters/postgres/client.js";
import { fixtures, seed } from "../adapters/postgres/seed.js";

const command = Command.make(
  "seed",
  {
    fixture: Flag.ChoiceWithValue("fixture", Object.entries(fixtures)).pipe(
      Flag.withDefault(fixtures.default),
    ),
  },
  ({ fixture }) =>
    seed(fixture).pipe(
      Effect.flatMap(
        Option.match({
          onNone: () => Console.log(`already seeded ${fixture.login}`),
          onSome: ({ token }) =>
            Console.log(`seeded admin ${fixture.login} token ${Redacted.value(token)}`),
        }),
      ),
    ),
);

Command.run(command, { version: "1.0.0" }).pipe(
  Effect.provide(Layer.mergeAll(PgClientOwner, NodeServices.layer)),
  NodeRuntime.runMain,
);
