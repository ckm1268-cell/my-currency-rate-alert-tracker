# Supabase setup (Phase 7)

This walks you through provisioning Supabase from scratch and wiring it into
the app. Nobody else can do this step for you — creating an account and a
project is something only you can do in your own browser. Everything else
(the schema, the code, the RLS policies) is already written and waiting for
your project's URL and keys.

Budget about 10 minutes.

## 1. Create a Supabase account and project

1. Go to https://supabase.com and sign up (free tier is enough for this app).
2. Click **New project**.
3. Pick an organization (or create one), give the project a name (e.g.
   `my-currency-rate-tracker`), set a database password (save it somewhere —
   you won't need it for this app, but Supabase requires one), and pick a
   region close to you.
4. Wait for the project to finish provisioning (a minute or two).

## 2. Run the schema

1. In your new project's dashboard, open **SQL Editor** (left sidebar) →
   **New query**.
2. Open `database/schema.sql` from this repo, copy the *entire* file, and
   paste it into the query editor.
3. Click **Run**. You should see "Success. No rows returned."
4. Optional sanity check: open **Table Editor** (left sidebar) — you should
   now see three tables: `alerts`, `rates`, `notifications`. Click into
   `alerts` → **RLS** (top right) should show "Enabled" with 4 policies.

If this step fails partway through, it's safe to re-run the whole file —
every statement in it is written to be repeatable (`create table if not
exists`, `drop policy if exists` before each `create policy`, etc.).

## 3. Turn on email + password sign-in

Supabase's email auth is on by default, but double-check:

1. **Authentication** (left sidebar) → **Providers** → confirm **Email** is
   enabled.
2. Same **Email** provider settings — decide on **Confirm email**:
   - **ON (default)**: after someone signs up, Supabase emails them a
     confirmation link and they can't log in until they click it. This is
     the safer default for a publicly reachable app (stops someone signing
     up with an email address that isn't theirs).
     - **OFF**: signUp() immediately returns a live session — a new
       account can use the app right away, no email round trip. Simpler for
       testing, but means an unverified email can create an account.
   Either setting works with the app as built — `frontend/auth.js` handles
   both cases (it shows "check your inbox" only when Supabase says
   confirmation is required).
3. **Authentication** → **URL Configuration** → set **Site URL** to the app's
   custom domain (added 31-Aug-2026 to hide the raw GitHub Pages URL from
   users):
   `https://app.mycurrencyalerts.abrdns.com/`
   This is where Supabase redirects a user back to after they click a
   confirmation or password-reset link in their email — if this is wrong,
   that link will silently send them to the wrong page (or Supabase's own
   default page).
4. On the same **URL Configuration** page, add BOTH of the following under
   **Redirect URLs** (some Supabase project defaults require the exact URL to
   also be allow-listed there, not just set as the Site URL — and the app's
   own `frontend/auth.js` computes its redirect dynamically from whichever
   origin the user is actually on, so both need to be allow-listed for sign-in
   to work correctly no matter which URL a user opens the app from):
   - `https://app.mycurrencyalerts.abrdns.com/`
   - `https://ckm1268-cell.github.io/my-currency-rate-alert-tracker/`
   **This is a Supabase Dashboard setting, not something in this repo — it
   must be updated by hand in the Supabase project itself, and code changes
   alone cannot fix it.**

You don't need to touch the email templates for this to work — Supabase's
default confirmation and password-reset emails are fine to start with.

**Why email + password instead of a login table stored in this repo:** a
public GitHub repo has no real access control — anyone can read any
committed file — so a users/passwords table checked into the repo would be
readable by the entire internet, which defeats the point of having a
password and directly contradicts this project's own "never expose
credentials" rule. Supabase Auth stores every password hashed, behind its
own access controls, in a database this app's frontend code never directly
touches — that's the whole reason to use it instead of hand-rolling
authentication.

## 4. Get your keys

**Project Settings** (gear icon, bottom of left sidebar) → **API**:

- **Project URL** — looks like `https://abcdefghijklmnop.supabase.co`
- **Project API keys** → **anon** / **public** — a long string starting
  with `eyJ...`
- **Project API keys** → **service_role** — a *different* long string,
  also starting with `eyJ...`. This one is powerful (it bypasses every RLS
  policy) — treat it like a password. Never paste it into `frontend/` code
  or commit it anywhere.

## 5. Wire the anon key into the frontend (safe to commit)

Open `frontend/supabaseConfig.js` and replace the two placeholder values:

```js
window.CKM_SUPABASE_URL = "https://abcdefghijklmnop.supabase.co";
window.CKM_SUPABASE_ANON_KEY = "eyJ...(your anon key)...";
```

This file gets committed and deployed with the rest of the frontend — that's
intentional and safe. The anon key alone can't read or write anything it
shouldn't; the Row-Level Security policies from `database/schema.sql` are
what actually decide what each signed-in user can see and touch.

## 6. Wire the service-role key into GitHub Actions (secret — Phase 8, do this later)

You don't need this yet for Phase 7 (sign-in and per-user saved alerts work
without it). It becomes necessary once Phase 8 builds the scheduled backend
job that writes real rate rows and evaluates every user's alert server-side.
When that day comes:

1. On GitHub: your repo → **Settings** → **Secrets and variables** →
   **Actions** → **New repository secret**.
2. Add `SUPABASE_URL` (same value as above) and `SUPABASE_SERVICE_ROLE_KEY`
   (the service-role key from step 4).
3. Never put either of these in a workflow file's `run:` script as literal
   text, or in any file under `frontend/` — reference them as
   `${{ secrets.SUPABASE_URL }}` / `${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}`
   inside the workflow YAML's `env:` block instead.

## 7. Deploy and test

1. Commit and push `frontend/supabaseConfig.js` with your real values (steps
   5 above) the same way you've pushed every other change this project —
   `git add`, `git commit`, `git push`.
2. Once GitHub Pages redeploys, open the live site. The new **"Your
   account · Phase 7"** card near the top should show **Log in** / **Sign
   up** tabs instead of the "Supabase isn't configured yet" notice.
3. Click the **Sign up** tab, enter your own email and a password (at
   least 6 characters), and click **Create account**. Depending on your
   **Confirm email** setting from step 3 above, either you'll be signed in
   immediately, or you'll need to check your inbox and click a
   confirmation link first, then come back and log in with that email and
   password.
4. Build an alert in the panel on the left, then click **💾 Save current
   alert to my account** in the account card. It should appear under **My
   saved alerts** immediately.
5. To confirm isolation actually works (not just "looks right in the UI"):
   sign out, sign up with a *second*, different email address (a second
   inbox you control, or a "+alias" like `you+test@gmail.com` if your
   provider supports it), and confirm the alert from step 4 is **not**
   visible under this second account. Then check Supabase's **Table
   Editor** → `alerts` directly — you should see both rows, each with a
   different `user_id`, which is what the RLS policies are keying off of.
6. Optional — test "Forgot password?": sign out, click **Forgot
   password?** on the Log in tab with your first account's email in the
   field, check your inbox, click the reset link, and set a new password
   on the page it brings you back to. Then log in with the new password to
   confirm it actually took.

If step 5 ever shows one account's alerts to another account, something is
wrong with the RLS policies (most likely: `database/schema.sql` wasn't run
in full, or was run against a different project than the one your
`supabaseConfig.js` points at) — stop and fix that before relying on this
for real use, since per-user isolation is a hard requirement of the project,
not a nice-to-have.

## What this does and doesn't do yet

**Works now (Phase 7):**
- Sign up / log in / sign out with your own email address and password —
  your account IS that email + password, no separate username, and no
  credentials ever stored in this repo (see the "why email + password"
  note above).
- "Forgot password?" — request a reset link by email and set a new one.
- Save the currently-configured alert to your account.
- See, disable/re-enable, and delete your own saved alerts.
- Per-user isolation, enforced by the database (Row-Level Security), not
  just hidden in the UI.
- If a saved alert's condition is met while *you have that same browser tab
  open and monitoring*, the dashboard logs it to your account (status
  flips to `TRIGGERED`, a row is added to `notifications`) — on top of the
  toast/log/browser-notification behavior that already worked before
  Phase 7.

**Not yet (Phase 8+):**
- A saved alert is **not** checked in the background — closing the tab (or
  never opening it with the exact matching form state) means it just sits
  there as `ACTIVE` even if the real rate crosses the target. That
  requires Phase 8's scheduled backend job (using
  `backend/db/supabaseClient.js`, already implemented and ready) to
  actually fetch rates, write them to the `rates` table, and evaluate every
  active alert server-side using `backend/targetEngine/compareTarget.js`
  (already implemented since Phase 5).
- Email/Telegram/WhatsApp notifications — Phase 10, and depends on Phase 8
  existing first (a server-side job is what would actually send them).
