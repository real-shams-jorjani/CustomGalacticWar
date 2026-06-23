#!/usr/bin/env python3
"""Assemble the publishable static snapshot of the site into ``dist/``.

By default it first re-bakes ``data/*.json`` from holotable (via ``fetch_map.build()``), then
copies ONLY the files a static host should serve into ``dist/``. Dev-only files (``serve.py``,
``fetch_map.py``, this script, ``lore-editor.html``, ``_source/``, ``__pycache__/``, the docs)
are deliberately left OUT of the public bundle.

    python build.py              # bake fresh data, then build dist/
    python build.py --no-fetch   # skip the holotable fetch; just (re)assemble dist/ from current data/

Upload the resulting ``dist/`` to any static host (GitHub Pages, Netlify, Cloudflare Pages, ...).
Stdlib only -- no pip deps. See DEPLOY.md.
"""
import os
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
DIST = os.path.join(HERE, "dist")

# The ONLY things published. Anything not listed here (serve.py, fetch_map.py, build.py,
# lore-editor.html, _source/, __pycache__/, README.md, DEPLOY.md, Procfile, .github/, *.tmp)
# never reaches the public bundle.
INCLUDE_DIRS = ["css", "js", "img", "fonts", "data"]
INCLUDE_FILES = ["index.html", "robots.txt", ".nojekyll"]

DEFAULT_ROBOTS = "User-agent: *\nAllow: /\n"


def bake():
    """Re-pull holotable + rewrite data/*.json (same code path as `python fetch_map.py`)."""
    if HERE not in sys.path:
        sys.path.insert(0, HERE)
    import fetch_map
    fetch_map.build()


def build():
    assert os.path.basename(DIST) == "dist", "dist path sanity check failed"
    if os.path.isdir(DIST):
        shutil.rmtree(DIST)
    os.makedirs(DIST)

    copied = []
    for d in INCLUDE_DIRS:
        src = os.path.join(HERE, d)
        if os.path.isdir(src):
            shutil.copytree(src, os.path.join(DIST, d),
                            ignore=shutil.ignore_patterns("__pycache__", "*.tmp", "*.pyc"))
            copied.append(d + "/")
    for f in INCLUDE_FILES:
        src = os.path.join(HERE, f)
        if os.path.isfile(src):
            shutil.copy2(src, os.path.join(DIST, f))
            copied.append(f)

    # Static-host helpers (synthesize if they weren't present at the project root).
    nojekyll = os.path.join(DIST, ".nojekyll")
    if not os.path.exists(nojekyll):
        open(nojekyll, "w").close()
        copied.append(".nojekyll")
    robots = os.path.join(DIST, "robots.txt")
    if not os.path.exists(robots):
        with open(robots, "w", encoding="utf-8") as fp:
            fp.write(DEFAULT_ROBOTS)
        copied.append("robots.txt")
    return copied


def _dist_size():
    total = 0
    for root, _, files in os.walk(DIST):
        for fn in files:
            total += os.path.getsize(os.path.join(root, fn))
    return total


if __name__ == "__main__":
    if "--no-fetch" in sys.argv:
        print("[build] --no-fetch: using existing data/", flush=True)
    else:
        print("[build] baking fresh data from holotable ...", flush=True)
        bake()
    items = build()
    print("[build] dist/ ready: " + ", ".join(items), flush=True)
    print(f"[build] {_dist_size() / 1024 / 1024:.1f} MB total  ->  upload dist/ to any static host", flush=True)
