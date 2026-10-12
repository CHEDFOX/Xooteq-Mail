-- The databases test/appUsers.test.ts reads when XM_TEST_PG is set:
--   createdb sb && createdb plain
--   psql -d sb -f test/users-fixture.sql -v which=sb
--   psql -d plain -f test/users-fixture.sql -v which=plain
--   psql -d sb2 -f test/users-fixture.sql -v which=sb2
-- "sb" is shaped like a Supabase project's auth schema (120 users: one deleted,
-- one anonymous, every fifth phone-only, one with a session refreshed an hour
-- ago), a public.profiles with the names and gender the app collected, and a
-- login, reader, that may read only some columns of auth.users (and no profiles).
-- "plain" is an app's own members table, dates in epoch milliseconds.
\if :{?which}
\else
  \echo 'pass -v which=sb, sb2 or plain'
  \quit
\endif
SELECT :'which' = 'sb' AS is_sb, :'which' = 'sb2' AS is_sb2 \gset
\if :is_sb
create schema auth; create schema storage;
create table auth.users (
  instance_id uuid, id uuid primary key default gen_random_uuid(), aud varchar(255), role varchar(255),
  email varchar(255), encrypted_password varchar(255), email_confirmed_at timestamptz,
  last_sign_in_at timestamptz, raw_app_meta_data jsonb, raw_user_meta_data jsonb,
  created_at timestamptz, updated_at timestamptz, phone text unique default null,
  phone_confirmed_at timestamptz, deleted_at timestamptz, is_anonymous boolean not null default false);
create table auth.sessions (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id),
  created_at timestamptz, updated_at timestamptz, refreshed_at timestamp without time zone, user_agent text);
create table storage.objects (id uuid, name text, owner uuid);
-- Tailzu's own: the name and gender the app asks for, keyed by user_id.
create table public.profiles (user_id uuid primary key references auth.users (id) on delete cascade,
  language text not null default 'auto', full_name text, gender text, created_at timestamptz not null default now());
insert into auth.users (email, phone, created_at, last_sign_in_at, raw_app_meta_data, raw_user_meta_data, deleted_at, is_anonymous)
select
  case when i % 5 = 0 then null else 'user' || i || '@example.com' end,
  case when i % 5 = 0 then '9198765' || lpad(i::text, 5, '0') else null end,
  now() - (i || ' days')::interval,
  case when i % 7 = 0 then null else now() - ((i % 20) || ' days')::interval end,
  jsonb_build_object('provider', case when i % 5 = 0 then 'phone' when i % 3 = 0 then 'google' else 'email' end),
  case when i % 4 = 0 then '{}'::jsonb when i % 3 = 0 then jsonb_build_object('name', 'Name ' || i) else jsonb_build_object('full_name', 'Person ' || i) end,
  case when i = 13 then now() else null end,
  i = 17
from generate_series(1, 120) i;
-- Every account has a row (Tailzu's trigger makes one); a few were filled in.
-- user1's app name beats the one Google sent; user4 sent none; user8's is blank.
insert into public.profiles (user_id, full_name, gender)
select u.id,
  case u.email when 'user1@example.com' then 'Asha Rao' when 'user4@example.com' then 'App Name 4' when 'user8@example.com' then '   ' end,
  case u.email when 'user1@example.com' then 'female' when 'user4@example.com' then 'female' when 'user3@example.com' then 'male' end
from auth.users u;
insert into auth.sessions (user_id, created_at, updated_at, refreshed_at)
select id, now() - interval '2 days', now() - interval '2 days', (now() - interval '1 hour')::timestamp from auth.users where email = 'user2@example.com';
create role reader login;
grant usage on schema auth to reader;
grant select (id, email, phone, created_at, last_sign_in_at, raw_user_meta_data) on auth.users to reader;
\elif :is_sb2
-- Another app's layout: names in a table of its own (app_users, camelCase
-- "displayName", linked by a unique foreign key), Google's given/family names
-- in the sign-in data, an orders table whose "name" is not a person's, and an
-- onboarding table with no foreign key, for picking by hand.
create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email varchar(255), phone text,
  created_at timestamptz, last_sign_in_at timestamptz, raw_app_meta_data jsonb, raw_user_meta_data jsonb, deleted_at timestamptz);
insert into auth.users (email, created_at, raw_app_meta_data, raw_user_meta_data)
select 'p' || i || '@plutto.test', now() - (i || ' days')::interval, '{"provider":"google"}',
  case when i = 2 then '{"given_name":"Given","family_name":"Family"}'::jsonb else '{}'::jsonb end
from generate_series(1, 6) i;
create table public.app_users (user_ref uuid unique references auth.users (id), "displayName" text, sex text);
insert into public.app_users
select id, case email when 'p1@plutto.test' then 'Ravi Kumar' when 'p3@plutto.test' then 'Meera' end,
  case email when 'p1@plutto.test' then 'male' end
from auth.users;
create table public.orders (id serial primary key, user_id uuid references auth.users (id), name text);
insert into public.orders (user_id, name) select id, 'Order for ' || email from auth.users;
create table public.onboarding (uid uuid, nick text);
insert into public.onboarding select id, 'Nick ' || split_part(email, '@', 1) from auth.users;
\else
create table public.orders (id serial primary key, total numeric, created_at timestamptz);
create table public.members (member_id serial primary key, full_name text, email_address text, mobile text, joined_at bigint, last_seen_at timestamp);
insert into public.members (full_name, email_address, mobile, joined_at, last_seen_at)
select 'Member ' || i, 'm' || i || '@plain.test', '+44 7700 9000' || lpad(i::text, 2, '0'),
  (extract(epoch from now() - (i * 3 || ' days')::interval) * 1000)::bigint, now() - (i || ' hours')::interval
from generate_series(1, 30) i;
create role plainreader login; grant select on public.members to plainreader;
\endif
