import { Config, Context, Effect, Layer, Option } from "effect";
import { HttpClient, HttpClientRequest } from "effect/http";
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
    const token = yield* Config.option(Config.Redacted("FACTORY_API_TOKEN"));
    return yield* HttpApiClient.make(FactoryApi, {
      baseUrl,
      transformClient: HttpClient.mapRequest((request) =>
        Option.match(token, {
          onNone: () => request,
          onSome: (value) => HttpClientRequest.bearerToken(request, value),
        }),
      ),
    });
  }),
);
