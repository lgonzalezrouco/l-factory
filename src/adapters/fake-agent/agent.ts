import { Effect, Layer } from "effect";
import { Agent, AgentError, type StepOutcome } from "../../application/agent.js";
import { decodeFakeScript, type FakeDirective } from "./script.js";

const outcomeOf: Record<FakeDirective, StepOutcome> = { succeeded: "succeeded" };

export const FakeAgentLive = Layer.succeed(Agent)(
  Agent.of({
    runStep: ({ body, stage }, heartbeat) =>
      decodeFakeScript(body).pipe(
        Effect.mapError((cause) => new AgentError({ cause })),
        Effect.flatMap((script) =>
          heartbeat.pipe(
            Effect.delay("500 millis"),
            Effect.forever,
            Effect.timeoutOrElse({
              duration: "2 seconds",
              orElse: () => Effect.succeed(outcomeOf[script[stage] ?? "succeeded"]),
            }),
          ),
        ),
      ),
  }),
);
