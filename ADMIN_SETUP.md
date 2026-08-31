# Admin Module setup (Phase 45 / v3)

This is the setup guide for the **Admin Module**: a page (`admin.html`) where a
**Super User** can bulk-disable, bulk-re-enable, and bulk-delete other users'
accounts, and (Step 5, optional) get notified by email/Telegram the instant
someone new signs up. It follows the same "what's real, what needs your
action" style as `SUPABASE_SETUP.md`, `NOTIFICATIONS_SETUP.md`,
`PUSH_SETUP.md`, and `MOBILE_APP_SETUP.md` — read those first if you haven't
set this app up at all yet.

## Why this needs a separate piece of infrastructure

Disabling, re-enabling, and deleting a Supabase Auth user account can only be
done through Supabase's **Admin API**, which requires the **service-role
key** — the same key `backend/scheduler/run.js` already uses, which bypasses
every Row-Level Security policy in `database/schema.sql` and must never reach
the browser. This app's frontend is static GitHub Pages with no server of
its own, and the existing GitHub Actions scheduler is a batch job on a timer,
not something a button click can call synchronously.

The fix is a **Supabase Edge Function** —
`supabase/functions/admin-users/index.ts` — a small serverless function that
runs on Supabase's own infrastructure. It reads the service-role key from a
**custom Supabase secret named `SERVICE_ROLE_KEY`**, which you set yourself
in Step 2 — a different, separate value from the `SUPABASE_SERVICE_ROLE_KEY`
GitHub Actions secret you already have for the scheduler, though as of the
Aug-2026 key rotation both now hold the same underlying `sb_secret_...` key
from Project Settings → API Keys. (Earlier versions of this function relied
on Supabase's legacy auto-injected `SUPABASE_SERVICE_ROLE_KEY` — that stopped
being usable once this project's legacy JWT-based keys were retired, since
the CLI won't let you set a custom secret starting with `SUPABASE_`, so this
version reads the differently-named `SERVICE_ROLE_KEY` instead.)
`frontend/admin.js` calls this function over HTTPS, using your own signed-in
session — never the service-role key itself.

## What "Super User" means here

There is no hardcoded list of admin email addresses anywhere in this repo.
Whether an account is a Super User is decided entirely by one column:
`public.profiles.role`, which is either `'user'` (the default for every new
signup) or `'admin'`. Promoting an account to admin is a single manual SQL
statement you run yourself (step 3 below) — deliberately not a button in the
UI, since granting admin rights is more sensitive than the disable/enable/
delete actions the Admin Module itself performs.

## Step 1 — run the schema migration

If you've already run `database/schema.sql` before, just re-run the **whole
file** again in the Supabase SQL Editor (Dashboard → SQL Editor → paste the
whole file → Run) — every statement in it is idempotent, including the new
Phase 45 block near the end. It creates:

- `public.profiles` — one row per user, holding `role`. A trigger
  auto-creates a `'user'`-role row for every future signup; the same
  migration also backfills a row for every account that already existed.
- `public.admin_actions` — an append-only audit log of every disable/enable/
  delete the Admin Module performs (who did it, to whom, when, and whether it
  succeeded) — readable only by admins.

## Step 2 — deploy the Edge Function

You'll need the [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started).
**Don't use `npm install -g supabase`** — Supabase's own npm package refuses
a global install and errors out (this is the most common cause of a
`'supabase' is not recognized as the name of a cmdlet...` error in
PowerShell). Use `npx` instead, which needs no separate install step at all
— every command below is written that way. (If you'd rather have a real
`supabase` command on your PATH, `scoop install supabase` is the supported
way to do that on Windows — see the docs link above — but it's optional;
`npx` works fine without it.)

From the repo root, log in once (opens a browser to authorize):

```bash
npx -y supabase@latest login
```

Then:

