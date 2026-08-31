# Installing the app on Android and iOS (free — no app store)

**Added:** 28 August 2026. This turns the exact same live app — same
Supabase data, same adapters, same scheduler, same notifications — into
something that installs to a phone's home screen and opens full-screen
like a native app, at zero cost and with no app-store account, review, or
fee. This is a **Progressive Web App (PWA)**, not a separate codebase: it
is the same `frontend/` you already have, plus a manifest, some icons,
and a service worker.

## Why a PWA instead of a native Android/iOS app

You asked for the mobile version to be free. A real native app listed on
the Play Store or App Store needs a Google Play developer account (US$25
one-time) and an Apple Developer account (US$99/year), plus — for iOS
specifically — a Mac running Xcode to actually produce the build. A PWA
needs none of that: it installs directly from the browser, updates itself
automatically the next time it's opened online (same deploy pipeline you
already have via GitHub Pages), and behaves like an installed app once
added — its own icon, its own window with no browser address bar, and
(on Android) real push notifications even when it isn't open.

If you ever do want a Play Store / App Store listing later, this PWA can
be wrapped with a tool like Capacitor to produce real `.apk`/`.ipa`
files without rewriting the frontend — but that's a separate, paid step
(the developer accounts above), not something needed for what you asked
for now.

## What was added, and why each piece exists

| File | Purpose |
|---|---|
| `frontend/manifest.json` | The Web App Manifest — name, icons, colors, and `display: standalone` (this is what tells Android/Chrome "this is installable" and controls how the installed icon/splash screen look). |
| `frontend/assets/icons/icon-192.png`, `icon-512.png`, `apple-touch-icon.png` | The app icon, generated in your existing gold/navy brand palette (a stylized exchange-arrows glyph), at the sizes each platform expects. |
| `frontend/favicon.ico`, `favicon-32.png`, `favicon-16.png` | Browser-tab icon — unrelated to installability, added for polish while the icon set was being built anyway. |
| `frontend/installPrompt.js` | Shows an **"📲 Install App"** button on Android/Chrome/Edge (real browsers fire a `beforeinstallprompt` event this script captures), and a plain-text **"tap Share → Add to Home Screen"** banner on iOS Safari, which has no install button API at all — Apple only ever supports the manual Share-sheet flow. |
| `frontend/sw.js` (extended) | Already existed for Web Push (Phase 39) — extended to also cache the app's own static shell (HTML/CSS/JS/icons) so the installed app opens instantly and Android considers it installable. **Deliberately never caches Supabase requests, fonts, or any other live/cross-origin data** — see the file's own header comment. This is the one part of this change that touches "how the app behaves," so it's worth your own read of the comment block if you want to verify it yourself. |
| `frontend/index.html` (edited) | Links the manifest, adds the iOS-specific meta tags Apple requires (`apple-mobile-web-app-capable`, etc.), and adds the install button/banner markup. |
| `frontend/styles.css` (edited) | Styling for the new button/banner, reusing your existing color tokens — no new visual language introduced. |

## Installing it — Android

1. Open the live site in Chrome (or Edge/Samsung Internet):
   `https://app.mycurrencyalerts.abrdns.com/`
2. Either tap the **"📲 Install App"** button that now appears in the top
   bar, or use the browser's own menu → **Add to Home screen** / **Install app**.
3. Confirm. The app icon appears on the home screen and opens full-screen,
   with no browser address bar.

## Installing it — iPhone/iPad (Safari)

iOS has no install button API — Apple only supports this one manual flow,
which is why the app shows a banner explaining it rather than a button:

1. Open the live site in **Safari** (this does not work in Chrome on
   iOS — Apple requires Safari specifically for this).
2. Tap the **Share** icon (the square with an arrow, in the toolbar).
3. Scroll down and tap **Add to Home Screen**.
4. Tap **Add**. The app icon appears on the home screen.

## Push notifications on the installed app

Android: push works the same as it already did in the browser (see
`PUSH_SETUP.md`) — no change needed.

**iOS has one important extra requirement:** Apple only allows Web Push
for a site that has actually been **added to the home screen** first —
opening the site in a normal Safari tab and enabling Push there will not
work on iOS, even though the checkbox is visible. If an iPhone user wants
Push specifically (as opposed to Email or Telegram, which work
regardless), tell them to install it via the steps above first, then open
the installed app (not the Safari tab) and enable Push from there. This
is an Apple platform restriction, not a bug in this app.

## Verifying it's actually working (a PWA audit, not just "it looks right")

1. Open the deployed site in Chrome on desktop, open DevTools → **Application** tab → **Manifest**. It should show the name, icons, and `display: standalone` with no errors listed.
2. Same tab → **Service Workers** — should show `sw.js` as activated and running.
3. Run a **Lighthouse** audit (DevTools → Lighthouse → check "Progressive Web App" → Analyze). It should report the app as installable.
4. The real test: install it on an actual Android phone and an actual iPhone using the steps above, confirm the icon/splash screen look right, and confirm a live rate still shows **🟢 LIVE** (not a stale cached number) when opened with a normal connection — the service worker is deliberately built to never cache rate data, so this should always match what the website shows at the same moment.

## What this does *not* change

- No new backend, no new hosting, no new account of any kind.
- The live-data guarantee (project brief's core rule — never show cached
  data labeled as LIVE) is unchanged; the service worker is explicitly
  scoped to never touch Supabase requests.
- Desktop/browser use is completely unaffected — nothing here requires
  installing the app; the install button/banner is purely additive.

## Not yet done

1. **Deploy and test on a real device.** Everything above was built and
   syntax/JSON-validated, but has not yet been installed on a real
   Android phone or iPhone from the live deployed URL — do that once this
   is pushed and GitHub Pages has redeployed, and report back if the
   install prompt or icon don't look right.
2. **Optional native wrapper (Capacitor) for real Play Store/App Store
   listings** — not built, since it requires paid developer accounts you
   didn't ask for yet. Worth revisiting if you later want the app
   discoverable by searching the stores rather than by opening a link.
