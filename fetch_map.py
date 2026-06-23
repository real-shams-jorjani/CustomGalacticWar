#!/usr/bin/env python3
"""Bake a read-only snapshot of the holotable.net galactic-war map into
``data/map.json`` for the sample website to render.

The browser can't fetch holotable directly (the API sends no CORS header), so
this script does the fetch server-side and writes a compact local JSON. Re-run
it any time to refresh the snapshot:

    python fetch_map.py

If the live fetch fails (offline), it falls back to the repo's local
darkfluidapidata/WarInfo.json + WarStatus.json so the map still renders.
"""
import json
import os
import sys
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
# SELF-CONTAINED: every input lives under _source/ (bundled WarForge catalogues + the
# pure Major Order helper). No external WarForge repo is needed.
REPO = os.path.join(HERE, "_source")
WAR_ID = "801"
# The Custom Galactic War is hosted on holotable.net; fetch_holotable() pulls the live
# war state server-side (the browser can't — the API sends no CORS header).
HOLOTABLE_BASE = "https://public.holotable.net"
HEADERS = {"User-Agent": "WarForge/1.0 (galactic-war map snapshot)",
           "Accept": "application/json"}

# Reuse the editor's pure Major Order logic (caption segments / bar kind / goal /
# completion) so the website's MO card renders task progress IDENTICALLY to mo.py
# and the in-editor tool. The module is pure (no Qt/Tk/I-O), so this is safe.
if REPO not in sys.path:
    sys.path.insert(0, REPO)
try:
    from src.core import major_orders as _mo
except Exception:
    _mo = None

# owner / race id -> display name + map colour (from src/core/constants.py
# FACTION_COLORS; Super Earth is owner id 1 and renders cyan-blue in-game).
FACTIONS = {
    1: {"name": "SUPER EARTH", "color": "#81dffb"},
    2: {"name": "TERMINIDS",   "color": "#ffca00"},
    3: {"name": "AUTOMATONS",  "color": "#ff8080"},
    4: {"name": "ILLUMINATE",  "color": "#daa4ef"},
    0: {"name": "CONTESTED",   "color": "#4b6b78"},
}


# War files resolve from _source/darkfluidapidata/: fetch_holotable() refreshes these
# live each run; the bundled snapshot is the offline fallback (and supplies sector_data,
# which holotable does not serve as an endpoint).
APIDATA = os.path.join(REPO, "darkfluidapidata")
CGW_DIRS = [APIDATA]


def fetch_holotable(war_id=WAR_ID, timeout=20):
    """Pull the live Custom Galactic War state from holotable.net into
    _source/darkfluidapidata/, using ONLY the standard library (no pip deps). Core
    files fail-soft: on any network error the bundled snapshot is kept so the bake
    still works offline. Returns a human-readable source label."""
    import urllib.request
    b, w = HOLOTABLE_BASE.rstrip("/"), str(war_id)
    core = {
        "WarInfo.json":       f"{b}/api/WarSeason/{w}/warinfo",
        "WarStatus.json":     f"{b}/api/WarSeason/{w}/Status",
        "WarAssignment.json": f"{b}/api/v2/Assignment/War/{w}",
        "NewsFeed.json":      f"{b}/api/NewsFeed/{w}",
    }
    extra = {
        "GalacticWarEffects.json": f"{b}/api/WarSeason/GalacticWarEffects",
        "SpaceStation.json":       f"{b}/api/SpaceStation/{w}/749875195",
    }
    os.makedirs(APIDATA, exist_ok=True)

    def grab(name, url, required):
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                data = json.load(r)
            with open(os.path.join(APIDATA, name), "w", encoding="utf-8") as f:
                json.dump(data, f)
            return True
        except Exception as e:
            print(f"[{'ERR ' if required else 'warn'}] holotable {name}: {e}")
            return False

    ok = all([grab(n, u, True) for n, u in core.items()])
    for n, u in extra.items():
        grab(n, u, False)
    label = "holotable.net (live)" if ok else "bundled snapshot (holotable offline)"
    print("[feed] " + label)
    return label


def _cgw(name):
    for d in CGW_DIRS:
        p = os.path.join(d, name)
        if os.path.isfile(p):
            try:
                return json.load(open(p, encoding="utf-8"))
            except Exception:
                continue
    return None


def _load_war():
    """Load the Custom Galactic War snapshot from _source/darkfluidapidata/ (refreshed
    live from holotable by fetch_holotable(); the bundled snapshot is the fallback)."""
    wi, st = _cgw("WarInfo.json"), _cgw("WarStatus.json")
    if not wi or not st:
        raise SystemExit("[fatal] no war data — holotable unreachable AND no bundled "
                         "snapshot in _source/darkfluidapidata/. Cannot bake.")
    return wi, st, "Custom Galactic War (holotable.net)"


def _load_assignment():
    """The CGW Major Order from WarAssignment.json."""
    a = _cgw("WarAssignment.json")
    if isinstance(a, list) and a:
        return a[0]
    if isinstance(a, dict) and a:
        return a
    return None


def _load_news():
    """The CGW NewsFeed — strips the game's <i=n> markup, splits title/body."""
    import re
    raw = _cgw("NewsFeed.json")
    items = raw if isinstance(raw, list) else (raw.get("items") if isinstance(raw, dict) else [])
    out = []
    for n in (items or []):
        msg = re.sub(r"</?i[^>]*>", "", (n.get("message") or "")).strip()
        lines = [ln.strip() for ln in msg.split("\n") if ln.strip()]
        if lines:
            out.append({"title": lines[0], "body": " - ".join(lines[1:])})
    return out


