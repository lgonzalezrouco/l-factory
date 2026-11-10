import { fileURLToPath } from "node:url";
import { NodeRuntime } from "@effect/platform-node";
import { NativeConnection, Worker } from "@temporalio/worker";
import { Effect, Layer, ManagedRuntime } from "effect";
import { FakeAgentLive } from "../adapters/fake-agent/agent.js";
import { PgClientOwner } from "../adapters/postgres/client.js";
import { temporalAddress, ticketRunsTaskQueue } from "../adapters/temporal/names.js";
import { makeActivities } from "./activities.js";

Effect.gen(function* () {
  const address = yield* temporalAddress;
  const runtime = yield* Effect.acquireRelease(
    Effect.sync(() => ManagedRuntime.make(Layer.mergeAll(PgClientOwner, FakeAgentLive))),
    (runtime) => runtime.disposeEffect,
  );
  yield* runtime.contextEffect;
  const connection = yield* Effect.acquireRelease(
    Effect.promise(() => NativeConnection.connect({ address })),
    (connection) => Effect.promise(() => connection.close()),
  );
  const worker = yield* Effect.promise(() =>
    Worker.create({
      connection,
      taskQueue: ticketRunsTaskQueue,
      workflowsPath: fileURLToPath(import.meta.resolve("./workflows.js")),
      activities: makeActivities(runtime),
    }),
  );
  yield* Effect.log(`worker polling ${ticketRunsTaskQueue}`);
  yield* Effect.callback<void>((resume) => {
    const running = worker.run().then(
      () => resume(Effect.void),
      (cause: unknown) => resume(Effect.die(cause)),
    );
    return Effect.promise(() => {
      // Temporal also stops the worker on SIGINT, so it may already be draining.
      if (worker.getState() === "RUNNING") worker.shutdown();
      return running;
    });
  });
}).pipe(Effect.scoped, NodeRuntime.runMain);
