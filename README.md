# Custom Galactic War — live map site

A self-contained, read-only website that renders the **Custom Galactic War**
(hosted on [holotable.net](https://holotable.net)) as an interactive 2.5D
galactic map, styled after the WarForge command console.

This project is **fully standalone** — it does **not** need a WarForge install.
Everything it reads lives in this folder.

## Run it

```bash
python fetch_map.py     # (optional) pull the latest war state + bake data/*.json once
python serve.py         # serve the site at http://localhost:8090
```

Then open <http://localhost:8090>. `serve.py` also prints a `Network:` URL so you
can open it on your phone over the same Wi-Fi.

**The map stays live on its own.** While `serve.py` runs it re-pulls holotable and
re-bakes `data/*.json` on a background thread **every 30 seconds**, and the page
re-fetches that data every 30 seconds — so the war state updates without reloading
or re-running anything. Change the cadence with the `WARFORGE_REBAKE_SECS`
environment variable (seconds; `0` disables it and reverts to manual
`python fetch_map.py` bakes). The one-time `fetch_map.py` above is only needed if
you want fresh data *before* the first 30-second tick.

Both scripts use **only the Python standard library** — no `pip install` needed.

## How the data works

`fetch_map.py` pulls the live war state from holotable
(`public.holotable.net`, war `801`) — `WarInfo`, `WarStatus`, `WarAssignment`,
`NewsFeed` — into `_source/darkfluidapidata/`, then bakes compact JSON the
browser loads into `data/`:

| file | contents |
|------|----------|
| `data/map.json` | war-state core: sectors, links, attacks, DSS, stats, Major Order, factions |
| `data/planets.json` | the ~270 planets (owner, liberation, biome, effects, regions) |
| `data/dispatch.json` | the generated Ministry dispatch feed |
| `data/fleets.json` | detected enemy fleets (empty when the war has none) |
| `data/bestiary.json` | per-faction enemy roster |

Re-run `python fetch_map.py` any time to refresh. If holotable is unreachable it
falls back to the last-fetched snapshot in `_source/darkfluidapidata/` so the
bake still works offline.

## What's bundled (`_source/`)

Stable WarForge reference data the baker needs but holotable doesn't serve:

- `_source/src/data/static/` — planet names, regions, effect metadata, and the
  fleet / enemy / dispatch catalogues.
- `_source/src/core/major_orders.py` — the pure Major-Order logic (so the MO card
  matches the in-game editor).
- `_source/darkfluidapidata/` — a snapshot of the **Custom Galactic War** (taken from
  the GM's `bot_cgw` save). It's the live-fetch write target **and** the offline
  fallback, and — importantly — it supplies **`sector_data.json`** (the sector cell
  geometry), which holotable has no endpoint for. This MUST be the CGW's own sector
  data, NOT the near-official `darkfluidapidata` snapshot. If the CGW's sector layout
  ever changes, refresh `_source/darkfluidapidata/sector_data.json` from the GM save.

## Authoring Points of Interest (lore)

Each planet's inspect screen has a **POINTS OF INTEREST** section driven by
`data/lore.json` — hand-authored intel cards, never touched by `fetch_map.py`.

Author them with the built-in editor: run `python serve.py`, then open
<http://localhost:8090/lore-editor.html>. Pick a planet, add entries (category,
title, icon, date, status tag, and a body of text / image / quote blocks), watch
the **live preview** render exactly as it will on the map, then click
**Save to lore.json** — it writes `data/lore.json` directly. Reload the map to see
the new lore. (Text and captions support `**bold**`, `*italic*`,
`[c=#FFE900]highlight[/c]`, and `[link=https://…]label[/link]`.)

## Notes

- **Image assets are pre-baked** into `img/` (planet globes, faction/effect icons,
  enemy emoji). Re-baking those from source art requires the full WarForge repo;
  for a normal data refresh you never need to.
- The **Dispatch tab is disabled** for now (Home + War Map only). Re-enable by
  adding `"dispatch"` back to `VIEWS` in `js/router.js` and restoring its nav link
  in `index.html`.
- `data/` ships pre-baked, so the site renders immediately even before the first
  `fetch_map.py` run.

Fanmade, community-run. **NOT AFFILIATED WITH ARROWHEAD GAME STUDIOS.**