# faction tag for fleet names (editor vocabulary: Bug/Bot)
FLEET_FACTION_ORDER = {1: 0, 2: 1, 3: 2, 4: 3, 0: 9}


import re as _re
_EMO = _re.compile(r"<(a?):(\w+):(\d+)>")


def _emoji(tok):
    """'<a:HVLR:1430..>' -> {'eid':'1430..','anim':True}; '' -> None."""
    m = _EMO.search(tok or "")
    return {"eid": m.group(3), "anim": m.group(1) == "a"} if m else None


def _unit_faction(u):
    u = u or ""
    if "fac_bugs" in u: return 2
    if "fac_cyborgs" in u or "fac_bots" in u or "fac_automaton" in u: return 3
    if "fac_illuminate" in u or "fac_squids" in u: return 4
    if "fac_human" in u or "seaf" in u.lower(): return 1
    return 0


def _load_bestiary():
    """Per-faction enemy roster (deduped by name) with each unit's icon emoji —
    the 'enemies that spawn'. From src/data/static/enemy_settings.json."""
    path = os.path.join(REPO, "src", "data", "static", "enemy_settings.json")
    try:
        es = json.load(open(path, encoding="utf-8")).get("enemy_settings", {})
    except Exception as e:
        print(f"[warn] enemy_settings load failed: {e}")
        return {}
    out, seen = {}, {}
    for v in es.values():
        fac = _unit_faction(v.get("unit"))
        nm = (v.get("name") or "").strip()
        if fac == 0 or not nm or nm.startswith("Unknown"):
            continue
        key = (fac, nm)
        if key in seen:
            continue
        seen[key] = 1
        out.setdefault(str(fac), []).append({"name": nm, "emoji": _emoji(v.get("emoji"))})
    return out


# the editor's live fleet export — the GM's CURRENT, manually-created roster
_LIVE_SNAPSHOT = os.path.join(REPO, "src", "data", "saves", "_live_snapshot")


def _load_live_json(name):
    """Read a file from the editor's live snapshot export. Absent/bad -> {}."""
    try:
        return json.load(open(os.path.join(_LIVE_SNAPSHOT, name), encoding="utf-8"))
    except Exception:
        return {}


def _load_fleet_catalogue():
    """fleet_catalogue.json -> {'spawn': {id: strain}, 'flag': {id: strain}} where
    strain = {label, emoji, faction}. spawn ids are the subfactions; flag ids carry
    the SEAF/marker half + a faction used for inference when no spawn pool resolves."""
    path = os.path.join(REPO, "src", "data", "static", "fleet_catalogue.json")
    try:
        raw = json.load(open(path, encoding="utf-8"))
    except Exception as e:
        print(f"[warn] fleet_catalogue load failed: {e}")
        return {"spawn": {}, "flag": {}}

    def _conv(d):
        out = {}
        for eid, v in (d or {}).items():
            try:
                out[int(eid)] = {"label": v.get("label", ""),
                                 "emoji": _emoji(v.get("emoji")),
                                 "faction": v.get("faction_id")}
            except (ValueError, TypeError):
                continue
        return out
    return {"spawn": _conv(raw.get("spawn_effects")), "flag": _conv(raw.get("flag_effects"))}


def _build_fleets(idx_name, owner_by_idx):
    """The GM's manually-created fleet roster, from the editor's LIVE export
    (``_live_snapshot/FleetNames.json`` + ``FleetLevels.json``) — NOT the stale
    static catalogue and NOT auto-detected effects, so only fleets the GM actually
    named appear. Identity keys are ``planet|spawn_pool|flag``; a multi-subfaction
    fleet (e.g. Siege Assembly) has several keys sharing one name, so group by name
    and collect EVERY spawn pool as a subfaction. Faction is inferred from a spawn
    pool, else the flag."""
    names = _load_live_json("FleetNames.json")       # "planet|pool|flag" -> name
    levels = _load_live_json("FleetLevels.json")     # "planet|pool|flag" -> level
    cat = _load_fleet_catalogue()
    spawn, flag = cat["spawn"], cat["flag"]

    groups = {}     # name -> {planet, pools(ordered, deduped), flags, level}
    for key, nm in (names.items() if isinstance(names, dict) else []):
        parts = str(key).split("|")
        if len(parts) != 3 or not nm:
            continue
        try:
            planet, pool, flg = int(parts[0]), int(parts[1]), int(parts[2])
        except ValueError:
            continue
        g = groups.setdefault(nm, {"planet": planet, "pools": [], "flags": set(), "level": 1})
        if pool and pool not in g["pools"]:
            g["pools"].append(pool)
        if flg:
            g["flags"].add(flg)
        try:
            lv = int(levels.get(key)) if isinstance(levels, dict) and levels.get(key) else 0
        except (ValueError, TypeError):
            lv = 0
        if lv:
            g["level"] = max(g["level"], lv)

    out = []
    for nm, g in groups.items():
        subs = [{"label": spawn[p]["label"], "emoji": spawn[p]["emoji"]}
                for p in g["pools"] if spawn.get(p) and spawn[p].get("label")]
        fac = next((spawn[p]["faction"] for p in g["pools"]
                    if spawn.get(p) and spawn[p].get("faction") is not None), None)
        if fac is None:
            fac = next((flag[fl]["faction"] for fl in g["flags"]
                        if flag.get(fl) and flag[fl].get("faction") is not None), None)
        fac = fac if fac is not None else 0
        pidx = g["planet"]
        out.append({
            "name": (nm or "FLEET").upper(),
            "faction": fac,
            "planet": idx_name.get(pidx, f"PLANET {pidx}" if pidx is not None else "—"),
            "planetIndex": pidx,
            "owner": owner_by_idx.get(pidx, 1),
            "level": g["level"],
            "subs": subs,                          # every spawn subfaction
            "strain": subs[0] if subs else None,   # primary (back-compat)
        })

    # role + normalized strength (a fleet whose faction holds the planet is a
    # garrison = DEFENDING; otherwise it's an assault = ATTACKING)
    maxlv = max((x["level"] for x in out), default=1) or 1
    for x in out:
        x["role"] = "DEFENDING" if x["faction"] == x["owner"] else "ATTACKING"
        x["strength"] = round(min(1.0, x["level"] / maxlv), 3)
    out.sort(key=lambda x: (FLEET_FACTION_ORDER.get(x["faction"], 9),
                            -x["level"], x["name"]))
    return out


