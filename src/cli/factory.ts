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
  for (const { body } of yield* client.notifications.read()) yield* Console.log(`! ${body}`);
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

type TicketAction = Effect.Effect<
  Ticket,
  Effect.Error<ReturnType<FactoryClient["Service"]["tickets"]["approve"]>>
>;

const ticketCommand = (
  action: "approve" | "pause" | "kill",
  refusal: string,
  print: (ticket: Ticket) => string,
) =>
  Command.make(
    action,
    { id: Argument.String("id").pipe(Argument.withSchema(TicketId)) },
    ({ id }) =>
      Effect.gen(function* () {
        const client = yield* FactoryClient;
        const request: TicketAction = client.tickets[action]({ params: { id } });
        const ticket = yield* request.pipe(
          Effect.catchTags({
            KillSwitchOn: (cause) =>
              Effect.fail(
                new CliError.UserError({
                  cause,
                  userMessage:
                    "the kill switch is engaged, release it with factory kill-switch off",
                }),
              ),
            NotFound: (cause) =>
              Effect.fail(new CliError.UserError({ cause, userMessage: `no ticket ${id}` })),
            Conflict: (cause) =>
              client.tickets.get({ params: { id } }).pipe(
                Effect.flatMap(({ state }) =>
                  Effect.fail(
                    new CliError.UserError({
                      cause,
                      userMessage: `ticket ${id} is ${formatState(state)}, ${refusal}`,
                    }),
                  ),
                ),
              ),
          }),
        );
        yield* Console.log(print(ticket));
      }).pipe(
        Effect.catchReason("HttpClientError", "TransportError", unreachable),
        Effect.catchTag("Unauthorized", rejected),
      ),
  );

const approve = ticketCommand("approve", "which has nothing to approve", formatTicket);

const pause = ticketCommand("pause", "which cannot be paused", ({ state }) =>
  state._tag === "waiting-on-human" ? `paused at ${state.asker}` : formatState(state),
);

const kill = ticketCommand("kill", "which cannot be killed", () => "killed");

const killSwitch = Command.make(
  "kill-switch",
  {
    engaged: Argument.ChoiceWithValue("state", [
      ["on", true],
      ["off", false],
    ]),
  },
  ({ engaged }) =>
    Effect.gen(function* () {
      const client = yield* FactoryClient;
      const { paused } = yield* client.killSwitch.set({ payload: { engaged } });
      yield* Console.log(
        engaged
          ? `kill switch engaged, paused ${paused} ${paused === 1 ? "ticket" : "tickets"}`
          : "kill switch released",
      );
    }).pipe(
      Effect.catchTag("Forbidden", (cause) =>
        Effect.fail(
          new CliError.UserError({
            cause,
            userMessage: "only an org admin can engage or release the kill switch",
          }),
        ),
      ),
      Effect.catchReason("HttpClientError", "TransportError", unreachable),
      Effect.catchTag("Unauthorized", rejected),
    ),
);

export const factory = Command.make("factory").pipe(
  Command.withSubcommands([create, status, approve, pause, kill, killSwitch]),
);
