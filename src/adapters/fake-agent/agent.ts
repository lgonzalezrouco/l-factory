import { Effect, Layer } from "effect";
import { Agent, AgentError, type StepOutcome } from "../../application/agent.js";
import { decodeFakeScript, type FakeDirective } from "./script.js";

type Step = Effect.Effect<StepOutcome, AgentError>;

const crashed: Step = Effect.failSync(() => new AgentError({ cause: "@fake crash" }));

const outcomeOf: Record<FakeDirective, { readonly firstTime: Step; readonly askedBefore: Step }> = {
  succeeded: { firstTime: Effect.succeed("succeeded"), askedBefore: Effect.succeed("succeeded") },
  "needs-human": {
    firstTime: Effect.succeed("needs-input"),
    askedBefore: Effect.succeed("succeeded"),
  },
  crash: { firstTime: crashed, askedBefore: crashed },
};

export const FakeAgentLive = Layer.succeed(Agent)(
  Agent.of({
    runStep: ({ body, stage, askedBefore }, heartbeat) =>
      decodeFakeScript(body).pipe(
        Effect.mapError((cause) => new AgentError({ cause })),
        Effect.flatMap((script) =>
          heartbeat.pipe(
            Effect.delay("500 millis"),
            Effect.forever,
            Effect.timeoutOrElse({
              duration: "2 seconds",
              orElse: () =>
                outcomeOf[script[stage] ?? "succeeded"][askedBefore ? "askedBefore" : "firstTime"],
            }),
          ),
        ),
      ),
  }),
);
