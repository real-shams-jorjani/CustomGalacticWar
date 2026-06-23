# Deploying the Custom Galactic War site

The site is **static** (HTML/CSS/JS). The only moving part is the **war data**: the browser
can't read holotable directly (no CORS), so something server-side has to pull it and bake
`data/*.json`. That single fact decides which path you pick.

## Before you deploy (both paths)

1. **Set your domain.** In `index.html`, replace every `REPLACE_WITH_YOUR_DOMAIN` (the
   `canonical` + Open Graph + Twitter tags) with your real `https` origin, e.g.
   `https://customgalacticwar.net`. These must be absolute URLs or link previews break.
2. **Set the Download link.** In `index.html`, the `#download-btn` `href` is a placeholder
   (`href="#"`). Point it at the mod download (Google Drive / GitHub release / etc.).
3. The Discord invite (`discord.com/invite/cgw`) and everything else is ready.

---

## Path A — Static host + scheduled refresh  (free, simplest)

**Freshness:** the data refreshes on a cron, **~5 min** at best (GitHub's floor; can lag to
~15 under load). The war moves slowly, so this still reads as live — but it is **not** true 30 s.

**Build the bundle locally any time:**
```bash
python build.py            # bakes fresh data, then assembles dist/
python build.py --no-fetch # skip the holotable pull; just rebuild dist/ from current data/
```
`dist/` is the publishable folder — only `index.html`, `css/`, `js/`, `img/`, `fonts/`, `data/`
(+ `robots.txt`, `.nojekyll`). Dev files (`serve.py`, `fetch_map.py`, `build.py`, `lore-editor.html`,
`_source/`) are intentionally **excluded**.

### GitHub Pages (recommended for this path — auto-refreshes)
1. `git init` and push this folder to a GitHub repo (commit `_source/` too — the baker reads it).
2. Repo **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Done. `.github/workflows/deploy.yml` bakes + publishes on every push, on demand, and every
   ~5 min. No server to run.

### Netlify / Cloudflare Pages
- Build command: `python build.py` &nbsp; Publish directory: `dist`
- For scheduled refreshes use the host's scheduled-build / cron feature (or a periodic deploy hook).
- One-off (no auto-refresh): run `python build.py` locally and drag `dist/` into the dashboard.

---

## Path B — Always-on server  (true 30 s live)

Run `serve.py` on a host that keeps a process alive. It serves the site **and** re-bakes from
holotable every 30 s, so data is genuinely live.

- **`Procfile`** is included: `web: python serve.py`. `serve.py` reads `$PORT`, binds `0.0.0.0`.
- Works on Railway / Render / Fly.io / a VPS. Keep `_source/` (the baker needs it).
- **Free tiers that sleep on idle will stall the data while asleep** — use a non-sleeping/paid
  instance if you want uninterrupted 30 s updates.
- VPS: run `python serve.py` under systemd / pm2 / tmux so it restarts on reboot.

---

## Environment variables

| var | default | meaning |
|-----|---------|---------|
| `PORT` | `8090` | port to bind (PaaS hosts inject this) |
| `WARFORGE_REBAKE_SECS` | `30` | seconds between holotable re-bakes; `0` disables (Path B) |
| `WARFORGE_ALLOW_SAVE` | _(unset)_ | leave UNSET in production. The lore editor's `/save` endpoint is **localhost-only**; setting this to `1` allows remote saves (don't, on a public host) |

## Security / hygiene notes

- **`lore-editor.html` is a local authoring tool.** `build.py` keeps it out of the static bundle,
  and on `serve.py` its `/save/lore.json` endpoint only accepts localhost (see the table). To author
  lore for a deployed site: edit locally, then redeploy (Path A) or rely on the live save (Path B,
  localhost only).
- `_source/` (GM save snapshot + catalogues) is needed only by the baker. It is **not** published by
  `build.py`. For Path A on GitHub it must be committed so CI can bake; it is never served to visitors.
- `data/` ships pre-baked, so the site renders immediately even before the first refresh.

**Fanmade, community-run. NOT AFFILIATED WITH ARROWHEAD GAME STUDIOS.**
