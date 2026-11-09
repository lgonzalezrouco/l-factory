import { Config, Context, Effect, Layer } from "effect";
import { HttpApiClient } from "effect/http-api";
import { FactoryApi } from "../api/definition.js";

export class FactoryClient extends Context.Service<
  FactoryClient,
  HttpApiClient.ForApi<typeof FactoryApi>
>()("l-factory/FactoryClient") {}

export const FactoryClientLive = Layer.effect(FactoryClient)(
  Effect.gen(function* () {
    const baseUrl = yield* Config.String("FACTORY_API_URL").pipe(
      Config.withDefault("http://localhost:8080"),
    );
    return yield* HttpApiClient.make(FactoryApi, { baseUrl });
  }),
);
