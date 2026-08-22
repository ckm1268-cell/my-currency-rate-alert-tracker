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
  notification_method    text not null default 'browser'
                           check (notification_method in ('browser', 'email', 'telegram', 'whatsapp', 'sms')),
                                                                    -- 'browser', 'email', and 'telegram' are all real as of
                                                                    -- Phase 10 — see backend/notifications/notify.js.
                                                                    -- 'whatsapp'/'sms' remain unimplemented (out of scope).
  telegram_chat_id       text,                                     -- Phase 10: only meaningful when notification_method =
                                                                    -- 'telegram'. Stored per-alert (not per-user) for
                                                                    -- simplicity, matching this table's existing philosophy
                                                                    -- of not introducing a separate profile table until
                                                                    -- something actually needs one (see the header comment's
                                                                    -- note about `sources`). No email column exists here —
                                                                    -- email delivery uses the account's own auth.users.email
                                                                    -- via the Supabase Auth admin API (service-role only),
                                                                    -- never a second, potentially-stale copy of it.

  status                 text not null default 'ACTIVE'
                           check (status in ('ACTIVE', 'TRIGGERED', 'DISABLED')),

  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

comment on table public.alerts is
  'One row per user-configured currency-rate alert. Isolated per user via RLS (see policies below) — a user can only ever see or modify their own alerts, enforced by Postgres, not just by the UI.';

create index if not exists alerts_user_id_idx on public.alerts (user_id);
create index if not exists alerts_status_idx on public.alerts (status);

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

-- Any authenticated user can read rate history (it's public market data).
-- No insert/update/delete policy is created for the anon/authenticated
-- roles, which means only the service-role key (used exclusively by the
-- backend — see backend/db/supabaseClient.js — and which bypasses RLS
-- entirely) can write here.
drop policy if exists "Authenticated users can read rates" on public.rates;
create policy "Authenticated users can read rates"
  on public.rates for select
  to authenticated
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
  delivery_status    text not null default 'DELIVERED' check (delivery_status in ('DELIVERED', 'FAILED', 'PENDING')),
  delivery_error     text,                                        -- Phase 10: notify.js's error message when
                                                                    -- delivery_status = 'FAILED' (bad/missing API key,
                                                                    -- no email on the account, Resend/Telegram API error,
                                                                    -- etc.) — null whenever delivery_status isn't FAILED.
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

-- =============================================================================
-- End of schema. After running this, go back to SUPABASE_SETUP.md for how to
-- get your Project URL / anon key into frontend/supabaseConfig.js, and your
-- service-role key into a GitHub Actions secret (never into frontend code).
-- Phase 10 (email/Telegram delivery) additionally needs RESEND_API_KEY and/or
-- TELEGRAM_BOT_TOKEN as GitHub Actions secrets — see NOTIFICATIONS_SETUP.md.
-- =============================================================================
