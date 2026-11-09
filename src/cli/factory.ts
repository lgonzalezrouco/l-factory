import { Console, Effect, Option } from "effect";
import { Argument, CliError, Command, Flag } from "effect/cli";
import type { HttpClientError } from "effect/http";
import { TicketId, type Ticket, type TicketHistoryEntry } from "../application/ticket-store.js";
import type { TicketEvent, TicketState } from "../domain/ticket/ticket.js";
import { FactoryClient } from "./client.js";

const formatState = (state: TicketState): string => {
  switch (state._tag) {
    case "waiting-on-human":
      return `waiting-on-human (${state.asker})`;
    case "failed":
      return `failed (${state.reason})`;
    default:
      return state._tag;
  }
};

const stateWidth = "waiting-on-human (building)".length;

const formatTicket = (ticket: Ticket): string =>
  `${ticket.id}  ${formatState(ticket.state).padEnd(stateWidth)}  ${ticket.title}`;

const formatEvent = ({ _tag, ...fields }: TicketEvent): string =>
  [_tag, ...Object.entries(fields).map(([key, value]) => `${key}=${value}`)].join(" ");

const formatHistoryEntry = ({ seq, at, event }: TicketHistoryEntry): string =>
  `  ${seq}  ${at.toISOString()}  ${formatEvent(event)}`;

const unreachable = (reason: HttpClientError.TransportError) =>
  Effect.fail(
    new CliError.UserError({
      cause: reason,
      userMessage: `cannot reach the factory API at ${new URL(reason.request.url).origin}`,
    }),
  );

const printQueue = Effect.gen(function* () {
  const client = yield* FactoryClient;
  const tickets = yield* client.tickets.list();
  if (tickets.length === 0) return yield* Console.log("no tickets");
  for (const ticket of tickets) yield* Console.log(formatTicket(ticket));
});

const printTicket = (id: TicketId) =>
  Effect.gen(function* () {
    const client = yield* FactoryClient;
    const ticket = yield* client.tickets
      .get({ params: { id } })
      .pipe(
        Effect.catchTag("NotFound", (cause) =>
          Effect.fail(new CliError.UserError({ cause, userMessage: `no ticket ${id}` })),
        ),
      );
    const history = yield* client.tickets.history({ params: { id } });
    yield* Console.log(formatTicket(ticket));
    if (history.length === 0) return yield* Console.log("no events");
    yield* Console.log("events:");
    for (const entry of history) yield* Console.log(formatHistoryEntry(entry));
  });

const create = Command.make(
  "create",
  {
    title: Flag.String("title"),
    body: Flag.String("body").pipe(Flag.withDefault("")),
  },
  ({ title, body }) =>
    Effect.gen(function* () {
      const client = yield* FactoryClient;
      const ticket = yield* client.tickets.create({ payload: { title, body } });
      yield* Console.log(formatTicket(ticket));
    }).pipe(Effect.catchReason("HttpClientError", "TransportError", unreachable)),
);

const status = Command.make(
  "status",
  { id: Argument.String("id").pipe(Argument.withSchema(TicketId), Argument.optional) },
  ({ id }) =>
    (Option.isSome(id) ? printTicket(id.value) : printQueue).pipe(
      Effect.catchReason("HttpClientError", "TransportError", unreachable),
    ),
);

export const factory = Command.make("factory").pipe(Command.withSubcommands([create, status]));