# dispatch message faction names (for assault headlines)
_FAC_NAME = {0: "CONTESTED", 1: "SUPER EARTH", 2: "TERMINID", 3: "AUTOMATON", 4: "ILLUMINATE"}


def _load_dispatch_types():
    """WarForge's real dispatch type definitions (templates + accent colors)."""
    path = os.path.join(REPO, "src", "data", "static", "dispatch_types.json")
    try:
        return {t["key"]: t for t in json.load(open(path, encoding="utf-8"))}
    except Exception as e:
        print(f"[warn] dispatch_types load failed: {e}")
        return {}


_TPL_RE = _re.compile(r"\{(\w+)\}")


def _fill_tpl(tpl, vals):
    return _TPL_RE.sub(lambda m: str(vals.get(m.group(1)) or "") or m.group(0), tpl or "")


# each WarForge dispatch type is "posted" by a Super Earth ministry account
_TYPE_MINISTRY = {
    "STRATEGIC_UPDATE": "defense", "HIGH_PRIORITY_ALERT": "defense", "MAJOR_ORDER": "defense",
    "OPERATION_SUCCESS": "truth", "OPERATION_FAILURE": "truth",
    "INTEL_REPORT": "intelligence", "PROPAGANDA_BROADCAST": "truth",
}


def _build_dispatch(major_order, news, attacks, campaigns, idx_name, owner_by_idx, dss, bake_epoch, pidx_sector):
    """Drive the feed off WarForge's REAL dispatch_types.json (its title/body
    templates + accent colors), filled from live CGW state. Each type is posted
    by a Super Earth ministry 'account'. Timestamps are deterministic offsets so
    relative labels stay stable (no real per-item time in the snapshot)."""
    types = _load_dispatch_types()
    items = []
    t = bake_epoch
    state = {"off": 2}

    def emit(key, sev, fac, vals):
        dt = types.get(key, {})
        items.append({
            "type": key, "name": dt.get("name", key), "accent": dt.get("accent", "#3AA0FF"),
            "severity": sev, "ministry": _TYPE_MINISTRY.get(key, "defense"), "faction": fac,
            "ts": t - state["off"] * 60,
            "title": _fill_tpl(dt.get("title_template", key), vals),
            "body": _fill_tpl(dt.get("body_template", ""), vals),
        })
        state["off"] += 8

    if major_order:
        items.append({"type": "MAJOR_ORDER", "name": "MAJOR ORDER", "accent": "#FFE100", "severity": "critical",
                      "ministry": "defense", "faction": 1, "ts": t - state["off"] * 60,
                      "title": major_order.get("title") or "MAJOR ORDER", "body": major_order.get("brief") or "By order of High Command."})
        state["off"] += 8
    for n in (news or []):
        items.append({"type": "INTEL_REPORT", "name": "INTEL REPORT", "accent": "#23C7C7", "severity": "info",
                      "ministry": "intelligence", "faction": 1, "ts": t - state["off"] * 60,
                      "title": n.get("title", "DISPATCH"), "body": n.get("body") or "Stand by for orders."})
        state["off"] += 8
    for a in (attacks or []):
        f = owner_by_idx.get(a["s"], 0)
        emit("HIGH_PRIORITY_ALERT", "warning", f, {"planet": idx_name.get(a["t"], "UNKNOWN"),
             "enemy": _FAC_NAME.get(f, "ENEMY"), "sector": pidx_sector.get(a["t"], "the sector")})
    seen = set()
    for i, c in enumerate((campaigns or [])[:18]):
        pi = c.get("planetIndex")
        if pi is None or pi in seen:
            continue
        seen.add(pi)
        race = c.get("race", 0)
        vals = {"planet": idx_name.get(pi, "UNKNOWN"), "enemy": _FAC_NAME.get(race, "ENEMY"),
                "faction": "SUPER EARTH", "sector": pidx_sector.get(pi, "the sector"), "fleet": "Enemy forces"}
        emit(["STRATEGIC_UPDATE", "PROPAGANDA_BROADCAST", "INTEL_REPORT"][i % 3], "info", race, vals)
    if dss:
        emit("INTEL_REPORT", "info", 1, {"planet": dss.get("name", "the front"), "enemy": "anomalous"})
    # GM-authored posts from the WarForge composer (runtime, gitignored) — merge if present
    items.extend(_load_authored_posts())
    items.sort(key=lambda x: -x["ts"])
    import hashlib
    # Assign post ids and guarantee uniqueness (each id is a deep-link permalink:
    # #dispatch?post=<id>). Authored posts KEEP their canonical id so the Discord
    # embed permalink resolves; only collisions among live items get a -N suffix.
    seen = {it["id"] for it in items if it.get("authored") and it.get("id")}
    for it in items:
        if it.get("authored") and it.get("id"):
            continue
        base = it.get("id") or hashlib.md5(
            (str(it.get("ministry", "")) + (it.get("title") or "")).encode("utf-8")).hexdigest()[:10]
        uid, n = base, 2
        while uid in seen:
            uid = f"{base}-{n}"
            n += 1
        it["id"] = uid
        seen.add(uid)
    return items


