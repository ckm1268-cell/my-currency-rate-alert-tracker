# Notifications setup — Phase 10 (email + Telegram)

This walks you through getting real email and Telegram alerts working.
Nobody else can do this for you — creating a Resend account and a Telegram
bot both happen in your own browser/app, under your own credentials.
Everything else (the code that sends the message, the database columns, the
GitHub Actions wiring) is already written and waiting for your two secrets.

Budget about 10 minutes for both. You don't need to do both — pick whichever
channel(s) you actually want; the notification checkboxes on the dashboard
let each saved alert choose any combination independently, and (as of
Phase 11) deliver to every checked channel at once when the alert
triggers — check both Email and Telegram and you'll get both messages, not
just whichever one is checked "first."

## Before you start: these are real credentials

The API key and bot token below both grant real send access — anyone who
has them can send email/Telegram messages as your account. Treat them like
a password:

- Never paste them into the frontend code, a GitHub commit, or anywhere
  public. The only place they belong is as **GitHub Actions repository
  secrets** (step 3 below) — the same pattern already used for
  `SUPABASE_SERVICE_ROLE_KEY` in Phase 8.
- If a value is ever accidentally exposed (committed, pasted somewhere
  public, shared in a chat), regenerate it — Resend lets you delete and
  recreate a key from the dashboard; Telegram's BotFather can reissue a
  token with `/revoke`.

## 1. Email — via Resend