```bash
# Link this local checkout to your Supabase project (one-time; find your
# project ref in the Supabase Dashboard's Project Settings > General page)
npx -y supabase@latest link --project-ref YOUR-PROJECT-REF

# Set the two secrets the function needs. SUPABASE_URL is provided
# automatically by the Edge Functions runtime for every project — you only
# need to set these two yourself. Note the secret name is SERVICE_ROLE_KEY,
# not SUPABASE_SERVICE_ROLE_KEY — the CLI rejects any custom secret name
# starting with SUPABASE_, since that whole prefix is reserved for the
# platform's own auto-injected values:
npx -y supabase@latest secrets set SERVICE_ROLE_KEY=your-secret-api-key
npx -y supabase@latest secrets set ALLOWED_ORIGIN=https://your-username.github.io

# Deploy
npx -y supabase@latest functions deploy admin-users
```

(`npx -y supabase@latest ...` downloads and runs the CLI fresh each time
rather than requiring any install step — the first run of each session is a
few seconds slower than a truly-installed `supabase` command, that's the
only difference. Every `supabase ...` command anywhere else in this project's
docs can be run the same way, with `npx -y supabase@latest` in front.)

`SERVICE_ROLE_KEY` should be your project's current `sb_secret_...` key from
Project Settings → API Keys → "Publishable and secret API keys" tab (click
the eye icon to reveal it) — this is the modern replacement for the legacy
JWT-based `service_role` key, and it's the same value you should also be
using for the `SUPABASE_SERVICE_ROLE_KEY` GitHub Actions secret that the
scheduler uses. `ALLOWED_ORIGIN` should be your actual deployed app
origin (no trailing path) — this restricts which website is allowed to call
the function via CORS; it defaults to `https://app.mycurrencyalerts.abrdns.com`
(this project's custom domain, added 31-Aug-2026) if you don't set it, which is
only correct if you haven't forked/renamed this repo. If you ever open the Admin
Module from the original `https://ckm1268-cell.github.io` URL instead, set this
secret to that origin or the Edge Function call will be blocked by CORS.

**Never** put either of these values in any file under `frontend/`, and
never commit them to the repo — `SERVICE_ROLE_KEY` only ever lives as a
Supabase secret (this step), and the scheduler's own copy only ever lives as
a GitHub Actions secret.

## Step 3 — promote your own account to Super User

In the Supabase SQL Editor, run (substituting your real sign-in email):

```sql
update public.profiles
set role = 'admin'
where user_id = (select id from auth.users where email = 'you@example.com');
```

Verify it took effect:

```sql
select u.email, p.role
from public.profiles p
join auth.users u on u.id = p.user_id
where p.role = 'admin';
```

You can promote more than one account the same way, and demote one back to
`'user'` by re-running the first statement with `role = 'user'`.

## Step 4 — use it

1. Sign in on the main dashboard (`index.html`) as usual.
2. If your account has `role = 'admin'`, a **"🛡️ Admin"** link appears in the
   topbar — click it, or go directly to `admin.html`.
3. You'll see every account: email, role, status (Active/Disabled), created
   date, and last sign-in. Filter by typing in the search box.
4. Tick one or more accounts, then click **Disable selected**, **Enable
   selected**, or **Delete selected**. A confirmation dialog lists exactly
   which accounts you're about to affect before anything happens — deleting
   is irreversible and permanently removes that account's saved alerts and
   notification history along with it (this is enforced by the database's
   own `ON DELETE CASCADE` relationships, not by application code that could
   have a bug and leave orphaned rows behind).
5. You can never select your own account — its checkbox is disabled. This is
   a deliberate safety rail so an admin can't accidentally lock themselves
   out with no other admin left to undo it.
6. Every action (success, failure, or a blocked self-action) is recorded and
   shown in the **"Recent admin activity"** log at the bottom of the page.

## Step 5 — (optional) notify the admin when someone new signs up

This is a separate, optional piece of infrastructure — everything above
(Steps 1-4) works completely on its own without it. It adds a second
Supabase Edge Function, `supabase/functions/notify-admin-signup`, called the
instant a new row lands in `auth.users` (via a database trigger + `pg_net` —
see `database/schema.sql`'s Phase 51 block), which emails and/or
Telegram-messages **one fixed admin contact** the moment someone signs up.
It does not look up every `profiles.role = 'admin'` account — it's a single
configured destination, the same "keep it simple" choice this project makes
elsewhere (see `backend/notifications/telegram.js`'s per-alert, not
per-user, chat ID storage).

### 5a — deploy the function

```bash
# --no-verify-jwt is required: this function is called by Postgres itself
# (via pg_net), which has no Supabase user session/JWT to present. Without
# this flag, Supabase's platform-level auth check rejects the call before
# this function's own code (the X-Signup-Webhook-Secret check) ever runs.
npx -y supabase@latest functions deploy notify-admin-signup --no-verify-jwt
```

### 5b — set its secrets

```bash
# A random value you generate yourself (e.g. `openssl rand -hex 32`) — this
# is NOT your Supabase service-role key. It only proves the call genuinely
# came from this project's own database trigger, not a stranger who found
# the function's URL. You'll reuse this same value again in Step 5c below.
npx -y supabase@latest secrets set SIGNUP_WEBHOOK_SECRET=your-random-secret-here

# Where the notification goes. Set either or both — whichever you don't set
# is simply skipped (reported as "skipped, not attempted" in the function's
# logs), it never causes an error.
npx -y supabase@latest secrets set ADMIN_NOTIFY_EMAIL=you@example.com
npx -y supabase@latest secrets set ADMIN_NOTIFY_TELEGRAM_CHAT_ID=your-telegram-chat-id

# Same Resend/Telegram credentials the scheduler already uses — but Edge
# Functions run on Supabase's own infrastructure, completely separate from
# GitHub Actions, so they CANNOT read your GitHub Actions secrets. These
# have to be set again, here, as their own Supabase secrets, even though
# the values are identical to what's already in your GitHub Actions repo
# secrets. See NOTIFICATIONS_SETUP.md if you haven't set these up at all.
npx -y supabase@latest secrets set RESEND_API_KEY=your-resend-api-key
npx -y supabase@latest secrets set TELEGRAM_BOT_TOKEN=your-telegram-bot-token
```

### 5c — connect the database trigger to the function

The trigger added by Step 1's schema migration (`database/schema.sql`'s
Phase 51 block) needs to know this function's URL and the same webhook
secret from Step 5b — read from **Supabase Vault**, not written into the
repo (this file is public; the webhook secret must never be committed). Run
this once in the Supabase SQL Editor, filling in your own project ref (find
it in Project Settings → General, or in the URL the Edge Functions page
gives you after deploying) and the exact same secret value you set in 5b:

```sql
select vault.create_secret(
  'https://YOUR-PROJECT-REF.supabase.co/functions/v1/notify-admin-signup',
  'admin_signup_webhook_url'
);
select vault.create_secret(
  'your-random-secret-here',   -- must match SIGNUP_WEBHOOK_SECRET from 5b exactly
  'admin_signup_webhook_secret'
);
```

If either statement fails with something like `schema "vault" does not
exist`, enable the Vault extension first via Dashboard → Database →
Extensions → search "Vault" → Enable, then re-run the two statements above.

Then (re-)run the whole `database/schema.sql` file in the SQL Editor if you
haven't already picked up the Phase 51 block from Step 1 — it's idempotent,
same as every other migration in that file, so re-running it in full is
always safe.

### 5d — test it

Sign up a genuinely disposable test account (or use one you're about to
delete anyway) and confirm the admin contact(s) you configured in 5b
receive a "🆕 New User Registered" email and/or Telegram message within a
few seconds — not up to 5 minutes, since this doesn't go through the
GitHub Actions scheduler at all. If nothing arrives, see Troubleshooting
below.

To change the admin contact or rotate the webhook secret later, re-run the
relevant `npx -y supabase@latest secrets set ...` command from 5b (and, if you rotate the
webhook secret, re-run the matching `vault.create_secret` — actually
`select vault.update_secret((select id from vault.secrets where name =
'admin_signup_webhook_secret'), 'the-new-secret-value');` — the two must
always match).

## Testing checklist

- [ ] Sign in as a non-admin account and confirm `admin.html` shows "Access
      denied," not the user table.
- [ ] Sign in as your promoted admin account and confirm the user table
      loads with real accounts (not a placeholder/mock list).
- [ ] Disable one test account, then sign in as that account elsewhere (or
      try to) and confirm sign-in is actually blocked.
- [ ] Re-enable the same account and confirm sign-in works again.
- [ ] Delete a genuinely disposable test account and confirm it disappears
      from both the Admin Module's list and Supabase's own Authentication →
      Users page, and that its `alerts` rows are gone too (check the
      `alerts` table directly, or that its earlier saved alerts no longer
      show up anywhere).
- [ ] Confirm the "Recent admin activity" log shows a row for each of the
      above.
- [ ] (If Step 5 is set up) Sign up a disposable test account and confirm
      the configured admin contact(s) receive a new-signup email and/or
      Telegram message within a few seconds.

## Troubleshooting

**"Not authorized. Super User role required." even after Step 3.** Sign out
and sign back in on the main dashboard first — `admin.js` reads your role
once at page load from the same session token the Edge Function then
independently re-verifies; a stale cached session from before you ran the
`update` statement won't reflect the change until you get a fresh one.

**A CORS error in the browser console when the Admin Module tries to load
users.** `ALLOWED_ORIGIN` (Step 2) doesn't match the origin you're actually
loading `admin.html` from — check the exact scheme+host you're using (e.g.
`https://` vs `http://`, or a custom domain if you've set one up) and
re-deploy the secret + function.

**"Server misconfigured — missing Supabase secrets."** This means
`SUPABASE_URL` or `SERVICE_ROLE_KEY` weren't available at runtime. Check
`npx -y supabase@latest secrets list` against the project ref you linked in Step 2 — if
`SERVICE_ROLE_KEY` isn't listed, the `supabase secrets set SERVICE_ROLE_KEY=...`
command in Step 2 either wasn't run or was run against a different linked
project than the one `admin.html` is pointed at
(`frontend/supabaseConfig.js`'s URL).

**(Step 5) No email/Telegram arrives after a test signup.** Check, in order:
1. Supabase Dashboard → Edge Functions → `notify-admin-signup` → Logs — every
   attempt logs a `notify-admin-signup: {...}` line with per-channel
   `delivered`/`error` detail, including "skipped, not attempted" if a
   secret from Step 5b is missing.
2. Supabase Dashboard → Logs → Postgres Logs — search for
   `notify_admin_of_new_signup failed`. This means the trigger fired but
   couldn't call the function at all (most often: the two `vault.create_secret`
   calls from Step 5c were never run, or the pg_net extension isn't enabled).
3. If neither log shows anything at all, the trigger itself likely isn't
   installed — re-run `database/schema.sql`'s Phase 51 block (or the whole
   file) in the SQL Editor.
4. A `401` in the function's own logs means the `SIGNUP_WEBHOOK_SECRET`
   secret (5b) and the `admin_signup_webhook_secret` Vault value (5c) don't
   match exactly — they must be the identical string.

**`supabase : The term 'supabase' is not recognized as the name of a
cmdlet...`** The CLI isn't (successfully) installed as a global command on
this machine — very common on Windows, and the reason every command in
Steps 2 and 5 above is written as `npx -y supabase@latest ...` rather than
bare `supabase ...`. Just add that same `npx -y supabase@latest` prefix to
whichever command failed and re-run it — no install step needed. (The very
first `npx` run of a session takes a few extra seconds while it fetches the
package; that's expected, not a hang.)

## Security notes

- The Edge Function re-verifies the caller's `profiles.role` on **every**
  request using the service-role client — the client-side check in
  `admin.js` (which decides whether to show the panel at all) is UX only
  and is never trusted as the actual authorization boundary.
- `admin_actions` (the audit log) is only ever written by the Edge Function's
  service-role client; there is no RLS policy letting the `authenticated`
  role insert into it directly, so a signed-in user — even an admin — cannot
  forge a log entry through the anon-key client.
- Promoting an account to admin is intentionally a manual SQL statement, not
  a UI action anywhere in this app, so it always leaves a deliberate, visible
  trail in whoever ran it, rather than being one more button to click.
- (Step 5) `notify-admin-signup` is deployed with `--no-verify-jwt` since it's
  called by Postgres, not a signed-in browser — its `X-Signup-Webhook-Secret`
  header check is a much lighter authorization boundary than admin-users'
  `profiles.role` re-check, but the function never reads or writes user data
  and never returns anything sensitive in its response, so the worst a
  bypass could do is trigger a fake notification, not a data or account
  compromise.
