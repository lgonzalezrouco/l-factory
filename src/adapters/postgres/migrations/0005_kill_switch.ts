import { Effect } from "effect";
import { SqlClient } from "effect/sql";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE kill_switch (
      id boolean PRIMARY KEY DEFAULT true CHECK (id),
      engaged boolean NOT NULL DEFAULT false
    )
  `;
  yield* sql`INSERT INTO kill_switch DEFAULT VALUES`;
  yield* sql`GRANT SELECT, UPDATE (engaged) ON kill_switch TO factory_api`;
  yield* sql`DROP FUNCTION authenticate_api_token(text)`;
  yield* sql`
    CREATE FUNCTION authenticate_api_token(token text)
      RETURNS TABLE (user_id uuid, org_id uuid, role text)
      LANGUAGE sql STABLE SECURITY DEFINER
      SET search_path = pg_catalog, pg_temp
    AS $$
      SELECT t.user_id, t.org_id, m.role FROM public.api_tokens t
      JOIN public.memberships m USING (user_id, org_id)
      WHERE t.token_hash = encode(sha256(convert_to(token, 'UTF8')), 'hex')
    $$
  `;
  yield* sql`REVOKE ALL ON FUNCTION authenticate_api_token(text) FROM PUBLIC`;
  yield* sql`GRANT EXECUTE ON FUNCTION authenticate_api_token(text) TO factory_api`;
  yield* sql`
    CREATE FUNCTION running_tickets()
      RETURNS TABLE (id uuid, org_id uuid)
      LANGUAGE sql STABLE SECURITY DEFINER
      SET search_path = pg_catalog, pg_temp
    AS $$
      SELECT t.id, t.org_id FROM public.tickets t
      WHERE t.state->>'_tag' IN ('triage', 'spec', 'building', 'review')
    $$
  `;
  yield* sql`REVOKE ALL ON FUNCTION running_tickets() FROM PUBLIC`;
  yield* sql`GRANT EXECUTE ON FUNCTION running_tickets() TO factory_api`;
});