def _load_accounts():
    """Dispatch accounts (ministries + custom) — the shared registry the composer
    and the Discord embeds also use."""
    path = os.path.join(REPO, "src", "data", "static", "dispatch_accounts.json")
    try:
        return json.load(open(path, encoding="utf-8")).get("accounts", []) or []
    except Exception as e:
        print(f"[warn] dispatch_accounts load failed: {e}")
        return []


def _load_authored_posts():
    """GM-composed dispatches the WarForge composer logged for the site
    (data/api_dump/dispatch_posts.json). Empty/absent is fine."""
    path = os.path.join(REPO, "data", "api_dump", "dispatch_posts.json")
    try:
        raw = json.load(open(path, encoding="utf-8"))
    except Exception:
        return []
    posts = raw if isinstance(raw, list) else raw.get("posts", [])
    out = []
    for p in (posts or []):
        out.append({
            "type": p.get("type", "INTEL_REPORT"), "name": p.get("name") or p.get("type", "DISPATCH"),
            "accent": p.get("accent", "#3AA0FF"), "severity": p.get("severity", "info"),
            "ministry": p.get("account") or p.get("ministry") or "truth",
            "faction": p.get("faction", 1), "ts": _coerce_ts(p.get("ts")),
            "title": p.get("title", ""), "body": p.get("body", ""),
            "image": p.get("image") or "", "id": p.get("id") or "", "authored": True,
        })
    return out


def _coerce_ts(ts):
    """Site feed sorts/labels on epoch SECONDS. The composer logs int(time.time()),
    but tolerate an ISO-8601 string too so a hand-edited post never breaks the bake."""
    if isinstance(ts, (int, float)):
        return int(ts)
    if isinstance(ts, str) and ts.strip():
        try:
            from datetime import datetime
            return int(datetime.fromisoformat(ts.replace("Z", "+00:00")).timestamp())
        except Exception:
            return 0
    return 0


# planet-pinned MO task types -> the quest-marker verb shown on the map
# (11 Liberation, 13 Control/hold). Other types aren't tied to one planet, so
# they get no verb and no marker.
_MO_VERB = {11: "LIBERATE", 13: "HOLD"}


def _build_major_order(asg, idx_name):
    """Compress the raw Assignment record into what the hero banner needs."""
    if not asg:
        return None
    setting = asg.get("setting", {})
    progress = asg.get("progress", []) or []
    tasks = []
    accent_race = 0
    for i, t in enumerate(setting.get("tasks", []) or []):
        vals = t.get("values", []) or []
        pidx = vals[-1] if vals else None          # type-13 hold tasks end in a planet index
        ttype = t.get("type")
        pv = progress[i] if i < len(progress) else 0
        entry = {
            "planet": idx_name.get(pidx, f"PLANET {pidx}" if pidx is not None else "—"),
            "index": pidx,
            "done": bool(pv),
            "type": ttype,
            "verb": _MO_VERB.get(ttype, ""),       # LIBERATE / HOLD -> map quest marker
        }
        # rich fields for the in-game-style MO card (mo.py parity)
        if _mo is not None:
            d = _mo.decode_task(t)
            race = int(d.get("race") or 0)
            if not accent_race and race:
                accent_race = race
            entry.update({
                "kind": _mo.task_progress_kind(t),   # liberation|count|segments|tugofwar
                "goal": _mo.task_goal(t),
                "progress": int(pv or 0),
                "complete": _mo.task_is_complete(t, pv),
                "race": race,
                # caption as [(text, highlight), ...] — rendered verbatim by the card
                "segments": _mo.task_caption_segments(t, idx_name),
            })
        else:
            entry.update({"kind": "count", "goal": 0, "progress": int(pv or 0),
                          "complete": bool(pv), "race": 0,
                          "segments": [[entry["verb"] or "OBJECTIVE", False]]})
        tasks.append(entry)
    rewards = setting.get("rewards", []) or []
    rtype = int(rewards[0].get("type", 1)) if rewards else 1
    return {
        "title": (setting.get("overrideTitle") or "MAJOR ORDER").strip(),
        "brief": (setting.get("overrideBrief") or "").strip(),
        "expiresIn": asg.get("expiresIn", 0),       # seconds remaining
        "rewards": rewards,
        "rewardType": ("WARBOND MEDAL" if rtype == 1 else "REQUISITION SLIPS"),
        "rewardAmount": (rewards[0].get("amount", 0) if rewards else 0),
        "accentRace": accent_race,
        "tasks": tasks,
    }


def _name_map():
    """settingsHash (str) -> display name, from the static planet-data file."""
    path = os.path.join(REPO, "src", "data", "static",
                        "simple_generated_planet_data.json")
    try:
        raw = json.load(open(path, encoding="utf-8"))
        return {k: (v.get("name") or "").strip() for k, v in raw.items()}
    except Exception as e:
        print(f"[warn] could not load planet name map: {e}")
        return {}


# biome image set the website bundles (img/biomes/<biome_long>.png). The few
# live planets whose biome has no banner fall back to this neutral one.
DEFAULT_BIOME_IMG = "planet_arctic_glacier_base.png"


def _identity_map():
    """settingsHash (str) -> {biome, biome_long, env} from planet_identity.json."""
    path = os.path.join(REPO, "src", "data", "static", "planet_identity.json")
    try:
        return json.load(open(path, encoding="utf-8"))
    except Exception as e:
        print(f"[warn] could not load planet identity map: {e}")
        return {}


