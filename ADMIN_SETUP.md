# Admin Module setup (Phase 45 / v3)

This is the setup guide for the **Admin Module**: a page (`admin.html`) where a
**Super User** can bulk-disable, bulk-re-enable, and bulk-delete other users'
accounts. It follows the same "what's real, what needs your action" style as
`SUPABASE_SETUP.md`, `NOTIFICATIONS_SETUP.md`, `PUSH_SETUP.md`, and
`MOBILE_APP_SETUP.md` — read those first if you haven't set this app up at
all yet.

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

You'll need the [Supabase CLI](https://supabase.com/docs/guides/cli) (`npm
install -g supabase`, or see that page for other install methods) and to be
logged in (`supabase login`).

From the repo root:

```bash
# Link this local checkout to your Supabase project (one-time; find your
# project ref in the Supabase Dashboard's Project Settings > General page)
supabase link --project-ref YOUR-PROJECT-REF

# Set the two secrets the function needs. SUPABASE_URL is provided
# automatically by the Edge Functions runtime for every project — you only
# need to set these two yourself. Note the secret name is SERVICE_ROLE_KEY,
# not SUPABASE_SERVICE_ROLE_KEY — the CLI rejects any custom secret name
# starting with SUPABASE_, since that whole prefix is reserved for the
# platform's own auto-injected values:
supabase secrets set SERVICE_ROLE_KEY=your-secret-api-key
supabase secrets set ALLOWED_ORIGIN=https://your-username.github.io

# Deploy
supabase functions deploy admin-users
```

`SERVICE_ROLE_KEY` should be your project's current `sb_secret_...` key from
Project Settings → API Keys → "Publishable and secret API keys" tab (click
the eye icon to reveal it) — this is the modern replacement for the legacy
JWT-based `service_role` key, and it's the same value you should also be
using for the `SUPABASE_SERVICE_ROLE_KEY` GitHub Actions secret that the
scheduler uses. `ALLOWED_ORIGIN` should be your actual deployed GitHub Pages
origin (no trailing path) — this restricts which website is allowed to call
the function via CORS; it defaults to `https://ckm1268-cell.github.io` if
you don't set it, which is only correct if you haven't forked/renamed this
repo.

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
`supabase secrets list` against the project ref you linked in Step 2 — if
`SERVICE_ROLE_KEY` isn't listed, the `supabase secrets set SERVICE_ROLE_KEY=...`
command in Step 2 either wasn't run or was run against a different linked
project than the one `admin.html` is pointed at
(`frontend/supabaseConfig.js`'s URL).

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
