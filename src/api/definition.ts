import { Schema } from "effect";
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiError,
  HttpApiGroup,
  HttpApiMiddleware,
  HttpApiSchema,
  HttpApiSecurity,
} from "effect/http-api";
import { Notification } from "../application/notifier.js";
import { CurrentPrincipal } from "../application/tenancy.js";
import { Ticket, TicketHistoryEntry, TicketId } from "../application/ticket-store.js";

export class Authorization extends HttpApiMiddleware.Service<
  Authorization,
  { provides: CurrentPrincipal }
>()("l-factory/Authorization", {
  security: { bearer: HttpApiSecurity.bearer },
  error: HttpApiError.UnauthorizedNoContent,
}) {}

export class KillSwitchOn extends Schema.TaggedError<
  KillSwitchOn,
  { readonly brand: unique symbol }
>()("KillSwitchOn", {}, { httpApiStatus: 409 }) {}

export const FactoryApi = HttpApi.make("factory")
  .add(
    HttpApiGroup.make("tickets")
      .add(
        HttpApiEndpoint.post("create", "/tickets", {
          payload: Schema.Struct({ title: Schema.String, body: Schema.optionalKey(Schema.String) }),
          success: Ticket.pipe(HttpApiSchema.status(201)),
        }).annotate(HttpApi.PayloadParseOptions, { onExcessProperty: "error" }),
        HttpApiEndpoint.get("list", "/tickets", { success: Schema.Array(Ticket) }),
        HttpApiEndpoint.get("get", "/tickets/:id", {
          params: { id: TicketId },
          success: Ticket,
          error: HttpApiError.NotFoundNoContent,
        }),
        HttpApiEndpoint.get("history", "/tickets/:id/events", {
          params: { id: TicketId },
          success: Schema.Array(TicketHistoryEntry),
        }),
        HttpApiEndpoint.post("approve", "/tickets/:id/approve", {
          params: { id: TicketId },
          success: Ticket,
          error: [HttpApiError.NotFoundNoContent, HttpApiError.ConflictNoContent, KillSwitchOn],
        }),
        HttpApiEndpoint.post("pause", "/tickets/:id/pause", {
          params: { id: TicketId },
          success: Ticket,
          error: [HttpApiError.NotFoundNoContent, HttpApiError.ConflictNoContent],
        }),
        HttpApiEndpoint.post("kill", "/tickets/:id/kill", {
          params: { id: TicketId },
          success: Ticket,
          error: [HttpApiError.NotFoundNoContent, HttpApiError.ConflictNoContent],
        }),
      )
      .middleware(Authorization),
  )
  .add(
    HttpApiGroup.make("notifications")
      .add(
        HttpApiEndpoint.post("read", "/notifications/read", {
          success: Schema.Array(Notification),
        }),
      )
      .middleware(Authorization),
  )
  .add(
    HttpApiGroup.make("killSwitch")
      .add(
        HttpApiEndpoint.put("set", "/kill-switch", {
          payload: Schema.Struct({ engaged: Schema.Boolean }),
          success: Schema.Struct({ engaged: Schema.Boolean, paused: Schema.Int }),
          error: HttpApiError.ForbiddenNoContent,
        }),
      )
      .middleware(Authorization),
  )
  .middleware(HttpApiMiddleware.ProblemDetails);
