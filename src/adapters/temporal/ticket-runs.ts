import { Client, Connection } from "@temporalio/client";
import { WorkflowIdConflictPolicy, WorkflowIdReusePolicy } from "@temporalio/common";
import { Effect, Layer } from "effect";
import { TicketRuns, TicketRunsUnavailable } from "../../application/ticket-runs.js";
import { temporalAddress, ticketRunsTaskQueue, ticketRunWorkflowId } from "./names.js";

const unavailable = (cause: unknown) => new TicketRunsUnavailable({ cause });

export const TicketRunsTemporal = Layer.effect(TicketRuns)(
  Effect.gen(function* () {
    const address = yield* temporalAddress;
    const connection = yield* Effect.acquireRelease(
      Effect.tryPromise({ try: () => Connection.connect({ address }), catch: unavailable }),
      (connection) => Effect.promise(() => connection.close()),
    );
    const client = new Client({ connection });

    return TicketRuns.of({
      start: (ticketId) =>
        Effect.tryPromise({
          try: () =>
            client.workflow.start("ticketRun", {
              taskQueue: ticketRunsTaskQueue,
              workflowId: ticketRunWorkflowId(ticketId),
              args: [ticketId],
              workflowIdReusePolicy: WorkflowIdReusePolicy.ALLOW_DUPLICATE,
              workflowIdConflictPolicy: WorkflowIdConflictPolicy.FAIL,
            }),
          catch: unavailable,
        }).pipe(Effect.asVoid),
    });
  }),
);
