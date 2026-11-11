import { Context, Data, Effect } from "effect";
import type { TicketId } from "./ticket-store.js";

export class TicketRunsUnavailable extends Data.TaggedError("TicketRunsUnavailable")<{
  readonly cause: unknown;
}> {}

export class TicketRuns extends Context.Service<
  TicketRuns,
  {
    readonly start: (ticketId: TicketId) => Effect.Effect<void, TicketRunsUnavailable>;
    readonly cancel: (ticketId: TicketId) => Effect.Effect<void, TicketRunsUnavailable>;
  }
>()("l-factory/TicketRuns") {}
