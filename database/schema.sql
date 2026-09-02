-- =============================================================================
-- MY Currency Rate Tracker — Supabase schema (Phase 7)
-- =============================================================================
-- Run this once, in full, in your Supabase project's SQL Editor
-- (Dashboard -> SQL Editor -> New query -> paste this whole file -> Run).
-- See SUPABASE_SETUP.md at the repo root for the full step-by-step walkthrough
-- of getting to this point and what to do with the keys afterward.
--
-- What this creates:
--   1. alerts        — one row per user-configured alert (Phase 7: multi-user,
--                       isolated via Row-Level Security so a user can only
--                       ever see/change their own rows).
--   2. rates          — a shared log of retrieved exchange-rate readings.
--                       Phase 7 only creates this table; nothing writes to it
--                       yet — the frontend still reads frontend/data/latest-
--                       rates.json for the live rate display (see app.js).
--                       This table exists now so Phase 8's scheduled backend
--                       job (using backend/db/supabaseClient.js's service-role
--                       client, which bypasses RLS entirely) has somewhere to
--                       write real readings once it's built.
--   3. notifications  — an append-only log of alert triggers, one row per
--                       time an alert's condition was met and a notification
--                       was (attempted to be) sent.
--
-- Design notes:
--   - `alerts.user_id` defaults to auth.uid(), so the frontend's INSERT never
--     needs to know or supply the current user's id — Postgres fills it in
--     from the authenticated request itself. This also means it's not
--     possible for a signed-in user to insert a row claiming to be a
--     different user, even if the client-side code had a bug that tried to.
--   - Every table has Row-Level Security ENABLED. `alerts` and
--     `notifications` restrict every operation to the owning user, enforced
--     at the database layer — not just hidden in the UI. `rates` is shared,
--     non-sensitive reference data (public exchange rates), so it's readable
--     by any authenticated user but not writable by anyone except the
--     service-role key (which bypasses RLS by design and is never used by
--     the frontend — see backend/db/supabaseClient.js).
--   - `sources` on `alerts` is a Postgres text array rather than a join
--     table, matching the small, fixed-for-now list of money changers. If
--     the list of sources grows into something with its own metadata
--     (per-source compliance status, per-source config, etc.) a normalized
--     `alert_sources` join table would be the natural next step — not
--     needed for Phase 7's scope.
-- =============================================================================

-- gen_random_uuid() comes from pgcrypto — Supabase Postgres ships with it,
-- but this is idempotent and harmless to run again if it's already enabled.
create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- 1. alerts — one row per user-configured alert
-- -----------------------------------------------------------------------------

