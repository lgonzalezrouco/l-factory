import { Console, Effect, Option, Result } from "effect";
import { Argument, CliError, Command, Flag } from "effect/cli";
import type { HttpClientError } from "effect/http";
import type { HttpApiError } from "effect/http-api";
import { TicketId, type Ticket, type TicketHistoryEntry } from "../application/ticket-store.js";
import { transition, type TicketEvent, type TicketState } from "../domain/ticket/ticket.js";
import { FactoryClient } from "./client.js";

const formatState = (state: TicketState): string => {
  switch (state._tag) {
    case "waiting-on-human":
      return `waiting-on-human (asked by ${state.asker})`;
    case "failed":
      return `failed (${state.reason})`;
    default:
      return state._tag;
  }
};

const stateWidth = "waiting-on-human (asked by building)".length;

const formatTicket = (ticket: Ticket): string =>
  `${ticket.id}  ${formatState(ticket.state).padEnd(stateWidth)}  ${ticket.title}`;

const formatEvent = ({ _tag, ...fields }: TicketEvent): string =>
  [_tag, ...Object.entries(fields).map(([key, value]) => `${key}=${value}`)].join(" ");

interface HistoryRow {
  readonly seq: string;
  readonly at: string;
  readonly label: string;
  readonly state: string;
}

const historyRows = (
  ticket: Ticket,
  history: ReadonlyArray<TicketHistoryEntry>,
): ReadonlyArray<HistoryRow> => {
  let state: TicketState | undefined = { _tag: "new" };
  const rows: Array<HistoryRow> = [
    { seq: "0", at: ticket.createdAt.toISOString(), label: "created", state: formatState(state) },
  ];
  for (const { seq, at, event } of history) {
    state = state && Result.getOrUndefined(transition(state, event, "released"));
    rows.push({
      seq: String(seq),
      at: at.toISOString(),
      label: formatEvent(event),
      state: state ? formatState(state) : "?",
    });
  }
  return rows;
};

const formatHistory = (rows: ReadonlyArray<HistoryRow>): ReadonlyArray<string> => {
  const seqWidth = Math.max(...rows.map((row) => row.seq.length));
  const labelWidth = Math.max(...rows.map((row) => row.label.length));
  return rows.map(
    ({ seq, at, label, state }) =>
      `  ${seq.padStart(seqWidth)}  ${at}  ${label.padEnd(labelWidth)}  ${state}`,
  );
};

const unreachable = (reason: HttpClientError.TransportError) =>
  Effect.fail(
    new CliError.UserError({
      cause: reason,
      userMessage: `cannot reach the factory API at ${new URL(reason.request.url).origin}`,
    }),
  );

const rejected = (cause: HttpApiError.Unauthorized) =>
  Effect.fail(
    new CliError.UserError({
      cause,
      userMessage:
        "the factory API rejected the request: set FACTORY_API_TOKEN to a valid API token",
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
    yield* Console.log("history:");
    for (const line of formatHistory(historyRows(ticket, history))) yield* Console.log(line);
  });

const approveTicket = (id: TicketId) =>
  Effect.gen(function* () {
    const client = yield* FactoryClient;
    const ticket = yield* client.tickets.approve({ params: { id } }).pipe(
      Effect.catchTags({
        NotFound: (cause) =>
          Effect.fail(new CliError.UserError({ cause, userMessage: `no ticket ${id}` })),
        Conflict: (cause) =>
          client.tickets.get({ params: { id } }).pipe(
            Effect.flatMap(({ state }) =>
              Effect.fail(
                new CliError.UserError({
                  cause,
                  userMessage: `ticket ${id} is ${formatState(state)}, which has nothing to approve`,
                }),
              ),
            ),
          ),
      }),
    );
    yield* Console.log(formatTicket(ticket));
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
    }).pipe(
      Effect.catchReason("HttpClientError", "TransportError", unreachable),
      Effect.catchTag("Unauthorized", rejected),
    ),
);

const status = Command.make(
  "status",
  { id: Argument.String("id").pipe(Argument.withSchema(TicketId), Argument.optional) },
  ({ id }) =>
    (Option.isSome(id) ? printTicket(id.value) : printQueue).pipe(
      Effect.catchReason("HttpClientError", "TransportError", unreachable),
      Effect.catchTag("Unauthorized", rejected),
    ),
);

const approve = Command.make(
  "approve",
  { id: Argument.String("id").pipe(Argument.withSchema(TicketId)) },
  ({ id }) =>
    approveTicket(id).pipe(
      Effect.catchReason("HttpClientError", "TransportError", unreachable),
      Effect.catchTag("Unauthorized", rejected),
    ),
);

export const factory = Command.make("factory").pipe(
  Command.withSubcommands([create, status, approve]),
);
