import { Effect, Layer } from "effect";
import { Agent, AgentError, type StepOutcome } from "../../application/agent.js";
import { decodeFakeScript, type FakeDirective } from "./script.js";

const outcomeOf: Record<
  FakeDirective,
  { readonly asked: StepOutcome; readonly answered: StepOutcome }
> = {
  succeeded: { asked: "succeeded", answered: "succeeded" },
  "needs-human": { asked: "needs-input", answered: "succeeded" },
};

export const FakeAgentLive = Layer.succeed(Agent)(
  Agent.of({
    runStep: ({ body, stage, answered }, heartbeat) =>
      decodeFakeScript(body).pipe(
        Effect.mapError((cause) => new AgentError({ cause })),
        Effect.flatMap((script) =>
          heartbeat.pipe(
            Effect.delay("500 millis"),
            Effect.forever,
            Effect.timeoutOrElse({
              duration: "2 seconds",
              orElse: () =>
                Effect.succeed(
                  outcomeOf[script[stage] ?? "succeeded"][answered ? "answered" : "asked"],
                ),
            }),
          ),
        ),
      ),
  }),
);
