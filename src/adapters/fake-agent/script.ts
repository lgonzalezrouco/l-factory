import { Data, Effect, Schema } from "effect";
import { RunStage } from "../../domain/ticket/ticket.js";

export const FakeDirective = Schema.Literals(["succeeded"]);
export type FakeDirective = typeof FakeDirective.Type;

export type FakeScript = Partial<Record<RunStage, FakeDirective>>;

export class FakeScriptInvalid extends Data.TaggedError("FakeScriptInvalid")<{
  readonly line: string;
  readonly cause: Schema.SchemaError;
}> {}

const FakeLine = Schema.Tuple([Schema.Literal("@fake"), RunStage, FakeDirective]);

export const decodeFakeScript = (body: string): Effect.Effect<FakeScript, FakeScriptInvalid> =>
  Effect.forEach(
    body.split("\n").filter((line) => /^@fake\b/.test(line.trim())),
    (line) =>
      Schema.decodeUnknownEffect(FakeLine)(line.trim().split(/\s+/)).pipe(
        Effect.mapError((cause) => new FakeScriptInvalid({ line, cause })),
      ),
  ).pipe(
    Effect.map((lines): FakeScript =>
      Object.fromEntries(lines.map(([, stage, directive]) => [stage, directive])),
    ),
  );
