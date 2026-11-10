import { Effect } from "effect";
import { SqlClient } from "effect/sql";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE orgs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `;
  yield* sql`
    CREATE TABLE projects (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id uuid NOT NULL REFERENCES orgs (id),
      name text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (org_id, id)
    )
  `;
  yield* sql`
    CREATE TABLE repos (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id uuid NOT NULL REFERENCES projects (id),
      url text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `;
  yield* sql`
    CREATE TABLE users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      login text NOT NULL UNIQUE,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `;
  yield* sql`
    CREATE TABLE memberships (
      user_id uuid NOT NULL REFERENCES users (id),
      org_id uuid NOT NULL REFERENCES orgs (id),
      role text NOT NULL CHECK (role IN ('admin', 'dev', 'area-owner')),
      PRIMARY KEY (user_id, org_id)
    )
  `;
  yield* sql`
    CREATE TABLE api_tokens (
      token_hash text PRIMARY KEY,
      user_id uuid NOT NULL,
      org_id uuid NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      FOREIGN KEY (user_id, org_id) REFERENCES memberships (user_id, org_id)
    )
  `;
  yield* sql`
    ALTER TABLE tickets
      ADD COLUMN org_id uuid NOT NULL REFERENCES orgs (id),
      ADD COLUMN project_id uuid NOT NULL,
      ADD FOREIGN KEY (org_id, project_id) REFERENCES projects (org_id, id),
      ADD UNIQUE (id, org_id, project_id)
  `;
  yield* sql`
    ALTER TABLE ticket_events
      ADD COLUMN org_id uuid NOT NULL,
      ADD COLUMN project_id uuid NOT NULL,
      ADD FOREIGN KEY (ticket_id, org_id, project_id)
        REFERENCES tickets (id, org_id, project_id)
  `;
  for (const table of ["tickets", "ticket_events", "projects"]) {
    yield* sql`ALTER TABLE ${sql(table)} ENABLE ROW LEVEL SECURITY`;
    yield* sql`
      CREATE POLICY org_isolation ON ${sql(table)}
        USING (org_id = current_setting('app.org_id')::uuid)
    `;
  }
  yield* sql`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'factory_api') THEN
        CREATE ROLE factory_api LOGIN PASSWORD 'factory_api' NOSUPERUSER NOBYPASSRLS;
      END IF;
    END $$
  `;
  yield* sql`GRANT SELECT, INSERT ON tickets, ticket_events TO factory_api`;
  yield* sql`GRANT SELECT ON projects TO factory_api`;
  yield* sql`
    CREATE FUNCTION authenticate_api_token(token text)
      RETURNS TABLE (user_id uuid, org_id uuid)
      LANGUAGE sql STABLE SECURITY DEFINER
      SET search_path = pg_catalog, pg_temp
    AS $$
      SELECT t.user_id, t.org_id FROM public.api_tokens t
      WHERE t.token_hash = encode(sha256(convert_to(token, 'UTF8')), 'hex')
    $$
  `;
  yield* sql`REVOKE ALL ON FUNCTION authenticate_api_token(text) FROM PUBLIC`;
  yield* sql`GRANT EXECUTE ON FUNCTION authenticate_api_token(text) TO factory_api`;
});
