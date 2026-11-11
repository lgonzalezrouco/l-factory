import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { decodeFakeScript } from "./script.js";

it.effect("reads the scripted stages and ignores the rest of the body", () =>
  Effect.gen(function* () {
    const script = yield* decodeFakeScript("fix the login page\n@fake spec succeeded\nthanks");

    expect(script).toEqual({ spec: { _tag: "succeeded" } });
  }),
);

it.effect("reads a stage scripted to need a human", () =>
  Effect.gen(function* () {
    const script = yield* decodeFakeScript("@fake spec needs-human");

    expect(script).toEqual({ spec: { _tag: "needs-human" } });
  }),
);

it.effect("rejects a @fake line with an unknown directive", () =>
  Effect.gen(function* () {
    const error = yield* Effect.flip(decodeFakeScript("@fake spec explode"));

    expect(error).toMatchObject({ _tag: "FakeScriptInvalid", line: "@fake spec explode" });
  }),
);

it.effect("reads a slow stage with its seconds", () =>
  Effect.gen(function* () {
    const script = yield* decodeFakeScript("@fake building slow 20");

    expect(script).toEqual({ building: { _tag: "slow", seconds: 20 } });
  }),
);

it.effect.each(["@fake building slow", "@fake building slow 0", "@fake building slow 1.5"])(
  "rejects %s because slow needs a positive whole number of seconds",
  (line) =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(decodeFakeScript(line));

      expect(error).toMatchObject({ _tag: "FakeScriptInvalid", line });
    }),
);
