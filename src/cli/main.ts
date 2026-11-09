import { NodeHttpClient, NodeRuntime, NodeServices } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { Command } from "effect/cli";
import { FactoryClientLive } from "./client.js";
import { factory } from "./factory.js";

Command.run(factory, { version: "1.0.0" }).pipe(
  Effect.provide(
    Layer.mergeAll(
      FactoryClientLive.pipe(Layer.provide(NodeHttpClient.layerUndici)),
      NodeServices.layer,
    ),
  ),
  NodeRuntime.runMain,
);
