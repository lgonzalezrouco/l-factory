import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { decodeFakeScript } from "./script.js";

it.effect("reads the scripted stages and ignores the rest of the body", () =>
  Effect.gen(function* () {
    const script = yield* decodeFakeScript("fix the login page\n@fake spec succeeded\nthanks");

    expect(script).toEqual({ spec: "succeeded" });
  }),
);

it.effect("rejects a @fake line with an unknown directive", () =>
  Effect.gen(function* () {
    const error = yield* Effect.flip(decodeFakeScript("@fake spec explode"));

    expect(error).toMatchObject({ _tag: "FakeScriptInvalid", line: "@fake spec explode" });
  }),
);
