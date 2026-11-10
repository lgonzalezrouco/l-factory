import { Context, Data, Effect, Schema } from "effect";
import { TicketEvent, TicketState } from "../domain/ticket/ticket.js";
import type { OrgId } from "./tenancy.js";

export const TicketId = Schema.String.check(Schema.isUUID()).pipe(Schema.brand("TicketId"));
export type TicketId = typeof TicketId.Type;

export const Ticket = Schema.Struct({
  id: TicketId,
  title: Schema.String,
  body: Schema.String,
  state: TicketState,
  version: Schema.Int,
  createdAt: Schema.Date,
});
export type Ticket = typeof Ticket.Type;

export const TicketHistoryEntry = Schema.Struct({
  seq: Schema.Int,
  event: TicketEvent,
  at: Schema.Date,
});
export type TicketHistoryEntry = typeof TicketHistoryEntry.Type;

export interface NewTicket {
  readonly title: string;
  readonly body: string;
}

export class TicketNotFound extends Data.TaggedError("TicketNotFound")<{
  readonly id: TicketId;
}> {}

export class TicketStoreUnavailable extends Data.TaggedError("TicketStoreUnavailable")<{
  readonly cause: unknown;
}> {}

export class StoredTicketUndecodable extends Data.TaggedError("StoredTicketUndecodable")<{
  readonly cause: Schema.SchemaError;
}> {}

export type TicketStoreError = TicketStoreUnavailable | StoredTicketUndecodable;

export class TicketStore extends Context.Service<
  TicketStore,
  {
    readonly create: (org: OrgId, ticket: NewTicket) => Effect.Effect<Ticket, TicketStoreError>;
    readonly list: (org: OrgId) => Effect.Effect<ReadonlyArray<Ticket>, TicketStoreError>;
    readonly get: (
      org: OrgId,
      id: TicketId,
    ) => Effect.Effect<Ticket, TicketNotFound | TicketStoreError>;
    readonly history: (
      org: OrgId,
      id: TicketId,
    ) => Effect.Effect<ReadonlyArray<TicketHistoryEntry>, TicketStoreError>;
  }
>()("l-factory/TicketStore") {}
