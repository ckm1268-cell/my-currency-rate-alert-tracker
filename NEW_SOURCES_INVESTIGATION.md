> **Status update (Phase 52, 02-Sep-2026):** Wawasan Ilham is now fully
> wired into production too — the 5th real source. Its live rate table
> needs a branch selected first (confirmed via a real live check on
> 01-Sep-2026, `checkRate.js wawasanilham CNY`, `LIVE`/`PASSED`, and
> independently cross-checked against the user's own screenshots of the
> live site), so it ships with branch selection using the same concept as
> Taj Muhabath, per the user's request. Jalinan Duta also gained branch
> selection (Bukit Bintang / Masjid India / Nu Sentral — confirmed via
> `WebFetch` to have genuinely different rates), though its adapter's
> parsing logic against real per-branch HTML is still unconfirmed by a
> live run — see `config/websites/jalinanduta.json`'s `branchNotes` for
> exactly what is/isn't verified and the command to run once real network
> access is available. **Update, same day:** the project owner ran that
> exact command from their own machine for all 3 branches — masjid-india, nu-sentral, and bukit-bintang — every one returned `LIVE`/`PASSED` with plausible, branch-differentiated CNY numbers. Branch selection for Jalinan Duta is now fully confirmed live, not just plausible. My Money Master and Merchantrade Asia's own live
> pages each publish one site-wide rate with no branch selector, so no
> branch UI was added for either. Supporting more than one branch-aware
> source on the same alert required a schema change — each alert now
> stores a `branches` map (one branch choice per source) instead of a
> single shared value — see `database/schema.sql`'s Phase 52 migration
> block, which must be run in the Supabase SQL Editor **before** this
> commit is deployed (the frontend will send a `branches` field the old
> schema doesn't have).

> **Status update (v1.0.0, 26-Aug-2026):** Jalinan Duta's live check
> (`node backend/scripts/checkRate.js jalinanduta CNY`) has since been run
> and confirmed `LIVE`. It is now fully wired into production — the 4th
> real source alongside My Money Master, Taj Muhabath, and Merchantrade
> Asia, registered in `backend/scheduler/run.js`'s `ADAPTERS`,
> `frontend/app.js`'s `SOURCES`/`CODE_MATCHED_SOURCES`,
> `frontend/index.html`'s money-changer checkboxes, and both GitHub Actions
> workflows (including the recurring schedule). The rest of this document
> is kept as-is below as the original investigation record — Wawasan Ilham,
> Jags Money, and KL Remit Exchange remain not built, for the reasons
> given.

# New money-changer sources — investigation (24-Aug-2026)

Requested: add 4 money changers for comparison, given as URLs on
`klmoneyexchange.com`:

- `klmoneyexchange.com/money-changers/wawasan-ilham`
- `klmoneyexchange.com/ms/money-changers/kl-remit-exchange`
- `klmoneyexchange.com/ms/money-changers/jags-money`
- `klmoneyexchange.com/ms/money-changers/jalinan-duta`

## The blocking issue with the URLs as given

`klmoneyexchange.com` is a **third-party rate-comparison/directory site**
("Compare live exchange rates from 7 KL money changers... Updated every 15
minutes"), not any of these 4 businesses' own website. Sibling sites in the
same family (`klxchange.com`, `klmoneychanger.com`) carry explicit
disclaimers: *"We do not represent, affiliated nor associated with any of
the money changers listed here"* and *"we do not guarantee the accuracy of
the content."*

Building an adapter against that aggregator and labeling its output "X's
live rate" would directly violate two rules already written into this
project's own brief — the same ones every existing adapter here was built
to follow:

> *"Do NOT rely on: ... Third-party exchange-rate summaries"*
> *"Never silently substitute an alternative source and label it as the
> original money changer's live rate."*

So instead, each of the 4 businesses' **own official domain** was
investigated as a compliant equivalent to how My Money Master, Taj
Muhabath, and Merchantrade Asia are already handled.

## Per-source outcome

### ✅ Jalinan Duta — added, parked pending live verification
`jalinanduta.com` is a real official site whose homepage embeds a real,
plausible, internally-consistent 44-row currency rate table (Flag / Code /
Currency / Unit / We Sell / We Buy), observed directly on 24-Aug-2026.
Added:
- `config/websites/jalinanduta.json`
- `backend/scrapers/jalinanduta.adapter.js`
- `tests/jalinanduta.adapter.test.js` (passing — see below)

**Not yet wired into production** (not in `backend/scheduler/run.js`'s
`ADAPTERS` map, `frontend/app.js`'s `REAL_ADAPTER_SUPPORT`,
`.github/workflows/pages.yml`, `.github/workflows/monitor.yml`, or
`frontend/index.html`'s money-changer checkboxes). See "What's actually
confirmed" below for why, and "Next step" for exactly what unblocks this.

### 🟡 Wawasan Ilham — real candidate, not built (see why)
`wawasanilham.com` is a real official site with a genuine dynamic,
branch-selectable "Rateboard" widget (branches: NSK Trade City/Kuchai Lama,
Chow Kit, Seri Kembangan, Bandar Puteri, Melawati Mall) — a legitimate
first-party equivalent to Taj Muhabath's branch-select pattern.

**No adapter was written for this one.** The rate table is empty until a
branch is selected via client-side JavaScript, and the only visibility
available in this session was a markdown-converted text extraction of the
page — which shows the *label text* ("Select branch to load Rateboard")
but strips every HTML attribute, so there is no `<select>` element id/name,
no table id/class, nothing a Playwright script could actually target.
Writing selector code against zero real attributes would be pure guessing —
a materially different, worse risk than Jalinan Duta's approach (which
only needed to match visible header *text*, not element attributes).
Shipping guessed selectors here would be exactly the kind of "silently
substitute and hope" behavior this project's Core Principle exists to
prevent.

### ❌ Jags Money — excluded
`jagsmoney.com`'s own "Daily Rates" page literally reads **"Coming Soon"**
with an empty rate table (headers only, zero data rows), as of 24-Aug-2026
— years after the page's `article:modified_time` (2021), suggesting it was
never finished. The page's footer also links to `imunify-bot-check`, an
active bot-detection/WAF plugin — this project's compliance rules
explicitly say not to bypass anti-bot mechanisms. No compliant source
exists for this business today.

### ❌ KL Remit Exchange — excluded
No standalone official website with its own rate-publishing page was
found at all — only shopping-mall tenant-directory pages (Pavilion KL, Mid
Valley), social media, and third-party comparison-site listings (all of
which fail the same aggregator test above). Nothing to build against.

## What's actually confirmed vs not, for Jalinan Duta

Every existing adapter in this repo (My Money Master, Taj Muhabath,
Merchantrade Asia) was verified using a **real live browser automation
tool** (`mcp__claude-in-chrome` per those configs' own notes) — actually
navigating the page and inspecting the rendered DOM, in Merchantrade
Asia's case even running `fetch(location.href)` from inside the loaded
page to grep the raw response. That tool was **not available** in the
session that investigated these 4 new sources; only web search and a
markdown-converting fetch tool were. Merchantrade Asia's own config
explicitly warns this kind of fetch *"cannot see real DOM structure or
confirm JS-rendering, which is exactly why [live browser verification]
was needed"* — so the same bar is applied here, honestly, rather than
quietly lowered.

What that means concretely for `jalinanduta.adapter.js`:
- **Confirmed**: the rate data is real, plausible, and reachable — a
  44-row table with internally consistent numbers for USD, CNY, VND, and
  40+ others.
- **Confirmed**: the parsing *logic* is correct against a fixture built
  from that real data (`tests/jalinanduta.adapter.test.js` — passing).
- **NOT confirmed**: the real page's exact HTML (tag names, table
  id/class). The adapter deliberately avoids hardcoding any CSS selector
  for this reason — it discovers the rate table by reading its own header
  row's text ("Code" / "We Sell" / "We Buy") rather than a fixed
  selector — but this has never been run against the live site.

## Next step to actually enable Jalinan Duta

From an environment with real network access (not this sandbox):

```bash
node backend/scripts/checkRate.js jalinanduta CNY
```

If that returns `status: "LIVE"` with a plausible CNY value (cross-check
against jalinanduta.com open in a browser at the same moment), Jalinan
Duta is ready to be wired into the same 5 places the other 3 sources are:
`backend/scheduler/run.js`'s `ADAPTERS`/`SOURCE_DISPLAY_NAMES`,
`frontend/app.js`'s `SOURCES`/`REAL_ADAPTER_SUPPORT`,
`frontend/index.html`'s money-changer checkbox list,
`.github/workflows/pages.yml`'s `checkRate.js` step, and — only once that's
been running cleanly for a while, matching how Merchantrade Asia was
brought online in Phase 14 — `.github/workflows/monitor.yml`'s recurring
schedule. Ask me to do this wiring once you've confirmed the check works;
it's a small, fast change once the adapter itself is proven.

If it instead returns `EXTRACTION_ERROR`, that's the system correctly
reporting "source structure may have changed" (project brief section 23)
— inspect the real page's HTML at that point and I can adjust
`discoverRateTable()`/`classifyHeaderCell()` in the adapter with the real
selectors once someone can see them.