def _bundled_biome_imgs():
    import glob
    d = os.path.join(HERE, "img", "biomes")
    return {os.path.basename(p) for p in glob.glob(os.path.join(d, "*.png"))}


def _bundled_globes():
    """Baked planet-globe PNGs (web-sample/bake_globes.py output)."""
    import glob
    d = os.path.join(HERE, "img", "globes")
    return {os.path.basename(p) for p in glob.glob(os.path.join(d, "*.png"))}


# port of main_window.get_cached_image's biome_long -> baked-asset resolver:
# baked sphere filenames DROP the planet_desert_/planet_forest_/planet_arctic_
# family prefixes that biome_long carries (planet_forest_moor_red -> planet_moor_red).
_GLOBE_STRIP = ("planet_desert_", "planet_forest_", "planet_arctic_")


def _versioned(rel_path):
    """Append a ``?v=<mtime>`` cache-buster keyed to the asset's actual file, so
    a re-baked globe/biome PNG (same filename) is re-fetched by the browser
    instead of served from a stale cache — CSS background-images (how the site
    loads globes) cache hard, which is why a freshly-baked magma globe could keep
    rendering the old look. No-op (no suffix) when the file isn't found."""
    try:
        mt = int(os.path.getmtime(os.path.join(HERE, rel_path)))
        return f"{rel_path}?v={mt}"
    except OSError:
        return rel_path


def _resolve_globe(blong, idx, globes):
    """biome_long (+ planet index) -> img/globes/<file>.png, with fallbacks.
    Returned path is cache-busted (see :func:`_versioned`)."""
    if idx == 0:
        cand = "planet_homeworld_superearth"
        if cand + ".png" in globes:
            return _versioned("img/globes/" + cand + ".png")
    cands = []
    if blong:
        cands.append(blong)
        stripped = blong
        for pre in _GLOBE_STRIP:
            if stripped.startswith(pre):
                stripped = "planet_" + stripped[len(pre):]
                break
        if stripped != blong:
            cands.append(stripped)
    for c in cands:
        if c + ".png" in globes:
            return _versioned("img/globes/" + c + ".png")
    return _versioned("img/globes/default_planet.png")


def _load_sectors():
    """The galactic sectors + their {ring,line} polar cells — from the CGW
    snapshot, falling back to the static live layout."""
    raw = _cgw("sector_data.json")
    if raw is None:
        try:
            raw = json.load(open(os.path.join(REPO, "src", "data", "static",
                                               "sector_data_live.json"), encoding="utf-8"))
        except Exception as e:
            print(f"[warn] sector data load failed: {e}")
            return []
    return raw.get("data", []) if isinstance(raw, dict) else (raw or [])


def _load_region_meta():
    """settingsHash (str) -> {name, inherits} for planet regions."""
    path = os.path.join(REPO, "src", "data", "static", "generated_planet_regions.json")
    try:
        raw = json.load(open(path, encoding="utf-8"))
        return {k: v for k, v in raw.items() if isinstance(v, dict) and "name" in v}
    except Exception as e:
        print(f"[warn] region meta load failed: {e}")
        return {}


# region tier names by regionSize 0-3 (mirrors REGION_SCALE / tier icons)
CITY_TIERS = ["SETTLEMENT", "TOWN", "CITY", "MEGACITY"]
FACTORY_TIERS = ["FACTORY I", "FACTORY II", "FACTORY III", "FACTORY IV"]
# tier ICON keys (mirror REGION_TIER_ICONS in core.constants) -> web region_<ic>.png
CITY_ICONS = ["settlement", "town", "city", "megacity"]
FACTORY_ICONS = ["t1_factory", "t2_factory", "t3_factory", "t4_factory"]

# campaign type -> display name (mirrors the bot's CAMPAIGNS table)
CAMPAIGN_NAMES = {0: "LIBERATION", 1: "RECON", 2: "HIGH PRIORITY",
                  3: "BATTLE FOR SUPER EARTH", 4: "DEFENSE", 5: "BATTLE FOR CYBERSTAN"}
# fleet faction tag (editor vocabulary: Bug/Bot)
FLEET_TAG = {0: "UNKNOWN", 1: "SUPER EARTH", 2: "BUG", 3: "BOT", 4: "ILLUMINATE"}
FACTION_ORDER = [1, 2, 3, 4, 0]


def _load_static_json(name):
    try:
        return json.load(open(os.path.join(REPO, "src", "data", "static", name), encoding="utf-8"))
    except Exception as e:
        print(f"[warn] could not load {name}: {e}")
        return {}


def _ordinal(n):
    if 10 <= (n % 100) <= 20:
        return f"{n}TH"
    return f"{n}{ {1: 'ST', 2: 'ND', 3: 'RD'}.get(n % 10, 'TH') }"


