-- The application's database role, run once per database before the first
-- migration.
--
-- ADR 0007 has the application connect as a non-superuser so that the
-- row-level security policies actually apply to it: a table's owner bypasses
-- its own policies, so an application connecting as the owner would pass every
-- test in this repository and leak in production. Migrations run as the owner;
-- the application never does.
--
--   psql "$ADMIN_DATABASE_URL" -v app_password="secret" \
--     -f scripts/provision-database.sql

select format('create role caballus_app login password %L', :'app_password')
where not exists (select from pg_roles where rolname = 'caballus_app')
\gexec

alter role caballus_app login password :'app_password';

select format('grant connect on database %I to caballus_app', current_database())
\gexec

grant usage on schema public to caballus_app;

grant select, insert, update, delete on all tables in schema public to caballus_app;
grant usage, select on all sequences in schema public to caballus_app;

-- And for every table a later migration adds.
alter default privileges in schema public
  grant select, insert, update, delete on tables to caballus_app;
alter default privileges in schema public
  grant usage, select on sequences to caballus_app;
