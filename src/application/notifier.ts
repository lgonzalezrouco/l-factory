import { Context, Data, Effect, Schema } from "effect";
import type { OrgId } from "./tenancy.js";
import { TicketId } from "./ticket-store.js";

export const NotificationKind = Schema.Literals(["run-failed"]);
export type NotificationKind = typeof NotificationKind.Type;

export const Notification = Schema.Struct({
  ticketId: TicketId,
  kind: NotificationKind,
  body: Schema.String,
  createdAt: Schema.Date,
});
export type Notification = typeof Notification.Type;

export class NotifierUnavailable extends Data.TaggedError("NotifierUnavailable")<{
  readonly cause: unknown;
}> {}

export class StoredNotificationUndecodable extends Data.TaggedError(
  "StoredNotificationUndecodable",
)<{
  readonly cause: Schema.SchemaError;
}> {}

export class Notifier extends Context.Service<
  Notifier,
  {
    readonly notify: (
      notification: Omit<Notification, "createdAt">,
    ) => Effect.Effect<void, NotifierUnavailable>;
    readonly takeUnread: (
      org: OrgId,
    ) => Effect.Effect<
      ReadonlyArray<Notification>,
      NotifierUnavailable | StoredNotificationUndecodable
    >;
  }
>()("l-factory/Notifier") {}