def _detect_fleets(status, catalogue, idx_name, owner_by_idx):
    """Port of the bot's services.detect_fleets — pairs catalogued (spawn,flag)
    effects in planetActiveEffects into live fleet sightings."""
    spawn = catalogue.get("spawn_effects", {}) or {}
    flag = catalogue.get("flag_effects", {}) or {}
    labels = {}
    for half in (flag, spawn):       # spawn label wins
        for m in half.values():
            if isinstance(m, dict) and m.get("pair_id") and m.get("label"):
                labels[str(m["pair_id"])] = m["label"]
    bucket = {}
    for ent in status.get("planetActiveEffects", []) or []:
        eid = str(ent.get("galacticEffectId", 0))
        pidx = ent.get("index", -1)
        meta, role = spawn.get(eid), "spawn"
        if meta is None:
            meta, role = flag.get(eid), "flag"
        if not isinstance(meta, dict) or not meta.get("pair_id"):
            continue
        fac = int(meta.get("faction_id", 0))
        bucket.setdefault((pidx, str(meta["pair_id"]), fac), {}).setdefault(role, eid)

    items = sorted(bucket.items(), key=lambda kv: (
        FACTION_ORDER.index(kv[0][2]) if kv[0][2] in FACTION_ORDER else 99,
        labels.get(kv[0][1], ""), kv[0][0]))
    fleets, ordinal = [], {}
    for (pidx, pid, fac), slot in items:
        ordinal[fac] = ordinal.get(fac, 0) + 1
        tag = FLEET_TAG.get(fac, "ENEMY")
        fleets.append({
            "name": f"{_ordinal(ordinal[fac])} {tag} FLEET",
            "faction": fac,
            "label": labels.get(pid, f"{tag} FLEET"),
            "planet": idx_name.get(pidx, f"PLANET {pidx}"),
            "planetIndex": pidx,
            "owner": owner_by_idx.get(pidx, 1),
            "complete": ("spawn" in slot) and ("flag" in slot),
        })
    return fleets


def _pretty(s):
    return (s or "").replace("_", " ").strip().upper()


