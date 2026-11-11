import { Data, Effect, Schema, SchemaTransformation } from "effect";
import { RunStage } from "../../domain/ticket/ticket.js";

export const FakeDirective = Schema.TaggedUnion({
  succeeded: {},
  "needs-human": {},
  crash: {},
  hang: {},
  slow: { seconds: Schema.Int.check(Schema.isGreaterThan(0)) },
});
export type FakeDirective = typeof FakeDirective.Type;

export type FakeScript = Partial<Record<RunStage, FakeDirective>>;

export class FakeScriptInvalid extends Data.TaggedError("FakeScriptInvalid")<{
  readonly line: string;
  readonly cause: Schema.SchemaError;
}> {}

const DirectiveTokens = Schema.Union([
  Schema.Tuple([Schema.Literals(["succeeded", "needs-human", "crash", "hang"])]),
  Schema.Tuple([Schema.Literal("slow"), Schema.FiniteFromString]),
]).pipe(
  Schema.decodeTo(
    FakeDirective,
    SchemaTransformation.transform({
      decode: (tokens) =>
        tokens[0] === "slow" ? { _tag: tokens[0], seconds: tokens[1] } : { _tag: tokens[0] },
      encode: (directive) =>
        directive._tag === "slow" ? [directive._tag, directive.seconds] : [directive._tag],
    }),
  ),
);

const FakeLine = Schema.Tuple([Schema.Literal("@fake"), RunStage, DirectiveTokens]);

export const decodeFakeScript = (body: string): Effect.Effect<FakeScript, FakeScriptInvalid> =>
  Effect.forEach(
    body.split("\n").filter((line) => /^@fake\b/.test(line.trim())),
    (line) => {
      const [marker, stage, ...directive] = line.trim().split(/\s+/);
      return Schema.decodeUnknownEffect(FakeLine)([marker, stage, directive]).pipe(
        Effect.mapError((cause) => new FakeScriptInvalid({ line, cause })),
      );
    },
  ).pipe(
    Effect.map((lines): FakeScript =>
      Object.fromEntries(lines.map(([, stage, directive]) => [stage, directive])),
    ),
  );
