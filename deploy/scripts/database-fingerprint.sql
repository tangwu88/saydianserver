\set ON_ERROR_STOP on
-- Run in the same exported snapshot as pg_dump. Rows never leave PostgreSQL;
-- only deterministic table counts and row-content digests enter the private log.
SELECT format(
  'SELECT json_build_object(''table'', %L, ''count'', count(*), ''digest'', md5(coalesce(string_agg(md5((to_jsonb(t) - %L::text[])::text), '''' ORDER BY md5((to_jsonb(t) - %L::text[])::text)), ''''))) FROM %I.%I t;',
  tablename,
  CASE WHEN tablename = 'PaymentIntent' THEN '{integrationKey}' WHEN tablename IN ('CommerceOAuthState','CommerceWechatBindTicket') THEN '{product}' ELSE '{}' END,
  CASE WHEN tablename = 'PaymentIntent' THEN '{integrationKey}' WHEN tablename IN ('CommerceOAuthState','CommerceWechatBindTicket') THEN '{product}' ELSE '{}' END,
  schemaname, tablename
) FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename
\gexec
SELECT json_build_object('invalidConstraints', count(*)) FROM pg_constraint WHERE NOT convalidated;
SELECT json_build_object('providerEventId', id) FROM "ProviderEvent" ORDER BY id;
