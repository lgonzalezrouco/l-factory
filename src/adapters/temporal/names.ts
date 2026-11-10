import { Config } from "effect";

export const temporalAddress = Config.String("TEMPORAL_ADDRESS").pipe(
  Config.withDefault("localhost:7233"),
);

export const ticketRunsTaskQueue = "ticket-runs";

export const ticketRunWorkflowId = (ticketId: string): string => `ticket-${ticketId}`;
