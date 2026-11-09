import { Effect } from "effect";
import { SqlClient } from "effect/sql";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE tickets (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      title text NOT NULL,
      body text NOT NULL,
      state jsonb NOT NULL,
      version integer NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `;
  yield* sql`
    CREATE TABLE ticket_events (
      ticket_id uuid NOT NULL REFERENCES tickets (id),
      seq integer NOT NULL,
      event jsonb NOT NULL,
      at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (ticket_id, seq)
    )
  `;
});
