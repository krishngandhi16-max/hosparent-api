-- Read-only role for the DB agent's run_readonly_sql tool.
-- Run once as a superuser/owner:  psql -d hosparent -f agent_readonly_role.sql
-- Then set DB_READONLY_USER / DB_READONLY_PASSWORD in the environment.
--
-- The agent already wraps every query in a READ ONLY transaction, so this role
-- is defense-in-depth: it can SELECT from existing + future tables and nothing else.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hosparent_readonly') THEN
    CREATE ROLE hosparent_readonly LOGIN PASSWORD 'CHANGE_ME_IN_KEY_VAULT';
  END IF;
END
$$;

GRANT CONNECT ON DATABASE hosparent TO hosparent_readonly;
GRANT USAGE ON SCHEMA public TO hosparent_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO hosparent_readonly;

-- Make future tables readable too, without re-granting.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO hosparent_readonly;

-- Explicitly ensure no write ability is inherited.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public FROM hosparent_readonly;