create table if not exists public.alerts (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null default auth.uid() references auth.users(id) on delete cascade,

  currency               text not null,                          -- e.g. "CNY" — not constrained to a fixed list, per the project's
                                                                    -- "allow adding more currencies later" requirement
  rate_type              text not null check (rate_type in ('BUY', 'SELL')),
  target_rate            numeric not null check (target_rate > 0),
  condition              text not null default 'AT_OR_BELOW'
                           check (condition in ('AT_OR_BELOW', 'BELOW', 'REACHES', 'ABOVE', 'PCT_CHANGE')),
  pct_change_threshold   numeric check (pct_change_threshold is null or pct_change_threshold > 0),
                                                                    -- only meaningful when condition = 'PCT_CHANGE'; NULL otherwise

  sources                text[] not null default '{}'::text[]
                           check (array_length(sources, 1) is not null and array_length(sources, 1) > 0),
                                                                    -- e.g. ARRAY['mymoneymaster','tajmuhabath'] — must select at least one
  branch                 text,                                    -- Taj Muhabath branch name, if applicable; null for sources with no branches

  monitoring_interval_minutes integer not null default 5
                           check (monitoring_interval_minutes in (1, 5, 10, 15, 30)),
  notification_methods   text[] not null default '{browser}'::text[]
                           check (notification_methods <@ ARRAY['browser','email','telegram','push','whatsapp','sms']::text[]
                                  and array_length(notification_methods, 1) > 0),
                                                                    -- Phase 11: an ARRAY, not a single value — any combination
                                                                    -- may be selected at once (e.g. ['email','telegram']),
                                                                    -- and backend/scheduler/run.js delivers to every selected
                                                                    -- channel simultaneously (Promise.all, not one-at-a-time)
                                                                    -- when the alert triggers. Same array-column pattern as
                                                                    -- `sources` above, for the same reason: a fixed small set
                                                                    -- of independently-selectable options doesn't need a
                                                                    -- join table. 'browser', 'email', and 'telegram' are all
                                                                    -- real as of Phase 10 — see backend/notifications/notify.js.
                                                                    -- 'push' is real as of Phase 39 (26-Aug-2026) — genuine Web
                                                                    -- Push, delivered by the scheduled backend job even with
                                                                    -- the browser closed, distinct from 'browser' (which only
                                                                    -- ever fires from an open tab's own JS). 'whatsapp'/'sms'
                                                                    -- remain unimplemented (out of scope) but stay in the
                                                                    -- allowed set for forward compatibility.
  telegram_chat_id       text,                                     -- Phase 10: only meaningful when 'telegram' is one of
                                                                    -- notification_methods. Stored per-alert (not per-user) for
                                                                    -- simplicity, matching this table's existing philosophy
                                                                    -- of not introducing a separate profile table until
                                                                    -- something actually needs one (see the header comment's
                                                                    -- note about `sources`). No email column exists here —
                                                                    -- email delivery uses the account's own auth.users.email
                                                                    -- via the Supabase Auth admin API (service-role only),
                                                                    -- never a second, potentially-stale copy of it.
  push_subscription      jsonb,                                    -- Phase 39: only meaningful when 'push' is one of
                                                                    -- notification_methods. The browser's own PushSubscription
                                                                    -- object (`{ endpoint, keys: { p256dh, auth } }`), captured
                                                                    -- by frontend/push.js via PushManager.subscribe() and saved
                                                                    -- verbatim — same per-alert (not per-user) storage
                                                                    -- philosophy as telegram_chat_id above, and for the same
                                                                    -- reason: a subscription is inherently per-device, so
                                                                    -- there is no single "the user's push endpoint" to hang
                                                                    -- off a profile table even if one existed. jsonb (not
                                                                    -- text) so a malformed/partial subscription is rejected by
                                                                    -- Postgres at write time rather than silently stored as an
                                                                    -- unparseable string.

  status                 text not null default 'ACTIVE'
                           check (status in ('ACTIVE', 'TRIGGERED', 'DISABLED')),

  last_checked_at        timestamptz,                              -- Phase 14: set by backend/scheduler/run.js every time this
                                                                    -- alert is actually evaluated against a fresh reading (not
                                                                    -- just when it triggers). Now that monitor.yml runs on a
                                                                    -- recurring schedule instead of only a manual click, this is
                                                                    -- what lets each alert's own monitoring_interval_minutes mean
                                                                    -- something real: the scheduler skips re-evaluating an alert
                                                                    -- whose last_checked_at is more recent than its own interval.
                                                                    -- This can only ever throttle DOWN from the workflow's shared
                                                                    -- cadence (e.g. skip an "every 30 min" alert on most of the
                                                                    -- workflow's every-5-min runs) — it can never check an
                                                                    -- individual alert MORE often than the workflow itself runs.
                                                                    -- See run.js's isDueForCheck() for the exact logic.

  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

comment on table public.alerts is
  'One row per user-configured currency-rate alert. Isolated per user via RLS (see policies below) — a user can only ever see or modify their own alerts, enforced by Postgres, not just by the UI.';

create index if not exists alerts_user_id_idx on public.alerts (user_id);
create index if not exists alerts_status_idx on public.alerts (status);
-- alerts_last_checked_at_idx is NOT created here. On a brand-new database
-- the `create table if not exists` above would have just created that
-- column, so this would work — but on an EXISTING database (i.e. every
-- real re-run of this file against a live project), `create table if not
-- exists` is a no-op and last_checked_at doesn't exist yet at this point
-- in the script; it's only added later, by the Phase 14 migration block
-- near the bottom (`alter table ... add column if not exists
-- last_checked_at ...`), which is also where its index actually gets
-- created — see that block. An earlier version of this file created the
-- index here too, which broke with "column last_checked_at does not
-- exist" on exactly that real-re-run case.

-- Keep updated_at current on every UPDATE.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists alerts_set_updated_at on public.alerts;
create trigger alerts_set_updated_at
  before update on public.alerts
  for each row
  execute function public.set_updated_at();

alter table public.alerts enable row level security;

drop policy if exists "Users can view own alerts" on public.alerts;
create policy "Users can view own alerts"
  on public.alerts for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own alerts" on public.alerts;
create policy "Users can insert own alerts"
  on public.alerts for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own alerts" on public.alerts;
create policy "Users can update own alerts"
  on public.alerts for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete own alerts" on public.alerts;
create policy "Users can delete own alerts"
  on public.alerts for delete
  using (auth.uid() = user_id);

-- -----------------------------------------------------------------------------
-- 2. rates — shared log of retrieved exchange-rate readings
-- -----------------------------------------------------------------------------
-- Mirrors backend/scrapers/rateAdapter.interface.js's StandardRateResult
-- shape. Not written to by anything yet in Phase 7 — reserved for Phase 8's
-- scheduled backend job. Public exchange-rate data, not user-specific, so
-- RLS here is about "who can write" (service-role only), not "who can read
-- their own rows" the way alerts/notifications are.

create table if not exists public.rates (
  id                 uuid primary key default gen_random_uuid(),
  source             text not null,                 -- e.g. "mymoneymaster", "tajmuhabath"
  branch             text,
  currency           text not null,
  buy_rate           numeric,
  sell_rate          numeric,
  retrieved_at       timestamptz,
  source_timestamp   timestamptz,
  status             text check (status in ('LIVE', 'STALE', 'SOURCE_UNAVAILABLE', 'EXTRACTION_ERROR', 'RATE_VALIDATION_ERROR')),
  validation_status  text check (validation_status in ('PASSED', 'FAILED', 'NOT_RUN')),
  error_message      text,
  created_at         timestamptz not null default now()
);

comment on table public.rates is
  'Shared log of exchange-rate readings retrieved by the backend adapters. Public reference data (not user-specific) — reserved for Phase 8''s scheduled backend job; nothing writes here yet in Phase 7.';

create index if not exists rates_lookup_idx on public.rates (source, currency, branch, created_at desc);

alter table public.rates enable row level security;

-- Phase 20 (24-Aug-2026): widened from "to authenticated" to "to public".
-- Reported bug: the dashboard's live-rate display (Multi-source comparison
-- table, hero rows) had no way to read this table at all before this
-- change — see frontend/app.js's loadSupabaseRates()/getRealReading() for
-- the new read path this policy enables. Kept `to authenticated` for years
-- of comments calling this "public reference data" while actually blocking
-- anon reads was the real inconsistency; this aligns the policy with what
-- the table's own comment (and the project's public-accessibility
-- requirement) already said it was. No insert/update/delete policy exists
-- for anon/authenticated either way — only the service-role key (backend/
-- db/supabaseClient.js, bypasses RLS entirely) can write here.
drop policy if exists "Authenticated users can read rates" on public.rates;
drop policy if exists "Anyone can read rates" on public.rates;
create policy "Anyone can read rates"
  on public.rates for select
  to public
  using (true);

-- -----------------------------------------------------------------------------
-- 3. notifications — append-only log of alert triggers
-- -----------------------------------------------------------------------------

create table if not exists public.notifications (
  id                 uuid primary key default gen_random_uuid(),
  alert_id           uuid not null references public.alerts(id) on delete cascade,
  rate_id            uuid references public.rates(id) on delete set null,
  triggered_at       timestamptz not null default now(),
  notification_type  text not null default 'browser',
  -- Phase 25 (25-Aug-2026) bug fix: added 'NOT_APPLICABLE'. Reported: rows
  -- for notification_type = 'browser' sat permanently as 'PENDING' in this
  -- table, which read as a stuck/broken delivery. It wasn't stuck — per
  -- backend/notifications/notify.js's own original comment, 'browser' (and
  -- the still-unbuilt whatsapp/sms) have no server-side delivery channel
  -- at all: a browser notification can only ever fire from an open tab
  -- (frontend/app.js's fireAlert()), a completely separate code path that
  -- never writes to this table in the first place. 'PENDING' was chosen
  -- specifically to avoid the worse mistake of claiming DELIVERED or
  -- FAILED for something no delivery was ever attempted for — but
  -- 'PENDING' still implies "will resolve soon," which is false here: it
  -- will never resolve via this table, for any row, ever. 'NOT_APPLICABLE'
  -- says what's actually true — this channel is structurally undeliverable
  -- server-side, not stuck in a queue — while keeping the same "never
  -- claim a delivery that didn't happen" principle PENDING was chosen for
  -- in the first place.
  delivery_status    text not null default 'DELIVERED' check (delivery_status in ('DELIVERED', 'FAILED', 'PENDING', 'NOT_APPLICABLE')),
  delivery_error     text,                                        -- Phase 10: notify.js's error message when
                                                                    -- delivery_status = 'FAILED' (bad/missing API key,
                                                                    -- no email on the account, Resend/Telegram API error,
                                                                    -- etc.) — null whenever delivery_status isn't FAILED.
                                                                    -- Phase 25: also populated (non-error, explanatory)
                                                                    -- when delivery_status = 'NOT_APPLICABLE'.
  message            text
);

comment on table public.notifications is
  'Append-only log of alert-trigger notifications. Visible only to the owner of the alert it belongs to, via the alerts.user_id relationship — enforced by the policies below, not by the UI.';

create index if not exists notifications_alert_id_idx on public.notifications (alert_id);

alter table public.notifications enable row level security;

drop policy if exists "Users can view own notifications" on public.notifications;
create policy "Users can view own notifications"
  on public.notifications for select
  using (
    exists (
      select 1 from public.alerts
      where alerts.id = notifications.alert_id
        and alerts.user_id = auth.uid()
    )
  );

-- The frontend's client-side trigger detection (Phase 6/7 bridge — see
-- frontend/auth.js's onAlertTriggered hook) logs a notification row for the
-- signed-in user's own alert when it fires locally. This is a best-effort
-- bridge, not the real Phase 8 server-side evaluation — see SUPABASE_SETUP.md
-- and the Phase 7 status notes for what that means in practice.
drop policy if exists "Users can insert notifications for own alerts" on public.notifications;
create policy "Users can insert notifications for own alerts"
  on public.notifications for insert
  with check (
    exists (
      select 1 from public.alerts
      where alerts.id = notifications.alert_id
        and alerts.user_id = auth.uid()
    )
  );

-- No update/delete policy for the notifications table on purpose — it's
-- meant to be an append-only audit trail. The service-role key can still do
-- anything to it (RLS never applies to that key), which is what Phase 8's
-- backend job will use if it ever needs to correct or prune old rows.

-- -----------------------------------------------------------------------------
-- Phase 10 migration — safe to re-run on a database that already has the
-- Phase 7 tables above. `create table if not exists` never adds a column to
-- an already-existing table, so the two new columns below need their own
-- explicit, idempotent statements. If you're running this file for the
-- first time ever, these are harmless no-ops immediately after the table
-- is created with the columns already in place.
-- -----------------------------------------------------------------------------

alter table public.alerts
  add column if not exists telegram_chat_id text;

alter table public.notifications
  add column if not exists delivery_error text;

-- -----------------------------------------------------------------------------
-- Phase 11 migration — notification_method (single value) -> notification_
-- methods (array), so an alert can deliver to Email and Telegram (and
-- Browser) simultaneously instead of picking exactly one channel. Safe to
-- re-run: every step below is idempotent, and existing rows are backfilled
-- from their old single value BEFORE that old column is dropped, so no
-- alert silently loses its notification setting. If you're running this
-- file for the first time ever, the table above is already created with
-- notification_methods in place and every step below becomes a no-op.
-- -----------------------------------------------------------------------------

alter table public.alerts
  add column if not exists notification_methods text[];

-- Backfill from the old single-value column, only for rows that don't
-- already have an array value (re-running this file a second time must
-- not clobber anything). Guarded in a DO block with an information_schema
-- check, rather than a plain UPDATE referencing notification_method
-- directly: a plain reference to that column is a HARD ERROR (42703 —
-- "column does not exist"), not a harmless no-op, once a previous run of
-- this exact migration has already reached the "drop column" step further
-- below — which is true for any database that has already migrated once,
-- including re-running this entire file for an unrelated later migration
-- (e.g. Phase 14's last_checked_at). Real bug, caught 22-Aug-2026 when a
-- re-run hit exactly this on an already-migrated project.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'alerts' and column_name = 'notification_method'
  ) then
    update public.alerts
    set notification_methods = ARRAY[notification_method]
    where notification_methods is null
      and notification_method is not null;
  end if;
end $$;

-- Bug fix (28-Aug-2026): re-running this file against a real, already-live
-- database still hit "check constraint alerts_notification_methods_check
-- ... is violated by some row" even after 'push' was added to the allowed
-- set above -- meaning at least one real row holds a value outside even
-- that full 6-item set (e.g. a stray value from manual editing via the
-- Supabase Table Editor at some point, before this constraint existed to
-- prevent it). Rather than require hunting down and hand-fixing that row
-- by SELECTing for it first, strip out any element that isn't currently
-- allowed -- a self-healing step, same spirit as the "fall back to
-- {browser}" rule immediately below, which already exists for the
-- null/empty case and now also catches a row that ends up fully emptied
-- by this step (since array_length of an empty array is NULL, not 0).
update public.alerts
set notification_methods = (
  select coalesce(array_agg(elem order by elem), '{}'::text[])
  from unnest(notification_methods) as elem
  where elem = any (ARRAY['browser','email','telegram','push','whatsapp','sms'])
)
where notification_methods is not null
  and not (
    notification_methods <@ ARRAY['browser','email','telegram','push','whatsapp','sms']::text[]
    and array_length(notification_methods, 1) > 0
  );

-- Any row with neither an old value nor a new one yet (shouldn't happen
-- given notification_method's own NOT NULL default, but this must never
-- leave a row that fails the NOT NULL below) -- or one that the sanitize
-- step just above emptied out entirely -- falls back to 'browser'.
update public.alerts
set notification_methods = '{browser}'::text[]
where notification_methods is null or array_length(notification_methods, 1) is null;

alter table public.alerts
  alter column notification_methods set default '{browser}'::text[];

alter table public.alerts
  alter column notification_methods set not null;

-- Postgres has no "ADD CONSTRAINT IF NOT EXISTS" for CHECK constraints, so
-- this uses the same drop-then-create idempotency pattern already used for
-- every policy in this file.
--
-- Bug fix (28-Aug-2026): this list originally read
-- ARRAY['browser','email','telegram','whatsapp','sms'] -- accurate for what
-- Phase 11 itself introduced, but a full re-run of this WHOLE file against a
-- real, already-live database now fails right here: 'push' (added by the
-- Phase 39 migration further below) is already present in real alerts rows
-- by the time this statement runs on a second/later full re-run, and ADD
-- CONSTRAINT validates every existing row immediately -- it doesn't get the
-- chance to reach Phase 39's own (correct, 'push'-inclusive) version of this
-- same constraint a few dozen lines down before failing. Rather than leave a
-- known-narrower intermediate constraint that can reject real data,
-- 'push' is included here too, matching the final state this file always
-- converges to -- Phase 39's block below still re-drops and re-creates the
-- identical constraint immediately after, which remains a harmless no-op.
alter table public.alerts
  drop constraint if exists alerts_notification_methods_check;
alter table public.alerts
  add constraint alerts_notification_methods_check
    check (notification_methods <@ ARRAY['browser','email','telegram','push','whatsapp','sms']::text[]
           and array_length(notification_methods, 1) > 0);

-- Now safe to drop — every row has been backfilled into notification_methods
-- above, and every reader in the codebase (frontend/auth.js,
-- backend/scheduler/run.js) was updated in the same change that added this
-- migration to read the plural column instead.
alter table public.alerts
  drop column if exists notification_method;

-- -----------------------------------------------------------------------------
-- Phase 14 migration — recurring schedule support: last_checked_at.
-- Safe to re-run: `add column if not exists` is a no-op if it's already there.
-- Every existing row simply gets last_checked_at = NULL, which run.js already
-- treats as "never checked, due immediately" — no backfill needed for
-- correctness (worst case, every alert is treated as due on the very first
-- recurring run after this migrates, which is exactly what you want).
-- -----------------------------------------------------------------------------

alter table public.alerts
  add column if not exists last_checked_at timestamptz;

create index if not exists alerts_last_checked_at_idx on public.alerts (last_checked_at);

-- -----------------------------------------------------------------------------
-- Phase 39 migration (26-Aug-2026) — real Web Push delivery: push_subscription,
-- and 'push' added to the notification_methods allowed set. Safe to re-run:
-- `add column if not exists` is a no-op if it's already there, and the CHECK
-- constraint uses the same drop-then-create idempotency pattern the Phase 11
-- migration above already established. Every existing row simply gets
-- push_subscription = NULL, which notify.js already treats as "no subscription
-- saved" -> a clean FAILED delivery, not a crash, if 'push' were ever
-- (incorrectly) present in that row's notification_methods without one — it
-- won't be, since 'push' didn't exist as a selectable option before this
-- migration ran.
-- -----------------------------------------------------------------------------

alter table public.alerts
  add column if not exists push_subscription jsonb;

alter table public.alerts
  drop constraint if exists alerts_notification_methods_check;
alter table public.alerts
  add constraint alerts_notification_methods_check
    check (notification_methods <@ ARRAY['browser','email','telegram','push','whatsapp','sms']::text[]
           and array_length(notification_methods, 1) > 0);

-- -----------------------------------------------------------------------------
-- Phase 41 migration (27-Aug-2026) — last_notified_rate: dedupe repeat
-- notifications by rate value, not by trigger status. Phase 40 (same day)
-- made backend/scheduler/run.js re-evaluate a TRIGGERED alert on every run
-- instead of freezing it, and initially notified on every run the condition
-- still held (no throttling at all, an explicit product choice at the
-- time). That turned out to mean an identical notification every 5 minutes
-- for as long as the live rate sat still at/beyond target — reported as
-- unwanted spam. This column tracks the rate value that was actually
-- notified about last time (NULL if the alert has never triggered, or has
-- since reverted back to ACTIVE — see run.js's revert-to-ACTIVE branch,
-- which explicitly clears this back to NULL so a later, unrelated
-- re-trigger at a coincidentally-identical rate isn't wrongly suppressed).
-- Safe to re-run: `add column if not exists` is a no-op if it's already
-- there; every existing row simply gets last_notified_rate = NULL, which
-- run.js already treats as "never notified, don't suppress" — no backfill
-- needed for correctness.
-- -----------------------------------------------------------------------------

alter table public.alerts
  add column if not exists last_notified_rate numeric;

-- -----------------------------------------------------------------------------
-- Phase 45 addition (28-Aug-2026) — Admin Module (v3): Super Users can
-- bulk-disable, bulk-re-enable, and bulk-delete other users' accounts.
-- =============================================================================
-- Two new tables, both idempotent / safe to re-run:
--
-- 1. profiles — one row per auth.users row, holding a `role` ('user' or
--    'admin'). This is the ONLY thing that decides who is a "Super User" —
--    there is no hardcoded email allowlist anywhere. Promoting/demoting an
--    admin is a single manual `update public.profiles set role = ...`
--    statement in the SQL Editor (see ADMIN_SETUP.md) — deliberately NOT
--    exposed as a button in the Admin Module UI, since granting admin
--    rights is a more sensitive action than the bulk disable/enable/delete
--    this module actually asks for, and doing it by hand in the SQL Editor
--    leaves an unambiguous, deliberate paper trail.
--
--    A trigger (handle_new_user) auto-creates a 'user'-role profile row for
--    every NEW signup from now on. Existing users (everyone who signed up
--    before this migration ran) are backfilled below in the same statement
--    style as every other backfill in this file.
--
--    RLS: a signed-in user may only ever SELECT their own row (so the
--    frontend can show/hide the Admin link) — there is no UPDATE/INSERT/
--    DELETE policy for the normal `authenticated` role at all, matching
--    this file's existing `rates` table pattern (service-role key, or the
--    security-definer trigger below, bypasses RLS by design). This means a
--    signed-in user cannot promote themselves to admin even if the
--    frontend code had a bug that tried to.
--
-- 2. admin_actions — an append-only audit log: every disable/enable/delete
--    the admin-users Edge Function performs (success, failure, or a
--    blocked self-action) gets one row here, including a snapshot of both
--    the admin's and the target's email at the time (so the log stays
--    readable even after an account named in it is later deleted —
--    admin_user_id/target_user_id themselves are not enforced as FKs to a
--    still-existing row for that same reason, except admin_user_id, which
--    IS a real FK with ON DELETE SET NULL: the row survives, the identity
--    reference just clears, rather than the log entry disappearing).
--    Readable only by admins (via the profiles.role check below); only
--    ever written by the Edge Function's service-role client, which
--    bypasses RLS — there is no INSERT policy for the normal role at all.
--
-- Neither table is written to by the frontend directly with the anon key.
-- Every actual disable/enable/delete happens through
-- supabase/functions/admin-users/index.ts, which is the real security
-- boundary (it re-checks profiles.role server-side on every call — the
-- RLS-gated client-side read of your own profile, used to show/hide the
-- Admin link, is UX only and is never trusted as the actual gate).
-- -----------------------------------------------------------------------------

create table if not exists public.profiles (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  role        text not null default 'user' check (role in ('user', 'admin')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.profiles is
  'One row per auth.users row. role is the sole source of truth for "is this a Super User" — see the Admin Module (Phase 45) header comment above. Not writable by the anon/authenticated role at all; only the security-definer trigger below (on new signup) and the service-role key (manual promotion via SQL Editor) ever write here.';

alter table public.profiles enable row level security;

drop policy if exists "Users can view own profile" on public.profiles;
create policy "Users can view own profile"
  on public.profiles for select
  using (auth.uid() = user_id);

-- Auto-create a 'user'-role profile row for every new signup. security
-- definer so it can INSERT despite the table having no INSERT policy for
-- the normal role — the same pattern Postgres/Supabase itself documents
-- for "sync a profiles table to auth.users".
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (user_id, role)
  values (new.id, 'user')
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill: every account that signed up before this migration ran gets a
-- default 'user'-role profile row too. Safe to re-run — `on conflict do
-- nothing` means an existing row (including one already promoted to
-- 'admin' by hand) is never touched or reset back to 'user'.
insert into public.profiles (user_id, role)
select id, 'user' from auth.users
on conflict (user_id) do nothing;

create table if not exists public.admin_actions (
  id               uuid primary key default gen_random_uuid(),
  admin_user_id    uuid references auth.users(id) on delete set null,
  admin_email      text,
  action           text not null check (action in ('DISABLE', 'ENABLE', 'DELETE')),
  target_user_id   uuid,
  target_email     text,
  result           text not null check (result in ('SUCCESS', 'FAILED', 'SKIPPED')),
  error_message    text,
  created_at       timestamptz not null default now()
);

comment on table public.admin_actions is
  'Append-only audit log of every bulk disable/enable/delete the Admin Module (Phase 45) has attempted, one row per target user per attempt. Written only by supabase/functions/admin-users/index.ts using the service-role client. Readable only by admins.';

create index if not exists admin_actions_created_at_idx on public.admin_actions (created_at desc);

alter table public.admin_actions enable row level security;

drop policy if exists "Admins can view admin_actions" on public.admin_actions;
create policy "Admins can view admin_actions"
  on public.admin_actions for select
  using (
    exists (
      select 1 from public.profiles p
      where p.user_id = auth.uid() and p.role = 'admin'
    )
  );

-- -----------------------------------------------------------------------------
-- Phase 51 addition (31-Aug-2026) — notify the admin the instant someone new
-- signs up. Requested: "notify the Administrator / Superuser when there is
-- new user registered."
-- =============================================================================
-- A second, independent trigger on auth.users (alongside Phase 45's
-- on_auth_user_created, which creates the new profiles row) that calls a
-- new Supabase Edge Function — supabase/functions/notify-admin-signup — over
-- HTTP via the pg_net extension, the moment the INSERT actually happens.
-- That function sends an email (Resend) and/or a Telegram message to a
-- single fixed admin contact, mirroring backend/notifications/email.js and
-- telegram.js's real delivery calls. See ADMIN_SETUP.md Step 5 for the full
-- setup walkthrough (deploying the function, setting its secrets, and the
-- two `vault.create_secret(...)` calls this block depends on).
--
-- Why a second trigger, not one extra line inside handle_new_user(): keeps
-- the two concerns independently debuggable/toggleable (profile creation
-- must never be affected by a notification problem, and vice versa) — same
-- reasoning as this project's separate small files per notification channel
-- (email.js / telegram.js / webpush.js).
--
-- Why the webhook URL and shared secret are read from Supabase Vault
-- (vault.decrypted_secrets) instead of being written directly into this
-- function's SQL: this file is committed to a public GitHub repo. The
-- shared secret in particular must never appear in it — Vault is Supabase's
-- own standard mechanism for a database trigger to hold a value like this
-- safely (it's what the Dashboard's own "Database Webhooks" feature is
-- built on internally). The two vault secrets are created ONCE, by hand, in
-- the Supabase SQL Editor (ADMIN_SETUP.md Step 5) — never by re-running this
-- file, and this file makes no attempt to create or overwrite them.
--
-- Safety: this must NEVER cause a real signup to fail or roll back, no
-- matter what goes wrong with the notification itself (Vault not
-- configured yet, pg_net not enabled, the Edge Function down, a bad
-- network hiccup). The function body is wrapped in EXCEPTION WHEN OTHERS,
-- matching backend/notifications/notify.js's own "notifications are
-- best-effort, the core action must never depend on them" principle. If
-- the two vault secrets simply haven't been created yet (fresh install,
-- or this feature deliberately left unconfigured), this is a silent,
-- expected no-op — not a warning logged on every single signup forever.
--
-- Safe to re-run: `create extension if not exists`, `create or replace
-- function`, and the drop-then-create trigger pattern are all the same
-- idempotency style already used throughout this file.
-- -----------------------------------------------------------------------------

-- pg_net gives Postgres itself the ability to make an outbound HTTP call
-- (net.http_post below) — a standard Supabase extension, already used
-- internally by the platform's own Database Webhooks feature. If this
-- statement fails with a permissions error, enable it instead via
-- Dashboard -> Database -> Extensions -> search "pg_net" -> Enable, then
-- re-run this file.
create extension if not exists pg_net;

create or replace function public.notify_admin_of_new_signup()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  webhook_url    text;
  webhook_secret text;
begin
  select decrypted_secret into webhook_url
    from vault.decrypted_secrets where name = 'admin_signup_webhook_url';
  select decrypted_secret into webhook_secret
    from vault.decrypted_secrets where name = 'admin_signup_webhook_secret';

  if webhook_url is null or webhook_secret is null then
    return new;
  end if;

  perform net.http_post(
    url := webhook_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Signup-Webhook-Secret', webhook_secret
    ),
    body := jsonb_build_object(
      'type', 'INSERT',
      'table', 'users',
      'record', jsonb_build_object(
        'id', new.id,
        'email', new.email,
        'created_at', new.created_at
      )
    )
  );

  return new;
exception when others then
  raise warning 'notify_admin_of_new_signup failed (signup itself was not affected): %', sqlerrm;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_notify_admin on auth.users;
create trigger on_auth_user_created_notify_admin
  after insert on auth.users
  for each row execute function public.notify_admin_of_new_signup();

-- -----------------------------------------------------------------------------
-- Phase 52 migration (02-Sep-2026) -- per-source branch selection: branches.
-- Branch selection used to mean exactly one thing project-wide: Taj
-- Muhabath's own branch, stored in the single `branch` column above and
-- applied identically to whichever branch-aware source(s) an alert
-- selected. That was correct only because Taj Muhabath was the only
-- branch-aware source that ever existed. Adding real branch selection to
-- Wawasan Ilham and Jalinan Duta (both real, confirmed-different branch
-- rates -- see config/websites/wawasanilham.json and jalinanduta.json)
-- broke that assumption: an alert selecting more than one branch-aware
-- source at once (the app's own core "compare multiple money changers"
-- feature) would otherwise silently apply the same branch text to
-- sources whose branch names have nothing to do with each other.
--
-- `branches` replaces `branch` as the real source of truth going forward:
-- a jsonb object keyed by source id, e.g.
-- {"tajmuhabath":"LALAPORT BBCC","wawasanilham":"Seri Kembangan"} -- only
-- entries for sources that are BOTH selected on the alert AND actually
-- branch-aware are ever written (see frontend/auth.js's saveCurrentAlert()).
-- The old singular `branch` column is left in place, unused going
-- forward, matching this file's own established precedent for
-- notification_method -> notification_methods above (Phase 11) -- never
-- dropped, so a rollback or an old cached frontend build still has
-- something sane to read.
--
-- Backfill: every existing alert's `branch` value only ever meant
-- Taj Muhabath (the only source that could have set it), so it is copied
-- into `branches.tajmuhabath` for any row that has one and doesn't
-- already have a `branches` entry. Safe to re-run: `add column if not
-- exists` is a no-op if it's already there, and the backfill UPDATE only
-- ever touches a row whose `branches` is still the default empty object,
-- so re-running this after new branches data already exists can never
-- clobber it.
--
-- IMPORTANT DEPLOY-ORDER NOTE: run this migration BEFORE deploying the
-- frontend change that starts writing `branches` on save -- the new
-- frontend code sends a `branches` field on every alert insert/update,
-- and Postgres/PostgREST will reject that write outright ("column
-- branches does not exist") for EVERY alert save, not just branch-aware
-- ones, until this column exists. Run this in the Supabase SQL Editor
-- first, confirm it succeeds, then push the frontend commit.
-- -----------------------------------------------------------------------------

alter table public.alerts
  add column if not exists branches jsonb not null default '{}'::jsonb;

update public.alerts
set branches = jsonb_build_object('tajmuhabath', branch)
where branch is not null
  and branches = '{}'::jsonb;

-- Phase 53 migration (02-Sep-2026) -- one-time reset of every existing
-- alert's branch-aware sources to each source's own real official
-- live-site default branch, as the first data migration onto the new
-- per-source `branches` shape (see the Phase 52 migration above).
--
-- Requested explicitly: "update the respective Money Changer branch to
-- the official live site default branch for all the saved alert records
-- as the first migration to the new version." The official defaults,
-- each confirmed against the live site (not guessed) and documented in
-- that source's own config/websites/*.json:
--   tajmuhabath   -> 'THE EXCHANGE TRX' (config's branchNotes: "The page
--                    loads with a default branch already selected").
--                    NOTE: this is a genuine correction, not a no-op --
--                    every existing alert's stored Taj Muhabath branch
--                    came from frontend/app.js's own old UI default,
--                    which was DELIBERATELY set to 'LALAPORT BBCC'
--                    instead (a Phase 3 choice, to exercise the
--                    branch-selection code path in CI -- see that file's
--                    own Phase 53 comment) -- never the site's own
--                    natural default, so no existing row already had
--                    'THE EXCHANGE TRX' stored by coincidence.
--   wawasanilham  -> 'NSK Trade City, Kuchai Lama' (config.defaultBranch)
--   jalinanduta   -> 'Bukit Bintang' (config.defaultBranch)
--
-- IMPORTANT: this UPDATE always overwrites, for every alert that has that
-- source selected -- it does NOT check whether a `branches` entry already
-- exists first. That is intentional here (a one-time reset to a known
-- correct value across every existing row, exactly as requested), unlike
-- the Phase 52 migration above (a backfill that only ever filled in gaps).
-- Run this ONCE, now, as part of adopting Phase 53. Do NOT re-run it
-- later after users have started picking their own per-alert branch --
-- re-running it after that would silently overwrite their real choices
-- back to these defaults, which is exactly the kind of silent
-- overwrite this project's own Core Principle exists to prevent.
update public.alerts
set branches = branches
  || case when 'tajmuhabath' = any(sources)
       then jsonb_build_object('tajmuhabath', 'THE EXCHANGE TRX')
       else '{}'::jsonb end
  || case when 'wawasanilham' = any(sources)
       then jsonb_build_object('wawasanilham', 'NSK Trade City, Kuchai Lama')
       else '{}'::jsonb end
  || case when 'jalinanduta' = any(sources)
       then jsonb_build_object('jalinanduta', 'Bukit Bintang')
       else '{}'::jsonb end
where sources && array['tajmuhabath', 'wawasanilham', 'jalinanduta']::text[];

-- =============================================================================
-- End of schema. After running this, go back to SUPABASE_SETUP.md for how to
-- get your Project URL / anon key into frontend/supabaseConfig.js, and your
-- service-role key into a GitHub Actions secret (never into frontend code).
-- Phase 10 (email/Telegram delivery) additionally needs RESEND_API_KEY and/or
-- TELEGRAM_BOT_TOKEN as GitHub Actions secrets — see NOTIFICATIONS_SETUP.md.
-- Phase 39 (Web Push delivery) additionally needs VAPID_PUBLIC_KEY and
-- VAPID_PRIVATE_KEY as GitHub Actions secrets (plus the public key in
-- frontend/pushConfig.js) — see PUSH_SETUP.md.
-- Phase 45 (Admin Module, v3) additionally needs the admin-users Edge
-- Function deployed and its own SERVICE_ROLE_KEY secret set in Supabase
-- (note: SERVICE_ROLE_KEY, NOT SUPABASE_SERVICE_ROLE_KEY — the Supabase
-- CLI rejects any custom secret name starting with the reserved
-- SUPABASE_ prefix; see supabase/functions/admin-users/index.ts's header
-- comment) — see ADMIN_SETUP.md, including how to promote your own
-- account to admin.
-- Phase 51 (new-signup admin notification) additionally needs the
-- notify-admin-signup Edge Function deployed, its own Supabase secrets set,
-- and two vault.create_secret(...) calls run by hand in the SQL Editor —
-- see ADMIN_SETUP.md Step 5.
-- =============================================================================
