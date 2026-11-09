import { Schema } from "effect";
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiError,
  HttpApiGroup,
  HttpApiMiddleware,
  HttpApiSchema,
} from "effect/http-api";
import { Ticket, TicketId } from "../application/ticket-store.js";

export const FactoryApi = HttpApi.make("factory")
  .add(
    HttpApiGroup.make("tickets").add(
      HttpApiEndpoint.post("create", "/tickets", {
        payload: Schema.Struct({ title: Schema.String, body: Schema.optionalKey(Schema.String) }),
        success: Ticket.pipe(HttpApiSchema.status(201)),
      }).annotate(HttpApi.PayloadParseOptions, { onExcessProperty: "error" }),
      HttpApiEndpoint.get("list", "/tickets", { success: Schema.Array(Ticket) }),
      HttpApiEndpoint.get("get", "/tickets/:id", {
        params: { id: TicketId },
        success: Ticket,
        error: HttpApiError.NotFound,
      }),
    ),
  )
  .middleware(HttpApiMiddleware.ProblemDetails);
