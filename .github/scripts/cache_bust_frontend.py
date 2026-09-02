#!/usr/bin/env python3
"""Cache-bust local <script src>/<link href> URLs in frontend/*.html.

Phase 52 follow-up (02-Sep-2026). Real production incident: this repo's
custom domain served a stale cached app.js (still referencing the
pre-Phase-52 single-branch <select id="branch"> markup) alongside a freshly
deployed index.html (which had already dropped that element in favour of
#branchFieldsContainer). Every saved alert threw "Cannot set properties of
null" on load and the branch dropdown silently never rendered for ANY
source -- Taj Muhabath included, not just the two new branch-aware ones.

GitHub Pages doesn't support a custom Cache-Control/_headers file, and this
project intentionally has no build step, so rather than fight caching
directly, every deploy gives each local script/stylesheet URL a unique
`?v=<short-sha>` suffix. A URL the browser has never cached before is
always fetched fresh, so index.html and its scripts can never again be
served as a mismatched pair from two different deploys -- whichever HTML a
visitor's browser has cached, it can only ever request the exact script
version it actually shipped with.

Deliberately does NOT touch:
- sw.js -- only ever registered via navigator.serviceWorker.register('sw.js')
  in push.js/installPrompt.js, never a <script src> tag, so this regex
  never matches it anyway. Kept as an explicit skip below for safety in case
  that ever changes: cache-busting a service worker's own registration URL
  actively breaks its update lifecycle. frontend/sw.js already has its own
  CKM_SHELL_CACHE version bump for that.
- any external (http/https) URL, e.g. the Supabase CDN script -- versioning
  a third party's own URL would be pointless and could break their own
  caching/integrity expectations.

Run from the repo root (matches how .github/workflows/pages.yml calls it):
    python3 .github/scripts/cache_bust_frontend.py
"""
import glob
import re
import subprocess

LOCAL_ASSET = re.compile(r'((?:src|href)=")((?!https?://)[^"]+\.(?:js|css))(")')


def git_short_sha() -> str:
    return subprocess.check_output(
        ["git", "rev-parse", "--short", "HEAD"]
    ).decode().strip()


def bust(match: "re.Match[str]", sha: str) -> str:
    prefix, path, suffix = match.groups()
    if path.endswith("sw.js"):
        return match.group(0)
    sep = "&" if "?" in path else "?"
    return f"{prefix}{path}{sep}v={sha}{suffix}"


def main() -> None:
    sha = git_short_sha()
    for html_file in glob.glob("frontend/*.html"):
        with open(html_file, "r", encoding="utf-8") as f:
            original = f.read()
        updated = LOCAL_ASSET.sub(lambda m: bust(m, sha), original)
        if updated != original:
            with open(html_file, "w", encoding="utf-8") as f:
                f.write(updated)
            print(f"Cache-busted {html_file} with ?v={sha}")
        else:
            print(f"No local script/stylesheet URLs found to cache-bust in {html_file}")


if __name__ == "__main__":
    main()