def build():
    source = fetch_holotable()        # refresh _source/darkfluidapidata/ from holotable.net (fail-soft)
    wi, st, _ = _load_war()
    print(f"[ok] source: {source}")

    names = _name_map()
    identity = _identity_map()
    biome_imgs = _bundled_biome_imgs()
    globes = _bundled_globes()

    # index -> live status row
    status_by_idx = {s["index"]: s for s in st.get("planetStatus", [])}
    campaign_by_idx = {c["planetIndex"]: c for c in st.get("campaigns", [])}
    events_by_idx = {e["planetIndex"]: e for e in st.get("planetEvents", [])}
    event_idx = set(events_by_idx)
    war_time = st.get("time", 0)                       # game-time seconds (for event clocks)
    bake_epoch = int(datetime.now(timezone.utc).timestamp())
    home_by_idx = {}
    for hw in wi.get("homeWorlds", []):
        for pi in hw.get("planetIndices", []):
            home_by_idx[pi] = hw.get("race")

    planets = []
    owner_counts = {}
    total_players = 0
    biomes_tbl = {}      # biome_long -> {img, globe}; shared lookup, not copied per-planet
    for p in wi.get("planetInfos", []):
        idx = p["index"]
        s = status_by_idx.get(idx, {})
        owner = s.get("owner", p.get("initialOwner", 0))
        hp = s.get("health", p.get("maxHealth", 0))
        mx = p.get("maxHealth", 0) or 1
        players = s.get("players", 0)
        total_players += players
        owner_counts[owner] = owner_counts.get(owner, 0) + 1
        camp = campaign_by_idx.get(idx)
        name = names.get(str(p.get("settingsHash")), "") or f"PLANET {idx}"

        # biome banner + hazards (settingsHash -> planet_identity)
        ident = identity.get(str(p.get("settingsHash")), {})
        blong = ident.get("biome_long")
        img_file = f"{blong}.png" if blong and f"{blong}.png" in biome_imgs \
            else DEFAULT_BIOME_IMG
        env = [_pretty(e) for e in (ident.get("environmentals") or [])
               if e and str(e).lower() != "none"]
        # climate (weather_effects) — distinct from environmentals; drop the no-op temps
        climate = [_pretty(w) for w in (ident.get("weather_effects") or [])
                   if w and str(w).lower() not in ("none", "normal_temp")]

        # biome banner img + 3D globe are a function of biome_long -> a shared
        # `biomes` lookup table, NOT copied onto all 270 planets. The table entry
        # uses the index-INDEPENDENT globe; only a planet whose globe differs
        # (the Super Earth homeworld, idx 0) carries an inline `globe` override.
        key = blong or ""
        if key not in biomes_tbl:
            biomes_tbl[key] = {"img": _versioned("img/biomes/" + img_file),
                               "globe": _resolve_globe(blong, 1, globes)}
        planet = {
            "i": idx,
            "name": name,
            "x": round(p["position"]["x"], 5),
            "y": round(p["position"]["y"], 5),
            "sector": p.get("sector"),
            "owner": owner,
            "max": mx,
            "hp": hp,
            "players": players,
            "lib": round((mx - hp) / mx * 100, 1),   # contested progress
            "regen": s.get("regenPerSecond", 0),     # for resistance % (regen*3600/max*100)
            "active": camp is not None,
            "campRace": camp.get("race") if camp else None,
            "campType": camp.get("type") if camp else None,
            "event": idx in event_idx,
            "home": home_by_idx.get(idx),
            "biome": _pretty(ident.get("biome")) or "UNKNOWN",
            "biomeLong": blong or "",
            "env": env,
            "climate": climate,
            "wp": p.get("waypoints", []),
        }
        globe_actual = _resolve_globe(blong, idx, globes)
        if globe_actual != biomes_tbl[key]["globe"]:
            planet["globe"] = globe_actual
        planets.append(planet)

    # dedup supply links exactly like scene_builder (sorted pair set)
    idx_set = {p["i"] for p in planets}
    seen = set()
    links = []
    for p in planets:
        s = p["i"]
        for d in p["wp"]:
            if d in idx_set:
                pair = tuple(sorted((s, d)))
                if pair not in seen:
                    seen.add(pair)
                    links.append(list(pair))

    attacks = [{"s": a["source"], "t": a["target"]}
               for a in st.get("planetAttacks", [])
               if a.get("source") in idx_set and a.get("target") in idx_set]

    # live Major Order, with task planet indices resolved to names
    idx_name = {p["i"]: p["name"] for p in planets}
    major_order = _build_major_order(_load_assignment(), idx_name)

    # sectors: polar cells + the faction that controls the most planets in each
    import collections
    by_sector = collections.defaultdict(collections.Counter)
    for p in planets:
        by_sector[p["sector"]][p["owner"]] += 1
    sectors = []
    for s in _load_sectors():
        sidx = s.get("index")
        cnt = by_sector.get(sidx)
        owner = cnt.most_common(1)[0][0] if cnt else 0
        sectors.append({
            "i": sidx,
            "name": (s.get("name") or "").split(" @ ")[0].strip(),
            "owner": owner,
            "cells": [[c["ring"], c["line"]] for c in s.get("edges", [])],
        })

    # Democracy Space Station — its current planet location
    ss = st.get("spaceStations", [])
    dss = None
    if ss:
        pidx = ss[0].get("planetIndex")
        dss = {"planetIndex": pidx, "name": idx_name.get(pidx, f"PLANET {pidx}"),
               "effects": len(ss[0].get("activeEffectIds", []))}

    # planet regions (cities / factories): static def + live state + name
    region_meta = _load_region_meta()
    rdef = {(r["planetIndex"], r["regionIndex"]): r for r in wi.get("planetRegions", [])}
    rlive = {(r["planetIndex"], r["regionIndex"]): r for r in st.get("planetRegions", [])}
    pidx_owner = {p["i"]: p["owner"] for p in planets}
    preg = collections.defaultdict(list)
    for (pidx, ridx), rd in rdef.items():
        lv = rlive.get((pidx, ridx), {})
        meta = region_meta.get(str(rd.get("settingsHash")), {})
        is_factory = "factory" in (meta.get("inherits") or "").lower()
        size = rd.get("regionSize", 0)
        csize = min(3, max(0, size))
        tier = (FACTORY_TIERS if is_factory else CITY_TIERS)[csize]
        ic = (FACTORY_ICONS if is_factory else CITY_ICONS)[csize]
        # owner 0/missing in the live status means "not being fought over" — the
        # region is held by whoever holds the planet, NOT contested. Default to it.
        r_owner = lv.get("owner") or pidx_owner.get(pidx, 0)
        preg[pidx].append({
            "name": (meta.get("name") or f"REGION {ridx}").strip(),
            "tier": tier,
            "ic": ic,
            "owner": r_owner,
            "hp": lv.get("health", rd.get("maxHealth", 0)),
            "max": rd.get("maxHealth", 1) or 1,
            "players": lv.get("players", 0),
        })
    for p in planets:
        rs = preg.get(p["i"])
        if rs:
            p["regions"] = rs

    # --- companion enrichments: adjacency, active effects, MO flag, fleets ---
    owner_by_idx = {p["i"]: p["owner"] for p in planets}

    eff_meta = _load_static_json("planetEffects.json")
    # galactic-effect render rules -> per-planet environmental FX classification
    # (gloom / void / vortex / black hole). The website reimagines these
    # holographically; default colours fill in where a rule has none.
    fx_rules = _load_static_json("effect_render_rules.json")
    _FX_DEFAULT = {"gloom": "#DFAB20", "void": "#A124E3", "vortex": "#B45BFF", "black_hole": "#FFB000"}
    eff_by_planet = collections.defaultdict(list)
    fx_by_planet = collections.defaultdict(dict)        # pidx -> {fx_type: {c, s, d, o, fg}}
    seen_eff = collections.defaultdict(set)
    # Subfaction presence: a planet's active type-71 FLAG effects (from the fleet catalogue)
    # -> the factions with an ambient subfaction there. The site shows these as placeholder
    # fleet markers (the live fleet roster needs the editor export holotable doesn't serve).
    flag_cat = _load_fleet_catalogue().get("flag", {})
    subfac_by_planet = collections.defaultdict(set)
    for ent in st.get("planetActiveEffects", []) or []:
        pidx, eid = ent.get("index"), ent.get("galacticEffectId")
        try:
            _eid_i = int(eid)
        except (TypeError, ValueError):
            _eid_i = None
        if _eid_i is not None and _eid_i in flag_cat:
            _ff = flag_cat[_eid_i].get("faction")
            if _ff in (1, 2, 3, 4):
                subfac_by_planet[pidx].add(int(_ff))
        rule = fx_rules.get(str(eid)) if isinstance(fx_rules, dict) else None
        if rule and rule.get("type") in _FX_DEFAULT:
            ft = rule["type"]
            entry = {"c": rule.get("color") or _FX_DEFAULT[ft]}
            # carry the intensity TIER (gloom/vortex rules encode scale/density/
            # opacity) so the site can size each anomaly by how strong it is.
            if "scale" in rule:   entry["s"] = rule["scale"]
            if "density" in rule: entry["d"] = rule["density"]
            if "opacity" in rule: entry["o"] = rule["opacity"]
            if rule.get("foreground"): entry["fg"] = 1
            # if a world stacks several tiers of the same anomaly, keep the strongest
            prev = fx_by_planet[pidx].get(ft)
            if not prev or entry.get("d", 0) >= prev.get("d", 0):
                fx_by_planet[pidx][ft] = entry
        meta = eff_meta.get(str(eid)) if isinstance(eff_meta, dict) else None
        if not meta:
            continue
        nm = (meta.get("name") or "").strip()
        if not nm or nm == "TESTING EFFECT" or nm in seen_eff[pidx]:
            continue
        seen_eff[pidx].add(nm)
        # carry the galactic-effect ID: the website maps it to WarForge's per-effect
        # POI tag icon (assets/tags/<id>.png -> img/tags/<id>.png), e.g. 1206 = the
        # Terminid Research Preserve. Only effects whose id has an icon are shown.
        try:
            eid_int = int(eid)
        except (TypeError, ValueError):
            eid_int = 0
        eff = {"name": nm, "desc": (meta.get("description") or "").strip()}
        if eid_int > 0:
            eff["id"] = eid_int
        eff_by_planet[pidx].append(eff)

    mo_targets = set()
    if major_order:
        mo_targets = {t["index"] for t in major_order.get("tasks", []) if t.get("index") is not None}

    for p in planets:
        # adjacency is NOT stored per-planet — it duplicates `links` (the supply-line
        # index pairs). The site rebuilds each planet's `adj` from links + the
        # planet-by-index map, which also keeps it consistent with the drawn lines.
        fx = eff_by_planet.get(p["i"])
        if fx:
            p["effects"] = fx
        fxp = fx_by_planet.get(p["i"])
        if fxp:
            p["fx"] = [dict({"t": t}, **e) for t, e in fxp.items()]
        sf = subfac_by_planet.get(p["i"])
        if sf:
            p["subfac"] = sorted(sf)                    # factions with a type-71 flag here
        if p["i"] in mo_targets:
            p["mo"] = True
        # active defense/claim event — the double-stacked race bar's data
        ev = events_by_idx.get(p["i"])
        if ev:
            ev_max = max(1, ev.get("maxHealth", 1))
            start, expire = ev.get("startTime", 0), ev.get("expireTime", 0)
            p["ev"] = {
                "hp": ev.get("health", ev_max),
                "max": ev_max,
                "race": ev.get("race", 2),
                "type": ev.get("eventType", 1),            # 1 defense, 2 claim/invasion
                "startEpoch": bake_epoch - max(0, war_time - start),   # absolute wall-clock
                "expireEpoch": bake_epoch + max(0, expire - war_time),
            }
        p.pop("wp", None)        # waypoints consumed (links + adjacency) — drop to slim the payload

    fleets = _build_fleets(idx_name, owner_by_idx)
    news_list = _load_news()
    sector_name_by_idx = {s["i"]: s["name"] for s in sectors}
    pidx_sector = {p["i"]: sector_name_by_idx.get(p.get("sector"), "the sector") for p in planets}
    dispatch = _build_dispatch(major_order, news_list, attacks, st.get("campaigns", []),
                               idx_name, owner_by_idx, dss, bake_epoch, pidx_sector)

    # fleet aggregates (so the JS doesn't recompute group headers every render)
    max_fleet_lvl = max((f["level"] for f in fleets), default=0)
    fleets_by_faction = {}
    for f in fleets:
        fc = f["faction"] if f["faction"] != 0 else 1
        g = fleets_by_faction.setdefault(str(fc), {"count": 0, "levelSum": 0, "atk": 0, "def": 0})
        g["count"] += 1
        g["levelSum"] += f["level"]
        g["atk" if f["role"] == "ATTACKING" else "def"] += 1

    se = owner_counts.get(1, 0)
    out = {
        "warId": wi.get("warId", WAR_ID),
        "fetchedAt": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
        "warTime": int(war_time),                          # elapsed war seconds -> "DAY N" of the war in the UI
        "source": source,
        "factions": {str(k): v for k, v in FACTIONS.items()},
        "stats": {
            "planets": len(planets),
            "activeCampaigns": len(st.get("campaigns", [])),
            "attacks": len(attacks),
            "ownerCounts": {str(k): v for k, v in owner_counts.items()},
            "seControlledPct": round(se / max(1, len(planets)) * 100, 1),
            "totalPlayers": total_players,
            "maxFleetLevel": max_fleet_lvl,
            "fleetsByFaction": fleets_by_faction,
        },
        "majorOrder": major_order,
        "news": news_list,
        "dispatch": dispatch,
        "accounts": _load_accounts(),
        "bestiary": _load_bestiary(),
        "dss": dss,
        "fleets": fleets,
        "sectors": sectors,
        "planets": planets,
        "links": links,
        "attacks": attacks,
        "biomes": biomes_tbl,
    }

    out_dir = os.path.join(HERE, "data")
    os.makedirs(out_dir, exist_ok=True)

    def _write(name, obj):
        path = os.path.join(out_dir, name)
        tmp = path + ".tmp"                              # atomic swap: a live server
        with open(tmp, "w", encoding="utf-8") as f:     # (auto-rebake) must never serve
            json.dump(obj, f, separators=(",", ":"))    # a half-written file
        os.replace(tmp, path)
        return os.path.getsize(path) / 1024

    # Split the heavy / independent sections into their own files (the site loads
    # them in parallel and reassembles them); map.json keeps the small, tightly
    # interrelated war-state core + the biome lookup table.
    split = [("planets", "planets.json"), ("dispatch", "dispatch.json"),
             ("fleets", "fleets.json"), ("bestiary", "bestiary.json")]
    sizes = {fname: _write(fname, out.pop(key)) for key, fname in split}
    sizes["map.json"] = _write("map.json", out)
    print("[ok] wrote " + " | ".join(f"{n} {kb:.0f}KB" for n, kb in sizes.items()))
    print(f"     {len(planets)} planets | {len(links)} supply lines | "
          f"{len(attacks)} attacks | {out['stats']['activeCampaigns']} campaigns")
    print(f"     SE controls {se}/{len(planets)} planets "
          f"({out['stats']['seControlledPct']}%) | "
          f"{total_players:,} players in theatre")


if __name__ == "__main__":
    build()
