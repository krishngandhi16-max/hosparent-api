-- ============================================================
-- Preflight: run this FIRST and read the output before 010.
-- Inspect before inferring — confirms actual table/column names
-- so the migration and confidence pipeline point at real objects.
-- Usage: psql -d hosparent -f sql/000_preflight_inspect.sql
-- ============================================================

\echo '--- All public tables ---'
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' ORDER BY table_name;

\echo '--- procedures table shape ---'
\d procedures

\echo '--- price/MRF row table candidates (look for the ~49.5M row table) ---'
SELECT relname, n_live_tup
FROM pg_stat_user_tables
ORDER BY n_live_tup DESC
LIMIT 10;

\echo '--- Does procedure_episode_costs already exist? ---'
SELECT EXISTS (
  SELECT 1 FROM information_schema.tables
  WHERE table_schema='public' AND table_name='procedure_episode_costs'
) AS episode_costs_exists;

\echo '--- Columns of the largest table (edit name after first run) ---'
-- \d prices

\echo '--- pg_trgm availability ---'
SELECT * FROM pg_available_extensions WHERE name = 'pg_trgm';