1. Sign up for a free account at [resend.com](https://resend.com) — no
   credit card needed for the free tier.
2. In the dashboard, go to **API Keys** (left sidebar), then **Create API
   Key**.
3. Name it (e.g. `currency-rate-tracker`), set **Permissions** to **Full
   access** (or **Sending access** — that's all this app needs), and pick a
   domain — you can leave this on Resend's shared domain for now.
4. Click **Add**. The key (starts with `re_...`) is shown once — copy it
   immediately.

That's enough to send real email right away, from Resend's own test sender
(`onboarding@resend.dev`) — good enough to prove delivery works, just not
branded as your own domain. To send from your own address later (e.g.
`alerts@yourdomain.com`), verify a domain you own under **Domains** in the
Resend dashboard, then set `NOTIFY_EMAIL_FROM` as an additional GitHub
Actions secret (step 3) — no code change needed, `backend/notifications/
email.js` already reads that as an optional override.

Recipients: this app never asks for a separate "notification email" — it
uses the same email address you signed in with (Supabase Auth), read
server-side via the Auth admin API. If you want alerts to go to a different
address than the one you sign in with, sign in with that address instead.

## 2. Telegram — via BotFather

1. Open Telegram (app or web) and start a chat with
   **[@BotFather](https://t.me/botfather)** — Telegram's own official bot
   for creating bots.
2. Send `/newbot`.
3. Enter a display name for your bot (shown in contact details — can be
   anything).
4. Enter a username: 5-32 characters, Latin letters/numbers/underscores
   only, and it **must end in "bot"** (e.g. `ckm_rate_alert_bot`). This
   can't be changed later.
5. BotFather replies immediately with your bot's token — a string like
   `123456789:AAH...`. Copy it.

### Connecting Telegram to a specific alert

Each saved alert that uses Telegram needs its own destination **chat ID** —
this app is multi-user, so there's no single global recipient, only
per-alert ones (see `alerts.telegram_chat_id` in `database/schema.sql`).

1. In Telegram, search for your bot by the username you chose above, open a
   chat with it, and send it any message (e.g. `/start`). This step matters:
   Telegram bots can only message chats that have messaged them first.
2. In a browser, visit:
   `https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates`
   (replace `<YOUR_BOT_TOKEN>` with the token from step 5 above — this is a
   read-only request you're making yourself, not something sent anywhere
   public).
3. In the JSON response, find `"chat":{"id":`, followed by a number — that
   number is your chat ID.
4. On the dashboard, check **Telegram** under Notification (you can leave
   Email and/or Browser checked too — they'll all fire together) and
   paste that number into the **Telegram chat ID** field before saving the
   alert.

If step 2 returns an empty `"result":[]`, double check you actually sent
the bot a message in step 1 — Telegram only remembers updates from the last
24 hours (or since the last time your bot's server checked for updates),
so send a fresh message and try again.

## 3. Add both as GitHub Actions secrets

1. In your GitHub repo, go to **Settings → Secrets and variables →
   Actions → New repository secret**.
2. Add `RESEND_API_KEY` with the value from step 1 (skip if you're only
   using Telegram).
3. Add `TELEGRAM_BOT_TOKEN` with the value from step 2 (skip if you're only
   using email).
4. Optional: add `NOTIFY_EMAIL_FROM` if you've verified your own domain in
   Resend and want to send from it instead of the shared test address.

These join `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, already added in
Phase 8 — `.github/workflows/monitor.yml` reads all four (well, five with
the optional one) as environment variables for the scheduled job.

## 4. Test it

1. On the dashboard, sign in (or create an account — see
   `SUPABASE_SETUP.md` if you haven't already), build an alert with a
   target rate at or above the current live rate (so it triggers
   immediately), select **Email** or **Telegram** as the notification
   method, fill in the Telegram chat ID if applicable, and click **Save
   current alert to my account**.
2. In GitHub, go to the **Actions** tab → **Monitor Exchange Rates** →
   **Run workflow**.
3. Once it finishes (usually well under a minute), check your inbox /
   Telegram chat for the alert.
4. Also worth checking directly in Supabase's **Table Editor** →
   `notifications`: the row for this alert should show
   `delivery_status = 'DELIVERED'`. If it shows `'FAILED'` instead, the
   `delivery_error` column on that same row has the reason (a missing/
   invalid API key, no email on the account, an invalid chat ID, etc.) —
   the Actions run log (`node scheduler/run.js`'s own console output) shows
   the same message.

## Troubleshooting

### `delivery_error` says: `Resend API error (HTTP 403): You can only send testing emails to your own email address...`

Also seen in real testing (22-Aug-2026) — this is Resend's own sandbox
restriction, not a bug here. Until you verify a domain you own in Resend,
their free tier only allows sending to the email address that created the
Resend account, regardless of which of this app's users the alert belongs
to. Two ways to handle it:

- **To just confirm email delivery works:** sign in to this app with the
  same email address that owns your Resend account, and test with an alert
  saved under that account. No changes needed — it'll send immediately.
- **To let email work for every account (the real fix):** in Resend,
  go to **Domains** → **Add Domain**, add the DNS records Resend gives you
  for a domain you own, wait for it to verify, then add `NOTIFY_EMAIL_FROM`
  as one more GitHub Actions secret set to an address on that domain (e.g.
  `alerts@yourdomain.com`). `backend/notifications/email.js` already reads
  this as an optional override — no code change needed once it's set.

### `delivery_error` says: `Telegram API error: Bad Request: chat not found`

This is the Telegram Bot API's way of saying "I don't have permission to
message this chat ID" — seen in real testing (22-Aug-2026), and it's almost
always one of two causes, not a bug in this app:

1. **You haven't messaged the bot yet (or messaged a different one).**
   Telegram bots can only send a message to a chat that has messaged *them*
   first — this is a platform-level restriction, not something this app can
   work around. Open a chat with the exact bot username you created via
   BotFather and send it anything (`/start` is fine), then re-fetch
   `getUpdates` and re-copy the chat ID.
2. **A typo, or a stale/wrong ID pasted into the alert.** Re-copy the number
   after `"chat":{"id":` carefully — no extra digits, no surrounding quotes.

To fix an alert that already saved a bad chat ID: the dashboard doesn't
have an in-place edit for this yet, so the fastest fix is directly in
Supabase's **Table Editor** → `alerts` table → find the row → edit
`telegram_chat_id` to the correct value → save. If the alert's `status` is
now `TRIGGERED` (a real target hit, correctly detected, just undeliverable),
also reset it to `ACTIVE` in the same place — or on the dashboard, click
**Disable** then **Enable** on that alert — before re-running the workflow.

### `delivery_error` says something about a missing API key

`RESEND_API_KEY` or `TELEGRAM_BOT_TOKEN` isn't set as a GitHub Actions
secret yet, or the secret name has a typo — see step 3 above. Secret names
are case-sensitive and must match exactly.

## What this does and doesn't do yet

- **Real:** email via Resend and Telegram via the Bot API are both actually
  called by `backend/scheduler/run.js` the moment a saved alert's target is
  reached — see `backend/notifications/notify.js`. Delivery outcome
  (`DELIVERED`/`FAILED`, with a reason) is recorded honestly, not assumed.
- **Not yet:** a recurring schedule. Like Phase 8's rate checks, this only
  runs when someone manually clicks "Run workflow" in the Actions tab — see
  the Compliance note in `README.md` for why (the Terms of Use review for
  both money-changer sites is still outstanding, and that's what gates
  turning on `monitor.yml`'s `schedule:` block).
- **Not yet:** WhatsApp/SMS (project brief's optional Phase 3 channels) —
  genuinely unimplemented, not just unconfigured.
