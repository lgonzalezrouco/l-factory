import { Duration, Effect, Layer } from "effect";
import { Agent, AgentError, type StepOutcome } from "../../application/agent.js";
import { decodeFakeScript, FakeDirective } from "./script.js";

type Step = Effect.Effect<StepOutcome, AgentError>;

const heartbeatingFor =
  (heartbeat: Effect.Effect<void>, duration: Duration.Input) =>
  (then: Step): Step =>
    heartbeat.pipe(
      Effect.delay("500 millis"),
      Effect.forever,
      Effect.timeoutOrElse({ duration, orElse: () => then }),
    );

const stepOf = (heartbeat: Effect.Effect<void>, askedBefore: boolean) => {
  const briefly = heartbeatingFor(heartbeat, "2 seconds");
  return FakeDirective.match({
    succeeded: () => briefly(Effect.succeed("succeeded")),
    "needs-human": () => briefly(Effect.succeed(askedBefore ? "succeeded" : "needs-input")),
    crash: () => briefly(Effect.fail(new AgentError({ cause: "@fake crash" }))),
    hang: (): Step => Effect.never,
    slow: ({ seconds }) =>
      heartbeatingFor(heartbeat, Duration.seconds(seconds))(Effect.succeed("succeeded")),
  });
};

export const FakeAgentLive = Layer.succeed(Agent)(
  Agent.of({
    runStep: ({ body, stage, askedBefore }, heartbeat) =>
      decodeFakeScript(body).pipe(
        Effect.mapError((cause) => new AgentError({ cause })),
        Effect.flatMap((script) =>
          stepOf(heartbeat, askedBefore)(script[stage] ?? { _tag: "succeeded" }),
        ),
      ),
  }),
);
