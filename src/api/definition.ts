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
import { CurrentPrincipal } from "../application/tenancy.js";
import { Ticket, TicketHistoryEntry, TicketId } from "../application/ticket-store.js";

export class Authorization extends HttpApiMiddleware.Service<
  Authorization,
  { provides: CurrentPrincipal }
>()("l-factory/Authorization", {
  security: { bearer: HttpApiSecurity.bearer },
  error: HttpApiError.UnauthorizedNoContent,
}) {}

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
      )
      .middleware(Authorization),
  )
  .middleware(HttpApiMiddleware.ProblemDetails);
