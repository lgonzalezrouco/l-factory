import { Effect } from "effect";
import { SqlClient } from "effect/sql";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE notifications (
      org_id uuid NOT NULL REFERENCES orgs (id),
      ticket_id uuid NOT NULL REFERENCES tickets (id),
      kind text NOT NULL,
      body text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      read_at timestamptz,
      UNIQUE (ticket_id, kind)
    )
  `;
  yield* sql`ALTER TABLE notifications ENABLE ROW LEVEL SECURITY`;
  yield* sql`
    CREATE POLICY org_isolation ON notifications
      USING (org_id = current_setting('app.org_id')::uuid)
  `;
  yield* sql`GRANT SELECT, UPDATE (read_at) ON notifications TO factory_api`;
});
