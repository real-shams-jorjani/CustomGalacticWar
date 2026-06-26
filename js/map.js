
(function () {
  const MAP_SCALE = 1000;
  const cv = document.getElementById("galaxy-map");
  const ctx = cv.getContext("2d");
  const off = document.createElement("canvas");
  const offCtx = off.getContext("2d");
  const tip = document.getElementById("map-tip");
  const consoleEl = document.getElementById("planet-console");
  const wrap = cv.parentElement;

  let DATA = null, FAC = {}, LORE = {};
  let POI_IDS = new Set();
  // Hardcoded fallback palette so missing/empty `factions` data can NEVER render every icon as the
  // grey-blue fallback (mirrors fetch_map.py's FACTIONS). The baked data normally supplies these.
  const FAC_DEFAULTS = { 0: { name: "CONTESTED", color: "#4b6b78" }, 1: { name: "SUPER EARTH", color: "#81dffb" }, 2: { name: "TERMINIDS", color: "#ffca00" }, 3: { name: "AUTOMATONS", color: "#ff8080" }, 4: { name: "ILLUMINATE", color: "#daa4ef" } };
  const facColor = (id) => (FAC[id] && FAC[id].color) || (FAC_DEFAULTS[id] && FAC_DEFAULTS[id].color) || "#4b6b78";
  const facName = (id) => (FAC[id] && FAC[id].name) || (FAC_DEFAULTS[id] && FAC_DEFAULTS[id].name) || "CONTESTED";

  const cam = { x: 0, y: 0, zoom: 1, pitch: 0.65, rot: 0 };
  let baseScale = 0.25, cvW = 1100, cvH = 600, dpr = 1, HOME = null;

  let renderDpr = 1, interacting = false, interactTimer = null;
  const INTERACT_DPR = 1;
  const RMOTION = matchMedia("(prefers-reduced-motion: reduce)").matches;
  // Low-graphics mode: strips visual fluff (starfield, nebula, haze, parallax, glows, 3D depth, and
  // particle/VFX intensity) while keeping all functionality. Default LOW on phones, HIGH on desktop
  // (incl. "request desktop site", which reports a wide viewport); a stored choice overrides.
  // Graphics tiers: 0 = low (bare), 1 = medium (middleground), 2 = high (full). LOWFX gates the most
  // aggressive cuts (low only); REDUCED gates the moderate cuts shared by medium AND low.
  const GFX_NAMES = ["low", "medium", "high"], GFX_LEVELS = { low: 0, medium: 1, high: 2 };
  function wantLowGfx() { return (window.innerWidth || document.documentElement.clientWidth || 9999) <= 820; }
  const GFX_STORED = (function () { try { const s = localStorage.getItem("cgw_gfx"); return GFX_LEVELS[s] != null ? s : null; } catch (e) { return null; } })();
  let GFX = GFX_STORED != null ? GFX_LEVELS[GFX_STORED] : (wantLowGfx() ? 0 : 2);
  let LOWFX = GFX === 0, REDUCED = GFX <= 1;
  try { document.documentElement.classList.toggle("lowfx", GFX === 0); } catch (e) {}
  function setGfx(level, persist) {
    if (level === true) level = 0; else if (level === false) level = 2;
    else if (typeof level === "string") level = GFX_LEVELS[level] != null ? GFX_LEVELS[level] : 2;
    GFX = level; LOWFX = GFX === 0; REDUCED = GFX <= 1;
    if (persist !== false) { try { localStorage.setItem("cgw_gfx", GFX_NAMES[GFX]); } catch (e) {} }
    document.documentElement.classList.toggle("lowfx", GFX === 0);
    Array.prototype.forEach.call(document.querySelectorAll("#map-layers button[data-gfx]"), (b) => b.classList.toggle("on", GFX_LEVELS[b.getAttribute("data-gfx")] === GFX));
    staticKey = ""; if (window.__mapRender) window.__mapRender(performance.now());
  }
  window.__setGfx = setGfx;
  // Track the device default across viewport changes until a manual choice is stored (so "request
  // desktop site" -> High). Medium is opt-in, so the auto-default only picks low or high.
  window.addEventListener("resize", function () { try { if (localStorage.getItem("cgw_gfx")) return; } catch (e) {} const wl = wantLowGfx() ? 0 : 2; if (wl !== GFX) setGfx(wl, false); });
  const ZMIN = 0.35, ZMAX = 9;

  let _c = 1, _s = 0, _scale = 0.25, elevK = 1;
  let CURVE = -0.085, curveR2 = 1;

  function syncCam() {
    const th = cam.rot * Math.PI / 180;
    _c = Math.cos(th); _s = Math.sin(th); _scale = baseScale * cam.zoom;
    curveR2 = (cvW * cvW + cvH * cvH) / 4 || 1;
    const op = Math.max(0.05, 1 - cam.pitch), CAP = 28, REF = 74;
    elevK = Math.min(1, CAP / (REF * op * _scale));
  }
  function project(wx, wy, elev) {
    let px = wx - cam.x, py = wy - cam.y;
    if (elev && !LOWFX) { const mag = elev * elevK * (1 - cam.pitch) / cam.pitch; px += -_s * mag; py += -_c * mag; }
    const rx = px * _c - py * _s;
    let ry = (px * _s + py * _c) * cam.pitch;
    let x = cvW / 2 + rx * _scale, y = cvH / 2 + ry * _scale;

    if (CURVE) { const dx = x - cvW / 2, dy = y - cvH / 2; let r2 = (dx * dx + dy * dy) / curveR2; if (r2 > 1) r2 = 1; const k = 1 + CURVE * r2; x = cvW / 2 + dx * k; y = cvH / 2 + dy * k; }
    return { x, y };
  }
  function unproject(sx, sy) {
    const th = cam.rot * Math.PI / 180, c = Math.cos(th), s = Math.sin(th), scale = baseScale * cam.zoom;
    let rx = (sx - cvW / 2) / scale, ry = (sy - cvH / 2) / scale; ry /= cam.pitch;
    return { x: cam.x + rx * c + ry * s, y: cam.y - rx * s + ry * c };
  }
  function screenDeltaToWorld(dxS, dyS) {
    const th = cam.rot * Math.PI / 180, c = Math.cos(th), s = Math.sin(th), scale = baseScale * cam.zoom;
    let rx = dxS / scale, ry = (dyS / scale) / cam.pitch;
    return { x: rx * c + ry * s, y: -rx * s + ry * c };
  }

  let PLANETS = [], HIDDEN = [], SECTORS = [], LINKS = [], ATTACKS = [], LABELS = [], DSS = null, MO_MARKS = [], DEFENSE_MARKS = [], FLEET_MARKS = [], FX_MARKS = [], SUBFAC_MARKS = [], GLOOM_LINKS = [], SE_LINKS = [], MIXED_LINKS = [], ENEMY_BORDER = [];

  const FLEETS_ENABLED = false;

  const LAYERS = { sectors: true, supply: true, effects: true, text: true, subfactions: true, objectives: true, attacks: true, timers: false };
  let byIndex = {}, SECTOR_NAME = {}, sectorOrder = [], lastRot = null;
  const hazPat = {}, dotPat = {}, asciiPat = {};

  const ASCII_RAMP = [" ", ".", ":", "/", "+", "*", "#", "@"];
  const ASCII_WALL_CELL = 9;
  const ASCII_FONT = "'Consolas','Courier New',monospace";
  const ang = (line) => (90 - line * 15) * Math.PI / 180;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const polar = (r, a) => ({ x: r * Math.cos(a), y: -r * Math.sin(a) });
  function arcPts(out, r, a0, a1, seg) { for (let i = 0; i <= seg; i++) { const a = a0 + (a1 - a0) * i / seg; out.push({ x: r * Math.cos(a), y: -r * Math.sin(a) }); } }
  function arcLine(r, a0, a1, seg) { const o = []; arcPts(o, r, a0, a1, seg); return o; }

  const J = (u, fb) => fetch(u).then((r) => r.ok ? r.json() : fb).catch(() => fb);
  Promise.all([
    fetch("data/map.json").then((r) => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); }),
    J("data/planets.json", []),
    J("data/dispatch.json", []),
    J("data/fleets.json", []),
    J("data/bestiary.json", {}),
    J("data/star_config.json", {}),
    J("data/poi_config.json", {}),
    fetch("data/lore.json").then((r) => r.ok ? r.json() : {}).catch(() => ({})),

    fetch("live/dispatch_posts.json").then((r) => r.ok ? r.json() : []).catch(() => []),
  ])
    .then(([core, planets, dispatch, fleets, bestiary, starCfg, poiCfg, lore, live]) => {
      DATA = core;
      DATA.planets = planets; DATA.dispatch = dispatch; DATA.fleets = fleets; DATA.bestiary = bestiary;
      STAR_CFG = starCfg && typeof starCfg === "object" ? starCfg : {};
      POI_IDS = parsePoiConfig(poiCfg);
      FAC = core.factions || {}; LORE = lore || {};
      rehydratePlanets(); mergeLivePosts(live); build();
    })
    .catch((err) => {
      console.error("[map] data unavailable - run `python fetch_map.py` to bake data/map.json, then reload.", err);
      const up = document.getElementById("uplink"); if (up) { up.textContent = "SIGNAL LOST"; up.classList.add("stale"); }
      ["dispatch-feed", "fleet-list", "home-dispatch"].forEach((id) => { const e = document.getElementById(id); if (e && !e.children.length) e.innerHTML = '<div class="fleet-empty">No signal from High Command.</div>'; });
    });

  function coerceTs(ts) {
    if (typeof ts === "number") return ts;
    if (typeof ts === "string" && ts.trim()) { const ms = Date.parse(ts); return isNaN(ms) ? 0 : Math.round(ms / 1000); }
    return 0;
  }

  function mergeLivePosts(live) {
    if (!DATA) return;
    const baked = Array.isArray(DATA.dispatch) ? DATA.dispatch : [];
    const norm = (p) => ({
      type: p.type || "INTEL_REPORT", name: p.name || p.type || "DISPATCH",
      accent: p.accent || "#3AA0FF", severity: p.severity || "info",
      ministry: p.account || p.ministry || "truth",
      faction: (p.faction != null ? p.faction : 1), ts: coerceTs(p.ts),
      title: p.title || "", body: p.body || "", image: p.image || "",
      id: p.id || "", authored: true,
    });
    const byId = new Map(), noId = [];
    baked.forEach((x) => { if (x && x.id) byId.set(x.id, x); else if (x) noId.push(x); });
    (Array.isArray(live) ? live : []).forEach((p) => { const n = norm(p); if (n.id) byId.set(n.id, n); });
    DATA.dispatch = [...byId.values(), ...noId].sort((a, b) => (b.ts || 0) - (a.ts || 0));
  }

  function rehydratePlanets() {
    const ps = DATA.planets || [], B = DATA.biomes || {}, bi = {};
    ps.forEach((p) => {
      bi[p.i] = p;
      const b = B[p.biomeLong] || {};
      if (p.img == null) p.img = b.img || "img/biomes/default_planet.png";
      if (p.globe == null) p.globe = b.globe || "img/globes/default_planet.png";
      p.adj = [];
    });
    (DATA.links || []).forEach((e) => {
      const a = bi[e[0]], c = bi[e[1]];
      if (a && c) { a.adj.push({ name: c.name, owner: c.owner, globe: c.globe, i: c.i }); c.adj.push({ name: a.name, owner: a.owner, globe: a.globe, i: a.i }); }
    });
  }

  function build() {
    const s = DATA.stats || {};
    setText("mh-planets", s.planets);
    setText("mh-camp", s.activeCampaigns); setText("mh-se", (s.seControlledPct ?? "--") + "%");
    setText("mh-snap", "SNAPSHOT " + (DATA.fetchedAt || ""));
    setText("war-day", Math.floor((DATA.warTime || 0) / 86400));
    buildScene(); fitAll(true);
    fillMajorOrder(); fillStats(); buildDispatch(); buildTicker(); buildFleets(); buildHome();
    installControls(); resize();
    window.addEventListener("resize", resize);
    startLoop();
  }
  function setText(id, v) { const e = document.getElementById(id); if (e) e.textContent = v; }

  const FAC_FILL = { 2: "#B45000", 3: "#A00003", 4: "#6A1E88" };
  const UNREACHABLE_EFFECT = 1190;

  const isUnreachable = (p) => !!(p.effects && p.effects.some((e) => e.id === UNREACHABLE_EFFECT));

  function _clipHalf(poly, nx, ny, d) {
    const out = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const da = nx * a.x + ny * a.y - d, db = nx * b.x + ny * b.y - d;
      if (da <= 0) out.push(a);
      if ((da <= 0) !== (db <= 0)) { const t = da / (da - db); out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }); }
    }
    return out;
  }
  function voronoiCell(sx, sy, pts, bound) {
    let poly = [{ x: -bound, y: -bound }, { x: bound, y: -bound }, { x: bound, y: bound }, { x: -bound, y: bound }];
    for (const p of pts) {
      const dx = p.x - sx, dy = p.y - sy;
      if (dx === 0 && dy === 0) continue;
      poly = _clipHalf(poly, dx, dy, dx * (sx + p.x) / 2 + dy * (sy + p.y) / 2);
      if (poly.length < 3) return null;
    }
    return poly;
  }

  function buildScene() {
    PLANETS = DATA.planets.filter((p) => !isUnreachable(p)).map((p) => ({ p, wx: p.x * MAP_SCALE, wy: -p.y * MAP_SCALE, elev: 0, sx: 0, sy: 0 }));

    HIDDEN = DATA.planets.filter((p) => isUnreachable(p)).map((p) => ({ p, wx: p.x * MAP_SCALE, wy: -p.y * MAP_SCALE, elev: 0, sx: 0, sy: 0 }));
    byIndex = {}; PLANETS.forEach((e) => (byIndex[e.p.i] = e));
    SECTOR_NAME = {}; (DATA.sectors || []).forEach((s) => (SECTOR_NAME[s.i] = s.name));

    const stat = {};
    DATA.planets.forEach((p) => {
      const s = (stat[p.sector] || (stat[p.sector] = { counts: {}, enemy: 0, total: 0, camp: false }));
      s.counts[p.owner] = (s.counts[p.owner] || 0) + 1; s.total++;
      if (p.owner !== 1 && p.owner >= 0) s.enemy++;
      if (p.active || p.ev) s.camp = true;
    });
    let maxEnemy = 1; Object.values(stat).forEach((s) => { if (s.enemy > maxEnemy) maxEnemy = s.enemy; });

    const ENEMY_BASE = 0, TIER_STEP = 0, SE_LIFT = 0;
    const cellSec = {};
    (DATA.sectors || []).forEach((s) => s.cells.forEach(([r, l]) => (cellSec[r + "," + l] = s.i)));

    const facBySec = {};
    (DATA.sectors || []).forEach((sec) => {
      const st = stat[sec.i] || { counts: {}, enemy: 0 };
      let de = 0, best = 0; for (const o in st.counts) { if (+o !== 1 && +o >= 0 && st.counts[o] > best) { best = st.counts[o]; de = +o; } }
      facBySec[sec.i] = st.enemy > 0 ? de : ((st.counts[1] || 0) > 0 ? 1 : 0);
    });

    const darkHex = (hex, f) => { const h = hex.replace("#", ""); const n = parseInt(h.length === 3 ? h.replace(/(.)/g, "$1$1") : h, 16); const c2 = (v) => Math.max(0, Math.min(255, v | 0)).toString(16).padStart(2, "0"); return "#" + c2(((n >> 16) & 255) * f) + c2(((n >> 8) & 255) * f) + c2((n & 255) * f); };

    const tierOf = (st) => Math.round(clamp((st.enemy || 0) / maxEnemy, 0, 1) * 2);
    const elevBySec = {};
    (DATA.sectors || []).forEach((sec) => { const st = stat[sec.i] || { enemy: 0 }, f = facBySec[sec.i]; elevBySec[sec.i] = f >= 2 ? (ENEMY_BASE + tierOf(st) * TIER_STEP) : (f === 1 ? SE_LIFT : 0); });
    ENEMY_BORDER = [];

    SECTORS = (DATA.sectors || []).map((sec) => {
      const me = sec.i, st = stat[sec.i] || { counts: {}, enemy: 0, total: 0, camp: false };
      const nb = (r, l) => cellSec[r + "," + ((l + 24) % 24)];
      const nbFac = (r, l) => { const ns = nb(r, l); return ns === undefined ? -1 : (facBySec[ns] || 0); };
      const fac = facBySec[me], isEnemy = fac >= 2, isSE = fac === 1, domEnemy = isEnemy ? fac : 0;
      const nbElev = (r, l) => { const ns = nb(r, l); return ns === undefined ? 0 : (elevBySec[ns] || 0); };
      const elev = elevBySec[me], tier = isEnemy ? tierOf(st) : 0;

      const fillHex = isEnemy ? (FAC_FILL[domEnemy] || facColor(domEnemy)) : (isSE ? facColor(1) : null);
      const wallHex = fillHex ? darkHex(fillHex, 0.42) : null;
      const outline = isEnemy ? facColor(domEnemy) : (isSE ? facColor(1) : "#1d2d38");
      const available = isEnemy && st.camp;

      const alpha = isEnemy ? ((available ? 0.5 : 0.34) + tier * 0.06) : (isSE ? 0.12 : 0);

      const tops = [], walls = [], risers = [], secEdges = [], dots = isEnemy ? [] : null;
      const DOT_STEP = [52, 44, 36][tier] || 44;

      const edge = (pts, r, l) => {
        if (nb(r, l) !== me) secEdges.push(pts);
        if (nbFac(r, l) !== fac) {
          walls.push(pts);
          if (isEnemy) { const ns = nb(r, l), nf = facBySec[ns] || 0; ENEMY_BORDER.push({ pts, el: elev, col: facColor(fac), col2: facColor(nf), nf, contested: nf >= 1 }); }
        } else {
          const ne = nbElev(r, l);
          if (ne < elev) risers.push({ pts, lo: ne, hi: elev });
        }
      };
      sec.cells.forEach(([ring, line]) => {
        const rIn = ring * 100, rOut = (ring + 1) * 100, a0 = ang(line), a1 = ang(line + 1);
        const poly = [];
        if (ring === 0) { poly.push({ x: 0, y: 0 }); arcPts(poly, rOut, a0, a1, 3); }
        else { arcPts(poly, rIn, a0, a1, 3); arcPts(poly, rOut, a1, a0, 3); }
        tops.push(poly);
        if (isEnemy) {
          const nR = Math.max(1, Math.round((rOut - rIn) / DOT_STEP));
          for (let ir = 0; ir < nR; ir++) {
            const rr = rIn + (ir + 0.5) * (rOut - rIn) / nR;
            const nA = Math.max(1, Math.round(rr * Math.abs(a1 - a0) / DOT_STEP));
            for (let ia = 0; ia < nA; ia++) dots.push(polar(rr, a0 + (ia + 0.5) * (a1 - a0) / nA));
          }
        }
        edge(arcLine(rOut, a0, a1, 3), ring + 1, line);
        if (ring > 0) edge(arcLine(rIn, a0, a1, 3), ring - 1, line);
        edge([polar(rIn, a1), polar(rOut, a1)], ring, line + 1);
        edge([polar(rIn, a0), polar(rOut, a0)], ring, line - 1);
      });
      let cx = 0, cy = 0, n = 0;
      sec.cells.forEach(([ring, line]) => { const rm = (ring + 0.5) * 100, am = ang(line + 0.5); cx += rm * Math.cos(am); cy += -rm * Math.sin(am); n++; });
      if (n) { cx /= n; cy /= n; }

      // Enemy territory is coloured per controlling faction: each cell goes to its nearest in-sector
      // enemy planet, then cells group by faction. A sector held by two enemies shows BOTH colours as
      // clean striped regions. (Super Earth / contested never fill -- handled by skipping non-enemy
      // sectors at draw time -- so home space stays blank.)
      let regions = null;
      if (isEnemy) {
        const eHere = PLANETS.filter((e) => e.p.sector === me && e.p.owner >= 2);
        const cellFac = tops.map((poly) => {
          let mx = 0, my = 0; for (const q of poly) { mx += q.x; my += q.y; } mx /= poly.length; my /= poly.length;
          let best = domEnemy, bd = Infinity;
          for (const e of eHere) { const dx = e.wx - mx, dy = e.wy - my, d = dx * dx + dy * dy; if (d < bd) { bd = d; best = e.p.owner; } }
          return best;
        });
        const facAt = {}; sec.cells.forEach(([r, l], ix) => { facAt[r + "," + l] = cellFac[ix]; });
        const facOf = (r, l) => { const k = r + "," + ((l + 24) % 24); return (k in facAt) ? facAt[k] : -1; };
        const byFac = {};
        sec.cells.forEach(([ring, line], ix) => {
          const f = cellFac[ix];
          const rg = byFac[f] || (byFac[f] = { fac: f, col: FAC_FILL[f] || facColor(f), idx: [], perim: [] });
          rg.idx.push(ix);
          // an edge is on this faction's territory perimeter wherever the neighbour cell isn't the
          // same faction — outer boundary AND the seam where it meets a second enemy faction.
          const a0 = ang(line), a1 = ang(line + 1), rIn = ring * 100, rOut = (ring + 1) * 100;
          if (facOf(ring + 1, line) !== f) rg.perim.push(arcLine(rOut, a0, a1, 3));
          if (ring > 0 && facOf(ring - 1, line) !== f) rg.perim.push(arcLine(rIn, a0, a1, 3));
          if (facOf(ring, line + 1) !== f) rg.perim.push([polar(rIn, a1), polar(rOut, a1)]);
          if (facOf(ring, line - 1) !== f) rg.perim.push([polar(rIn, a0), polar(rOut, a0)]);
        });
        regions = Object.keys(byFac).map((f) => byFac[f]);
      }
      return { tops, walls, risers, secEdges, dots, cx, cy, elev, tier, fillHex, wallHex, outline, alpha, se: isSE, enemy: isEnemy, available, active: st.camp, regions };
    });

    const NODE_POP = 0;
    const secElevById = {}; (DATA.sectors || []).forEach((sec, idx) => { secElevById[sec.i] = SECTORS[idx] ? SECTORS[idx].elev : 0; });
    PLANETS.forEach((e) => { const base = secElevById[e.p.sector] || 0; e.belev = base; e.elev = base + NODE_POP; });

    const pos = {}, own = {};
    PLANETS.forEach((e) => { pos[e.p.i] = e; own[e.p.i] = e.p.owner; });
    LINKS = [];
    (DATA.links || []).forEach(([a, b]) => { const A = pos[a], B = pos[b]; if (A && B) LINKS.push({ a: A, b: B, col: (own[a] === own[b] && own[a] >= 1) ? facColor(own[a]) : null }); });
    ATTACKS = [];
    (DATA.attacks || []).forEach((atk) => { const A = pos[atk.s], B = pos[atk.t]; if (A && B) ATTACKS.push({ a: A, b: B }); });

    SE_LINKS = LINKS.filter((l) => l.a.p.owner === 1 && l.b.p.owner === 1);
    MIXED_LINKS = LINKS.filter((l) => l.a.p.owner >= 1 && l.b.p.owner >= 1 && l.a.p.owner !== l.b.p.owner);
    const sums = {};
    DATA.planets.forEach((p) => { if (p.owner < 1) return; const s = sums[p.owner] || (sums[p.owner] = { x: 0, y: 0, n: 0 }); s.x += p.x * MAP_SCALE; s.y += -p.y * MAP_SCALE; s.n++; });
    LABELS = []; Object.keys(sums).forEach((f) => { const s = sums[f]; if (s.n < 3) return; LABELS.push({ t: facName(+f), cx: s.x / s.n, cy: s.y / s.n, col: facColor(+f), fid: +f }); });
    DSS = null;
    if (DATA.dss) { const e = byIndex[DATA.dss.planetIndex]; if (e) DSS = { wx: e.wx, wy: e.wy, belev: e.belev, elev: e.elev, name: DATA.dss.name, effects: DATA.dss.effects, sx: 0, sy: 0 }; }

    MO_MARKS = (((DATA.majorOrder && DATA.majorOrder.tasks) || [])
      .filter((t) => t.index != null && t.verb && byIndex[t.index])
      .map((t) => ({ index: t.index, verb: t.verb })));

    DEFENSE_MARKS = PLANETS.filter((e) => e.p.ev && e.p.ev.type === 1);

    FX_MARKS = PLANETS.concat(HIDDEN).filter((e) => e.p.fx && e.p.fx.length);
    SUBFAC_MARKS = PLANETS.filter((e) => e.p.subfac && e.p.subfac.length);

    const voidSites = FX_MARKS.filter((e) => e.p.fx.some((f) => f.t === "void"));
    PLANETS.concat(HIDDEN).forEach((e) => { e.voidCell = null; });
    if (voidSites.length) {
      const allPts = PLANETS.concat(HIDDEN).map((e) => ({ x: e.wx, y: e.wy }));
      let ext = 1000; allPts.forEach((p) => { const m = Math.max(Math.abs(p.x), Math.abs(p.y)); if (m > ext) ext = m; });
      const bound = ext * 2.5;
      voidSites.forEach((e) => { e.voidCell = voronoiCell(e.wx, e.wy, allPts, bound); });
    }

    GLOOM_LINKS = [];
    const gms = FX_MARKS.filter((e) => e.p.fx.some((f) => f.t === "gloom"));
    const _ll = (DATA.links || []).map(([a, b]) => { const A = byIndex[a], B = byIndex[b]; return (A && B) ? Math.hypot(A.wx - B.wx, A.wy - B.wy) : 0; }).filter((d) => d > 0).sort((x, y) => x - y);
    const GLOOM_REACH = (_ll.length ? _ll[_ll.length >> 1] : 1600) * 2.0;
    for (let a = 0; a < gms.length; a++) {
      for (let b = a + 1; b < gms.length; b++) {
        if (Math.hypot(gms[a].wx - gms[b].wx, gms[a].wy - gms[b].wy) > GLOOM_REACH) continue;
        const col = (gms[a].p.fx.find((f) => f.t === "gloom") || {}).c || "#DFAB20";
        GLOOM_LINKS.push({ a: gms[a], b: gms[b], c: col });
      }
    }

    const byPl = {};
    (DATA.fleets || []).forEach((f) => { if (f.planetIndex == null || !byIndex[f.planetIndex]) return; (byPl[f.planetIndex] = byPl[f.planetIndex] || []).push(f); });
    FLEET_MARKS = Object.keys(byPl).map((idx) => ({
      index: +idx,
      fleets: byPl[idx].map((f) => ({ fac: f.faction === 0 ? 1 : f.faction, lvl: f.level || 0, nm: f.name || "", raw: f })).sort((a, b) => b.lvl - a.lvl),
    }));
    sectorOrder = SECTORS.map((s, i) => i); lastRot = null;
  }

  let cloudW = 0, cloudH = 0;
  function fitAll(setHome) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    PLANETS.forEach((e) => { if (e.wx < minX) minX = e.wx; if (e.wx > maxX) maxX = e.wx; if (e.wy < minY) minY = e.wy; if (e.wy > maxY) maxY = e.wy; });
    const pad = 140;
    cloudW = (maxX - minX) + pad * 2; cloudH = (maxY - minY) + pad * 2;
    cam.x = (minX + maxX) / 2; cam.y = (minY + maxY) / 2; cam.zoom = 1; cam.pitch = 0.65; cam.rot = 0;
    baseScale = 0.92 * Math.min(cvW / cloudW, cvH / cloudH);
    if (setHome) HOME = { x: cam.x, y: cam.y, zoom: 1, pitch: 0.65, rot: 0 };
  }

  function resize() {
    const _tb = document.querySelector(".topbar");
    document.documentElement.style.setProperty("--hdr-h", ((_tb && _tb.offsetHeight) || 54) + "px");
    const r = wrap.getBoundingClientRect();
    cvW = Math.max(50, r.width || wrap.offsetWidth || 1100);
    cvH = Math.max(50, r.height || wrap.offsetHeight || 600);
    dpr = Math.min(2, window.devicePixelRatio || 1);
    renderDpr = interacting ? Math.min(INTERACT_DPR, dpr) : dpr;
    cv.width = Math.round(cvW * dpr); cv.height = Math.round(cvH * dpr);
    off.width = Math.round(cvW * renderDpr); off.height = Math.round(cvH * renderDpr);
    for (const k in hazPat) delete hazPat[k]; for (const k in dotPat) delete dotPat[k];
    cv.style.width = cvW + "px"; cv.style.height = cvH + "px";
    if (cloudW) baseScale = 0.92 * Math.min(cvW / cloudW, cvH / cloudH);
    staticKey = ""; render();
    marquee();
  }

  let staticKey = "";
  function camKey() {
    const rot = (((cam.rot % 360) + 360) % 360).toFixed(1);
    return [Math.round(cam.x), Math.round(cam.y), cam.zoom.toFixed(3), cam.pitch.toFixed(3), rot, cvW, cvH, renderDpr].join(",");
  }

  function setInteractive(on) {
    if (interacting === on) return;
    interacting = on;
    const nd = on ? Math.min(INTERACT_DPR, dpr) : dpr;
    if (nd !== renderDpr) {
      renderDpr = nd;
      off.width = Math.round(cvW * renderDpr); off.height = Math.round(cvH * renderDpr);
      for (const k in hazPat) delete hazPat[k]; for (const k in dotPat) delete dotPat[k]; for (const k in asciiPat) delete asciiPat[k];
      staticKey = "";
    }
    if (!on) render();
  }
  function pokeInteract() {
    startLoop();
    setInteractive(true);
    clearTimeout(interactTimer);
    interactTimer = setTimeout(() => setInteractive(false), 200);
  }
  let _zoomVel = 0, _lastZoom = 1, _warpMag = 0, _lastRTs = 0;
  function render(ts) {
    ts = ts || 0; syncCam();

    const dt = _lastRTs ? Math.min(50, ts - _lastRTs) : 16.7; _lastRTs = ts;
    _zoomVel = cam.zoom - _lastZoom; _lastZoom = cam.zoom;
    const zf = (_zoomVel * (16.7 / dt)) / Math.max(0.3, cam.zoom);
    const wtarget = Math.abs(zf) > 0.0008 ? Math.max(-1.5, Math.min(1.5, zf * 9)) : 0;
    _warpMag += (wtarget - _warpMag) * 0.3;
    if (Math.abs(_warpMag) < 0.01) _warpMag = 0;
    const key = camKey();
    if (key !== staticKey) { buildStatic(); staticKey = key; }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);

    ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawBackdrop(ctx, ts);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = off.width !== cv.width;
    ctx.drawImage(off, 0, 0, off.width, off.height, 0, 0, cv.width, cv.height);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawDynamic(ts);

  }

  let _stars = null, _starsKey = "", _starBuckets = null, _bgGrad = null, _vignette = null;
  function buildStars() {
    _stars = []; let s = 20261; const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
    const n = Math.min(300, Math.round(cvW * cvH / 6000));

    const NEARC = ["#eaf1ff", "#cfe0ee", "#ffffff", "#dfe8ff", "#ffeccf", "#cfe4ff"];
    for (let i = 0; i < n; i++) {
      const near = rnd() > 0.6;
      let col, ga, r;
      if (near) { col = NEARC[(rnd() * NEARC.length) | 0]; ga = 0.7; r = 0.7 + rnd() * 0.9; }
      else { const f = rnd();
        col = f < 0.45 ? ["#ff6a4d", "#ee5038", "#cf3a2e", "#ff7e5a"][(rnd() * 4) | 0]
            : f < 0.72 ? ["#ffb07a", "#ff9a5e", "#ffc28a"][(rnd() * 3) | 0]
                       : ["#c9b4ff", "#9ec6ff", "#86e0d8", "#e0c0ff"][(rnd() * 4) | 0];
        ga = 0.5; r = 0.45 + rnd() * 0.6; }
      _stars.push({ x: rnd() * cvW, y: rnd() * cvH, r, ga, p: near ? 0.06 + rnd() * 0.04 : 0.015 + rnd() * 0.02, ph: rnd() * 99, col });
    }

    _starBuckets = {};
    for (const st of _stars) { const k = st.col + st.ga; (_starBuckets[k] || (_starBuckets[k] = { col: st.col, ga: st.ga, list: [] })).list.push(st); }
  }

  let _galStars = null, _galNebula = null, _warpStars = null, _galHaze = null, _galHazeR = 0;
  function buildGalaxy3D() {
    const rng = (seed) => { let s = seed; return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }; };
    const TAU = Math.PI * 2, rnd = rng(8123), gss = () => rnd() + rnd() + rnd() - 1.5;

    const GROUPS = [["#fff0d2", 0.17], ["#ffe3b0", 0.09], ["#eef2ff", 0.4], ["#cdd8ff", 0.2], ["#9fc0ff", 0.55], ["#7d9ae8", 0.3], ["#ff9ad0", 0.62], ["#ff7ec0", 0.33]];
    _galStars = GROUPS.map(() => []); _galStars._groups = GROUPS;
    const push = (gi, x, y, z, sz) => _galStars[gi].push({ x, y, z, sz });
    const B = 0.30, WIND = Math.PI * 3.6, R0 = 70, MAXR = 1550;
    for (let i = 0; i < 2600; i++) {
      const arm = i % 2, t = Math.pow(rnd(), 0.62), th = t * WIND + arm * Math.PI + gss() * 0.30 + Math.PI / 2;
      const r = R0 * Math.exp(B * t * WIND) + gss() * MAXR * 0.04 * (0.3 + t);
      if (r > MAXR || r < R0 * 0.4) continue;
      const z = gss() * 110 * (0.35 + 0.65 * (1 - r / MAXR)), coreF = 1 - r / MAXR, br = rnd() < 0.5;
      const gi = rnd() < 0.05 ? (br ? 6 : 7) : (coreF > 0.66 ? (br ? 2 : 3) : (br ? 4 : 5));
      push(gi, Math.cos(th) * r, Math.sin(th) * r, z, 0.7 + (br ? 1.0 : 0.4) + coreF * 0.9);
    }
    for (let i = 0; i < 340; i++) {
      const u = rnd() * TAU, v = Math.acos(2 * rnd() - 1), rr = Math.pow(rnd(), 1.7) * 350, f = 1 - rr / 350, br = rnd() < 0.6;
      push(br ? 0 : 1, rr * Math.sin(v) * Math.cos(u), rr * Math.sin(v) * Math.sin(u), rr * Math.cos(v) * 0.6, 0.7 + (br ? 1.2 : 0.5) + f * 1.0);
    }
    _galNebula = [];

    const npal = [["#7a4dff", 0.04], ["#1f9fe8", 0.038], ["#ff3ea5", 0.03], ["#19d6c0", 0.032], ["#ff8fce", 0.028], ["#3a78ff", 0.038]];
    const NEB_MAX = MAXR * 0.72;
    for (let i = 0; i < 34; i++) {
      const arm = i % 2, t = 0.06 + 0.62 * rnd(), th = t * WIND + arm * Math.PI + gss() * 0.62 + Math.PI / 2, r = R0 * Math.exp(B * t * WIND);
      if (r > NEB_MAX) continue; const p = npal[(rnd() * npal.length) | 0];
      const edgeF = 1 - 0.72 * (r / NEB_MAX);
      _galNebula.push({ x: Math.cos(th) * r, y: Math.sin(th) * r, z: gss() * 90, rr: 130 + rnd() * 200, col: p[0], a: p[1] * edgeF });
    }

    { const HZ = 512, HR = MAXR; _galHaze = document.createElement("canvas"); _galHaze.width = _galHaze.height = HZ; _galHazeR = HR;
      const hg = _galHaze.getContext("2d"); hg.globalCompositeOperation = "lighter";
      const w2s = (w) => (w + HR) / (2 * HR) * HZ, r2s = (r) => r / (2 * HR) * HZ;
      for (const nb of _galNebula) { const X = w2s(nb.x), Y = w2s(nb.y), rr = r2s(nb.rr); const g = hg.createRadialGradient(X, Y, 0, X, Y, rr); g.addColorStop(0, hexA(nb.col, nb.a)); g.addColorStop(0.5, hexA(nb.col, nb.a * 0.4)); g.addColorStop(1, hexA(nb.col, 0)); hg.fillStyle = g; hg.beginPath(); hg.arc(X, Y, rr, 0, TAU); hg.fill(); }
      const bC = w2s(0), bR = r2s(300), bg2 = hg.createRadialGradient(bC, bC, 0, bC, bC, bR); bg2.addColorStop(0, "rgba(255,246,224,0.15)"); bg2.addColorStop(0.35, "rgba(255,224,176,0.06)"); bg2.addColorStop(1, "rgba(255,200,150,0)"); hg.fillStyle = bg2; hg.beginPath(); hg.arc(bC, bC, bR, 0, TAU); hg.fill();
    }
    _warpStars = [];
    { const rw = rng(20399); for (let i = 0; i < 440; i++) { const u = rw() * TAU, ct = 2 * rw() - 1, st = Math.sqrt(1 - ct * ct), rr = 0.28 + 0.72 * rw(); _warpStars.push({ x: st * Math.cos(u) * rr * 2500, y: st * Math.sin(u) * rr * 2500, z: ct * rr * 950, sz: 0.45 + rw() * 0.95 }); } }
  }

  function drawGalaxy3D(c, ts, mv) {
    if (!_galStars) buildGalaxy3D();
    const breath = mv ? 1 : 0.9 + 0.1 * Math.sin(ts / 2600), W = cvW, H = cvH, sc = _scale;
    const cx = cvW / 2, cy = cvH / 2, cax = cam.x, cay = cam.y, cc = _c, ss = _s, pit = cam.pitch, hf = Math.sqrt(1 - pit * pit);
    c.save(); c.globalCompositeOperation = "lighter";
    if (_galHaze) {
      const hX = cx + (-cax * cc + cay * ss) * sc, hY = cy + ((-cax * ss - cay * cc) * pit) * sc;
      c.save(); c.globalAlpha = breath; c.translate(hX, hY); c.scale(sc, sc * pit); c.rotate(cam.rot * Math.PI / 180);
      c.drawImage(_galHaze, -_galHazeR, -_galHazeR, _galHazeR * 2, _galHazeR * 2); c.restore();
    }
    const GROUPS = _galStars._groups, szK = 0.7 + 0.5 * Math.min(1.8, Math.sqrt(cam.zoom)), TAU = Math.PI * 2;

    const wm = _warpMag, aw = Math.min(1, Math.abs(wm) / 0.4);
    for (let gi = 0; gi < GROUPS.length; gi++) {
      const arr = _galStars[gi], n = arr.length; if (!n) continue;
      const dots = new Path2D(), streaks = wm ? new Path2D() : null;
      for (let k = 0; k < n; k++) {
        const s = arr[k], px = s.x - cax, py = s.y - cay;
        const X = cx + (px * cc - py * ss) * sc, Y = cy + ((px * ss + py * cc) * pit - s.z * hf) * sc;
        if (X < -4 || X > W + 4 || Y < -4 || Y > H + 4) continue;
        const r = s.sz * szK * 0.55; dots.moveTo(X + r, Y); dots.arc(X, Y, r, 0, TAU);
        if (wm) {
          const dx = X - cx, dy = Y - cy, dist = Math.hypot(dx, dy) || 1, ux = dx / dist, uy = dy / dist;
          const tlen = Math.min(dist, 70) * 0.4 * wm;
          streaks.moveTo(X, Y); streaks.lineTo(X - ux * tlen, Y - uy * tlen);
        }
      }
      c.globalAlpha = GROUPS[gi][1] * breath; c.fillStyle = GROUPS[gi][0]; c.fill(dots);
      if (wm) { c.globalAlpha = GROUPS[gi][1] * breath * 0.6 * aw; c.strokeStyle = GROUPS[gi][0]; c.lineWidth = 0.9; c.lineCap = "butt"; c.stroke(streaks); }
    }
    c.restore();
  }

  function galPitchNow() { return 0.58 + 0.34 * cam.pitch; }
  function galProject(elev, gp) {
    let px = -cam.x, py = -cam.y;
    if (elev) { const mag = elev * (1 - gp) / gp; px += -_s * mag; py += -_c * mag; }
    const rx = px * _c - py * _s, ry = (px * _s + py * _c) * gp;
    return { x: cvW / 2 + rx * _scale, y: cvH / 2 + ry * _scale };
  }

  let _shooting = [], _nextShoot = 0;
  function drawWarp(c, ts, mv) {
    if (!_warpStars) return;
    const W = cvW, H = cvH, sc = _scale, cx = cvW / 2, cy = cvH / 2, cax = cam.x, cay = cam.y, cc = _c, ss = _s, pit = cam.pitch, hf = Math.sqrt(1 - pit * pit);

    const wm = _warpMag, aw = Math.min(1, Math.abs(wm) / 0.4);
    c.save(); c.globalCompositeOperation = "lighter";
    const dots = new Path2D(), streaks = wm ? new Path2D() : null;
    for (const s of _warpStars) {
      const px = s.x - cax, py = s.y - cay;
      const X = cx + (px * cc - py * ss) * sc, Y = cy + ((px * ss + py * cc) * pit - s.z * hf) * sc;
      if (X < -3 || X > W + 3 || Y < -3 || Y > H + 3) continue;
      const r = s.sz; dots.moveTo(X + r, Y); dots.arc(X, Y, r, 0, Math.PI * 2);
      if (wm) {
        const dx = X - cx, dy = Y - cy, dist = Math.hypot(dx, dy) || 1, ux = dx / dist, uy = dy / dist;
        const tlen = Math.min(dist, 80) * 0.34 * wm;
        streaks.moveTo(X, Y); streaks.lineTo(X - ux * tlen, Y - uy * tlen);
      }
    }
    c.fillStyle = "#cfe0f5"; c.globalAlpha = mv ? 0.5 : 0.42 + 0.08 * Math.sin(ts / 2400); c.fill(dots);
    if (wm) { c.strokeStyle = "#cfe0f5"; c.globalAlpha = 0.5 * aw; c.lineWidth = 1; c.lineCap = "butt"; c.stroke(streaks); }
    drawShootingStars(c, ts, mv);
    c.restore();
  }

  function drawShootingStars(c, ts, mv) {
    if (mv) { _shooting.length = 0; return; }
    if (!_nextShoot) _nextShoot = ts + 1500;
    if (ts >= _nextShoot && _shooting.length < 3) {
      _nextShoot = ts + 2600 + Math.random() * 5200;
      const fromLeft = Math.random() < 0.5, ang = (fromLeft ? 0.18 : Math.PI - 0.18) + (Math.random() - 0.5) * 0.5, big = Math.random() < 0.18, spd = (0.9 + Math.random() * 0.8) * (big ? 1.25 : 1);
      const cr = Math.random(), pal = cr < 0.62 ? ["235,245,255", "160,200,255"] : cr < 0.78 ? ["200,255,235", "120,230,180"] : cr < 0.9 ? ["255,240,200", "255,200,120"] : ["255,210,240", "255,150,210"];
      _shooting.push({ x: fromLeft ? -20 : cvW + 20, y: Math.random() * cvH * 0.55 + cvH * 0.05, vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd * 0.6, t0: ts, life: (650 + Math.random() * 550) * (big ? 1.2 : 1), head: pal[0], tail: pal[1], big: big });
    }
    for (let i = _shooting.length - 1; i >= 0; i--) {
      const m = _shooting[i], age = ts - m.t0, u = age / m.life;
      if (u >= 1) { _shooting.splice(i, 1); continue; }
      const x = m.x + m.vx * age, y = m.y + m.vy * age, fade = Math.sin(u * Math.PI);
      const sp = Math.hypot(m.vx, m.vy) || 1, ux = m.vx / sp, uy = m.vy / sp, len = (26 + sp * 18) * (m.big ? 1.7 : 1) * (0.4 + 0.6 * fade);
      const grad = c.createLinearGradient(x, y, x - ux * len, y - uy * len);
      grad.addColorStop(0, "rgba(" + m.head + "," + 0.85 * fade + ")"); grad.addColorStop(1, "rgba(" + m.tail + ",0)");
      c.globalAlpha = 1; c.strokeStyle = grad; c.lineWidth = m.big ? 2.3 : 1.6; c.lineCap = "round";
      c.beginPath(); c.moveTo(x, y); c.lineTo(x - ux * len, y - uy * len); c.stroke();
      c.globalAlpha = fade; c.fillStyle = "#fff"; c.beginPath(); c.arc(x, y, m.big ? 2.1 : 1.5, 0, Math.PI * 2); c.fill();
    }
  }
  let _nebSprite = null, _nebKey = "", _nebM = 0, _nebW = 0, _nebH = 0;
  function buildNeb() {
    _nebKey = cvW + "x" + cvH;
    const M = 72, W = cvW + M * 2, H = cvH + M * 2, R = Math.max(cvW, cvH);

    const SCL = 0.3, SW = Math.max(16, Math.round(W * SCL)), SH = Math.max(16, Math.round(H * SCL));
    if (!_nebSprite) _nebSprite = document.createElement("canvas");
    _nebSprite.width = SW; _nebSprite.height = SH;
    const g2 = _nebSprite.getContext("2d");
    g2.clearRect(0, 0, SW, SH); g2.globalCompositeOperation = "lighter";
    const blob = (bx, by, r, col, a) => { const cx = (bx + M) * SCL, cy = (by + M) * SCL, rr = r * SCL; const g = g2.createRadialGradient(cx, cy, 0, cx, cy, rr);
      g.addColorStop(0, hexA(col, a)); g.addColorStop(1, hexA(col, 0));
      g2.fillStyle = g; g2.beginPath(); g2.arc(cx, cy, rr, 0, Math.PI * 2); g2.fill(); };

    blob(cvW * 0.66, cvH * 0.26, R * 0.5, "#3d2880", 0.05);
    blob(cvW * 0.26, cvH * 0.74, R * 0.46, "#125f78", 0.045);
    blob(cvW * 0.52, cvH * 0.6, R * 0.34, "#7a2c68", 0.028);
    _nebM = M; _nebW = W; _nebH = H;
  }
  function drawBackdrop(c, ts) {
    if (LOWFX) {   // flat dark base + a faint static grid; no stars / nebula / haze / parallax / glow
      c.fillStyle = "#060a12"; c.fillRect(0, 0, cvW, cvH);
      c.strokeStyle = "rgba(70,205,240,0.045)"; c.lineWidth = 1;
      const gs = 56;
      for (let x = (cvW / 2) % gs; x < cvW; x += gs) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, cvH); c.stroke(); }
      for (let y = (cvH / 2) % gs; y < cvH; y += gs) { c.beginPath(); c.moveTo(0, y); c.lineTo(cvW, y); c.stroke(); }
      return;
    }
    if (_starsKey !== cvW + "x" + cvH) { _starsKey = cvW + "x" + cvH; buildStars(); }
    const ox = cam.x, oy = cam.y, mv = RMOTION, R = Math.max(cvW, cvH);

    if (!REDUCED) {   // heavy parallax background (nebula / galaxy stars / warp) -- HIGH only
      if (_nebKey !== cvW + "x" + cvH) buildNeb();
      const dr = mv ? 0 : ts * 0.00018;
      const ndx = -ox * 0.012 + Math.sin(dr) * 10, ndy = -oy * 0.012 + Math.cos(dr * 0.8) * 8;
      c.save(); c.globalCompositeOperation = "lighter"; c.imageSmoothingEnabled = true; c.imageSmoothingQuality = "high";
      c.drawImage(_nebSprite, -_nebM + ndx, -_nebM + ndy, _nebW, _nebH);
      c.restore();
      drawGalaxy3D(c, ts, mv);
      drawWarp(c, ts, mv);
    }

    const gs = 48, gp = 0.06, scroll = mv ? 0 : ts * 0.004;
    const offX = ((-ox * gp + scroll) % gs + gs) % gs, offY = ((-oy * gp + scroll * 0.7) % gs + gs) % gs;
    const lit = 0.055 + 0.07 * (mv ? 0.5 : 0.5 + 0.22 * Math.sin(ts / 1500)), cxh = cvW / 2, cyh = cvH / 2;
    c.lineWidth = 1;
    for (let x = offX - gs; x < cvW; x += gs) { const f = 1 - Math.abs(x - cxh) / (cvW * 0.62); if (f > 0) { c.strokeStyle = "rgba(70,205,240," + lit * f + ")"; c.beginPath(); c.moveTo(x, 0); c.lineTo(x, cvH); c.stroke(); } }
    for (let y = offY - gs; y < cvH; y += gs) { const f = 1 - Math.abs(y - cyh) / (cvH * 0.62); if (f > 0) { c.strokeStyle = "rgba(70,205,240," + lit * f + ")"; c.beginPath(); c.moveTo(0, y); c.lineTo(cvW, y); c.stroke(); } }

    { const tw = (mv || interacting) ? 1 : 0.72 + 0.28 * Math.sin(ts / 700);
      for (const k in _starBuckets) {
        const b = _starBuckets[k], pth = new Path2D();
        for (const st of b.list) {
          const sx = ((st.x - ox * st.p) % cvW + cvW) % cvW, sy = ((st.y - oy * st.p) % cvH + cvH) % cvH;
          pth.moveTo(sx + st.r, sy); pth.arc(sx, sy, st.r, 0, Math.PI * 2);
        }
        c.fillStyle = b.col; c.globalAlpha = b.ga * tw; c.fill(pth);
      }
    }
    c.globalAlpha = 1;
    if (!mv && Math.sin(ts * 0.0008) > 0.97) { c.fillStyle = "rgba(70,205,240,0.06)"; c.fillRect(0, (ts * 0.6) % cvH, cvW, 2); }
  }

  function buildStatic() {
    const c = offCtx;
    c.setTransform(renderDpr, 0, 0, renderDpr, 0, 0);
    c.clearRect(0, 0, cvW, cvH);

    PLANETS.forEach((e) => { const g = project(e.wx, e.wy, e.belev || 0); e.gx = g.x; e.gy = g.y; const q = project(e.wx, e.wy, e.elev || 0); e.sx = q.x; e.sy = q.y; });
    HIDDEN.forEach((e) => { const q = project(e.wx, e.wy, 0); e.sx = q.x; e.sy = q.y; });
    if (DSS) { const g = project(DSS.wx, DSS.wy, DSS.belev || 0); DSS.gx = g.x; DSS.gy = g.y; const q = project(DSS.wx, DSS.wy, DSS.elev || 0); DSS.sx = q.x; DSS.sy = q.y; }

    if (LAYERS.sectors) { drawSectors(c); drawSectorOutlines(c); }
    drawGrid(c);
    drawStems(c);
    if (LAYERS.supply) drawLinks(c);
    if (LAYERS.sectors) drawBorders(c);

  }

  function fleetGlyph(c, x, y, fac, col) {
    c.strokeStyle = col; c.fillStyle = col; c.lineWidth = 1.4; c.lineJoin = "round";
    if (fac === 1) {
      c.beginPath(); c.moveTo(x - 5, y - 3); c.lineTo(x, y + 4); c.lineTo(x + 5, y - 3); c.stroke();
      c.beginPath(); c.moveTo(x - 5, y - 0.5); c.lineTo(x, y + 6.5); c.lineTo(x + 5, y - 0.5); c.stroke();
    } else if (fac === 2) {
      for (const p of [[0, -4], [-4, 2.5], [4, 2.5]]) { c.beginPath(); c.arc(x + p[0], y + p[1], 2, 0, Math.PI * 2); c.fill(); }
    } else if (fac === 3) {
      c.strokeRect(x - 4.5, y - 4.5, 9, 9); c.beginPath(); c.arc(x, y, 1.8, 0, Math.PI * 2); c.fill();
    } else if (fac === 4) {
      c.beginPath(); c.moveTo(x, y - 5); c.lineTo(x + 5, y + 4); c.lineTo(x - 5, y + 4); c.closePath(); c.stroke();
      c.beginPath(); c.arc(x, y + 0.5, 1.8, 0, Math.PI * 2); c.fill();
    } else { c.beginPath(); c.arc(x, y, 3, 0, Math.PI * 2); c.fill(); }
  }

  // Resilient image load: a flaky mobile fetch (or iOS Safari caching a failed response) used to
  // blank an asset permanently, since every loader cached failure forever. Retry a few times with a
  // cache-buster before giving up; calls done(img) on success or done(null) once attempts run out.
  function loadImage(src, done, tries) {
    tries = tries || 4;
    const im = new Image();
    im.onload = () => done(im);
    im.onerror = () => {
      if (--tries > 0) setTimeout(() => { im.src = src + (src.indexOf("?") < 0 ? "?" : "&") + "retry=" + (4 - tries); }, 500 * (4 - tries));
      else done(null);
    };
    im.src = src;
    return im;
  }

  const FLEET_ICONS = {}, FLEET_ICON_SRC = { 1: "img/fleets/fleet_humans.png", 2: "img/fleets/fleet_bugs.png", 3: "img/fleets/fleet_bots.png", 4: "img/fleets/fleet_squids.png", dss: "img/fleets/fleet_spacestation.png" };
  let _fleetIconsTried = false;
  function loadFleetIcons() {
    if (_fleetIconsTried) return; _fleetIconsTried = true;
    for (const k in FLEET_ICON_SRC) {
      loadImage(FLEET_ICON_SRC[k], (im) => {
        if (!im) { FLEET_ICONS[k] = false; return; }
        const S = 128, ICON = 80, cn = document.createElement("canvas"); cn.width = cn.height = S;
        const cc = cn.getContext("2d"); cc.imageSmoothingEnabled = true; cc.imageSmoothingQuality = "high";
        const r = Math.min(ICON / im.width, ICON / im.height), w = im.width * r, h = im.height * r, ox = (S - w) / 2, oy = (S - h) / 2;
        cc.shadowColor = k === "dss" ? "#46a4ff" : facColor(+k); cc.shadowBlur = 12;
        cc.drawImage(im, ox, oy, w, h); cc.drawImage(im, ox, oy, w, h);
        cc.shadowBlur = 0; cc.drawImage(im, ox, oy, w, h);
        FLEET_ICONS[k] = cn; staticKey = ""; render();
      });
    }
  }
  const fleetIcon = (fac) => FLEET_ICONS[fac === 0 ? 1 : fac];

  const TAG_ICON_IDS = new Set([1186, 1187, 1188, 1198, 1203, 1206, 1232, 1239, 1245, 1249, 1282, 1287, 1291, 1292, 1308, 1309, 1310, 1311, 1342, 1353, 1361, 1362, 1372, 1376, 1378, 1379, 2001, 2003, 2005, 2011, 2012, 2014]);
  const POI_TINT = "#e3edf4";

  function parsePoiConfig(cfg) {
    const arr = Array.isArray(cfg) ? cfg : (cfg && Array.isArray(cfg.poi_effect_ids) ? cfg.poi_effect_ids : []);
    return new Set(arr.map((v) => +v).filter((v) => v > 0));
  }
  const TAG_ICONS = {};
  function tagIcon(id, tint) {
    if (!TAG_ICON_IDS.has(id)) return false;
    const key = id + ":" + tint;
    if (key in TAG_ICONS) return TAG_ICONS[key] || null;
    TAG_ICONS[key] = undefined;
    loadImage("img/tags/" + id + ".png", (im) => {
      if (!im) { TAG_ICONS[key] = false; return; }
      const S = 72, cn = document.createElement("canvas"); cn.width = cn.height = S;
      const cc = cn.getContext("2d"); cc.imageSmoothingEnabled = true; cc.imageSmoothingQuality = "high";
      const r = Math.min(S / im.width, S / im.height) * 0.96, w = im.width * r, h = im.height * r;
      cc.drawImage(im, (S - w) / 2, (S - h) / 2, w, h);
      cc.globalCompositeOperation = "source-in"; cc.fillStyle = tint; cc.fillRect(0, 0, S, S);
      TAG_ICONS[key] = cn; staticKey = ""; render();
    });
    return null;
  }

  function drawPoiGlyph(c, x, y, s, tint) {
    c.save();
    c.translate(x, y); c.rotate(Math.PI / 4);
    c.lineJoin = "round"; c.fillStyle = hexA(tint, 0.18); c.strokeStyle = tint; c.lineWidth = 1.4;
    const r = s * 0.42; c.beginPath(); c.rect(-r, -r, 2 * r, 2 * r); c.fill(); c.stroke();
    c.rotate(-Math.PI / 4); c.fillStyle = tint; c.beginPath(); c.arc(0, 0, s * 0.12, 0, Math.PI * 2); c.fill();
    c.restore();
  }

  function drawPoi(c, id, x, y, s, tint) {
    const ic = tagIcon(id, tint);
    if (ic) c.drawImage(ic, x - s / 2, y - s / 2, s, s);
    else if (ic === false) drawPoiGlyph(c, x, y, s, tint);
  }

  function planetPOIs(p) {
    if (!p.effects) return [];
    const out = [];
    for (const e of p.effects) { if (e.id && POI_IDS.has(e.id)) out.push(e.id); }
    return out.slice(0, 3);
  }

  function starPath(c, cx, cy, r) {
    c.beginPath();
    for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.42 : r; const px = cx + Math.cos(a) * rr, py = cy + Math.sin(a) * rr; i ? c.lineTo(px, py) : c.moveTo(px, py); }
    c.closePath();
  }

  const HONEY = [[0, 0], [-0.86, -0.74], [0.86, -0.74], [-0.86, 0.74], [0.86, 0.74]];
  function drawStarRank(c, cx, cy, n, col, scl) {
    scl = scl || 1; n = Math.max(1, Math.min(5, n | 0));
    const sr = 2.55 * scl, gap = sr * 2.35;

    const halo = hexA(col, 0.55), core = lightHex(col, 0.78);
    c.save(); c.globalCompositeOperation = "lighter";
    for (let i = 0; i < n; i++) {
      const x = cx + HONEY[i][0] * gap, y = cy + HONEY[i][1] * gap;
      c.fillStyle = halo; starPath(c, x, y, sr * 1.9); c.fill();
      c.fillStyle = core; starPath(c, x, y, sr); c.fill();
    }
    c.restore();
  }

  let _fleetHits = [];
  function drawFleetPawns(c, ts) {
    loadFleetIcons();
    _fleetHits.length = 0;
    if (!FLEET_MARKS.length) return;

    const zf = Math.max(0.8, Math.min(1.28, Math.pow(cam.zoom, 0.5)));
    const SHIP = 17 * zf, W = cv.width / dpr, H = cv.height / dpr, nodeR = 7 * zf;
    const maxLv = (DATA.stats && DATA.stats.maxFleetLevel) || 18;
    c.save();
    c.imageSmoothingQuality = "high";
    c.font = "700 " + Math.round(9 * zf) + "px " + headFont(); c.textBaseline = "middle";
    FLEET_MARKS.forEach((m) => {
      const e = byIndex[m.index]; if (!e) return;
      if (e.sx < -60 || e.sx > W + 90 || e.sy < -40 || e.sy > H + 50) return;
      const fleets = m.fleets, n = Math.min(fleets.length, 4);
      const bob = (RMOTION || interacting) ? 0 : Math.sin(ts / 720 + e.sx * 0.05) * 1.2;

      const startX = e.sx + nodeR + 9 * zf, cellW = SHIP * 1.55, shipY = e.sy + bob;
      for (let i = 0; i < n; i++) {
        const f = fleets[i], col = facColor(f.fac), img = fleetIcon(f.fac);
        const px = startX + cellW * i + SHIP / 2, py = shipY;

        if (img) { const D = SHIP * (128 / 80); c.drawImage(img, px - D / 2, py - D / 2, D, D); }
        else { c.save(); c.translate(px, py); c.scale(1.4, 1.4); fleetGlyph(c, 0, 0, f.fac, col); c.restore(); }
        if (f.raw) _fleetHits.push({ x: px, y: py, fleet: f.raw });
        if (f.lvl > 0) {
          const stars = Math.max(1, Math.min(5, Math.round((f.lvl / maxLv) * 5)));
          drawStarRank(c, px + SHIP * 0.42, py - SHIP * 0.46, stars, col, zf * 0.7);
        }
      }
      if (fleets.length > 4) {
        c.globalCompositeOperation = "source-over"; c.textAlign = "left"; c.fillStyle = "#9fb4be";
        c.fillText("+" + (fleets.length - 4), startX + cellW * 4, shipY);
      }
    });
    c.restore();
  }

  function drawSubfactions(c, ts) {
    if (!LAYERS.subfactions || !SUBFAC_MARKS.length) return;
    loadFleetIcons();
    const zf = Math.max(0.8, Math.min(1.28, Math.pow(cam.zoom, 0.5)));
    const SHIP = 16 * zf, W = cv.width / dpr, H = cv.height / dpr, nodeR = 7 * zf;
    c.save();
    c.imageSmoothingQuality = "high";
    c.globalAlpha = 0.82;
    SUBFAC_MARKS.forEach((e) => {
      if (e.sx < -60 || e.sx > W + 90 || e.sy < -40 || e.sy > H + 50) return;
      const facs = e.p.subfac, n = Math.min(facs.length, 4);
      const bob = (RMOTION || interacting) ? 0 : Math.sin(ts / 720 + e.sx * 0.05) * 1.0;
      const startX = e.sx + nodeR + 9 * zf, cellW = SHIP * 1.4, shipY = e.sy + bob;
      for (let i = 0; i < n; i++) {
        const fac = facs[i] === 0 ? 1 : facs[i], img = fleetIcon(fac), col = facColor(fac);
        const px = startX + cellW * i + SHIP / 2, py = shipY;
        if (img) { const D = SHIP * (128 / 80); c.drawImage(img, px - D / 2, py - D / 2, D, D); }
        else { c.save(); c.translate(px, py); c.scale(1.3, 1.3); fleetGlyph(c, 0, 0, fac, col); c.restore(); }
      }
    });
    c.restore();
  }

  function drawSectors(c) {
    if (lastRot !== cam.rot) { sectorOrder.sort((a, b) => project(SECTORS[a].cx, SECTORS[a].cy, 0).y - project(SECTORS[b].cx, SECTORS[b].cy, 0).y); lastRot = cam.rot; }
    for (const i of sectorOrder) {
      const s = SECTORS[i];
      if (!s.enemy) continue;   // Super Earth / contested sectors render no fill or stripes (home space stays blank)

      if (s.wallHex && s.elev > 1) {
        const faces = [];
        for (const e of s.walls) faces.push([e, 0, s.elev, false]);
        if (s.risers) for (const rs of s.risers) faces.push([rs.pts, rs.lo, rs.hi, true]);
        const ctr = project(s.cx, s.cy, s.elev), LX = -0.34, LY = 1;
        for (const [pts, lo, hi, isRiser] of faces) {
          if (hi - lo < 2) continue;
          const m = pts[pts.length >> 1] || pts[0], mt = project(m.x, m.y, hi);
          let nx = mt.x - ctr.x, ny = mt.y - ctr.y; const nl = Math.hypot(nx, ny) || 1; nx /= nl; ny /= nl;
          if (ny < -0.12) continue;
          const shade = Math.max(0.24, Math.min(1, 0.5 + 0.56 * (nx * LX + ny * LY)));

          c.beginPath();
          for (let k = 0; k < pts.length; k++) { const q = project(pts[k].x, pts[k].y, lo); k ? c.lineTo(q.x, q.y) : c.moveTo(q.x, q.y); }
          for (let k = pts.length - 1; k >= 0; k--) { const q = project(pts[k].x, pts[k].y, hi); c.lineTo(q.x, q.y); }
          c.closePath();
          c.fillStyle = hexA(scaleHex(s.fillHex, 0.16 + 0.14 * shade), 0.9); c.fill();
          const wl = Math.max(1, Math.round(shade * (ASCII_RAMP.length - 1)));
          c.globalAlpha = 0.6 + 0.4 * shade; c.fillStyle = asciiTile(lightHex(s.fillHex, 0.45 + 0.5 * shade), wl, ASCII_WALL_CELL); c.fill(); c.globalAlpha = 1;

          const top = []; for (let k = 0; k < pts.length; k++) top.push(project(pts[k].x, pts[k].y, hi));
          const tracePath = () => { c.beginPath(); for (let k = 0; k < top.length; k++) { k ? c.lineTo(top[k].x, top[k].y) : c.moveTo(top[k].x, top[k].y); } c.stroke(); };
          c.save(); c.globalCompositeOperation = "lighter";
          c.lineWidth = 2.6; c.strokeStyle = hexA(s.fillHex, 0.1 + 0.2 * shade); tracePath();
          c.lineWidth = 1.1; c.strokeStyle = hexA(lightHex(s.fillHex, 0.7), (isRiser ? 0.4 : 0.3) + 0.42 * shade); tracePath();
          c.restore();
        }
      }

      s._scrCells = [];
      // Inactive sectors (no live campaign/event) recede so the active fronts read at a glance.
      const dim = s.active ? 1 : 0.55;
      // Fill each controlling-faction region with its own colour + hazard stripes (one region for a
      // single-enemy sector; two-up for a contested sector that two enemies share).
      for (const rg of (s.regions || [])) {
        const baseHex = s.active ? rg.col : scaleHex(rg.col, 0.72);
        c.beginPath();
        for (const ix of rg.idx) {
          const poly = s.tops[ix]; let mx = 0, my = 0;
          for (let k = 0; k < poly.length; k++) { const q = project(poly[k].x, poly[k].y, s.elev); k ? c.lineTo(q.x, q.y) : c.moveTo(q.x, q.y); mx += q.x; my += q.y; }
          s._scrCells.push([mx / poly.length, my / poly.length]);
        }
        c.fillStyle = "rgba(7,11,18,0.55)"; c.fill();
        c.fillStyle = hexA(baseHex, (0.34 + s.tier * 0.08) * dim); c.fill();
        c.globalAlpha = (0.38 + s.tier * 0.06) * dim; c.fillStyle = hazPattern(baseHex); c.fill(); c.globalAlpha = 1;
      }

    }
  }

  function drawSectorOutlines(c) {
    c.save(); c.lineJoin = "round"; c.lineCap = "round"; c.lineWidth = 1;
    for (const i of sectorOrder) {
      const s = SECTORS[i];
      if (!s.secEdges || !s.secEdges.length || !s.enemy) continue;
      const col = lightHex(s.fillHex, 0.4);
      c.strokeStyle = hexA(col, 0.2);
      c.beginPath();
      for (const pts of s.secEdges) {
        for (let k = 0; k < pts.length; k++) { const q = project(pts[k].x, pts[k].y, s.elev); k ? c.lineTo(q.x, q.y) : c.moveTo(q.x, q.y); }
      }
      c.stroke();
    }
    c.restore();
  }

  function drawSectorFX(c, ts) {

    if (interacting || RMOTION || REDUCED) return;
    c.save(); c.globalCompositeOperation = "lighter";
    for (const s of SECTORS) {
      if (!s.enemy || !s._scrCells) continue;
      c.fillStyle = s.fillHex; const cells = s._scrCells, n = cells.length, off = s.cx * 0.0009 + s.cy * 0.0013;
      for (let ci = 0; ci < n; ci++) {
        const bx = cells[ci][0], by = cells[ci][1];
        for (let e = 0; e < 2; e++) {
          const ph = ((ts / 2400) + e * 0.5 + ci * 0.37 + off) % 1;
          if (ph < 0.06) continue;
          const ex = bx + Math.sin(ph * 6.28 + ci) * 3, ey = by - ph * 24, fade = Math.sin(ph * Math.PI);
          c.globalAlpha = fade * 0.55; c.beginPath(); c.arc(ex, ey, 1.2, 0, Math.PI * 2); c.fill();
        }
      }
    }
    c.globalAlpha = 1; c.restore();
  }

  function strokeEdge(c, pts, el) {
    c.beginPath();
    for (let k = 0; k < pts.length; k++) { const q = project(pts[k].x, pts[k].y, el); k ? c.lineTo(q.x, q.y) : c.moveTo(q.x, q.y); }
    c.stroke();
  }

  // Each enemy faction's territory is outlined with a glowing border in its own colour. Where two
  // enemies share a sector their perimeters run side by side, so the seam reads in BOTH colours.
  // Static (cached) layer, so the glow/shadowBlur cost is paid once per camera move, not per frame.
  function drawBorders(c) {
    c.save(); c.lineJoin = "round"; c.lineCap = "round"; c.shadowBlur = 0;
    for (const s of SECTORS) {                                   // pass 1: wide faint underlay
      if (!s.enemy || !s.regions) continue;
      for (const rg of s.regions) { c.strokeStyle = hexA(rg.col, 0.16); c.lineWidth = 5;
        for (const pts of rg.perim) strokeEdge(c, pts, s.elev); }
    }
    for (const s of SECTORS) {                                   // pass 2: bright glowing core
      if (!s.enemy || !s.regions) continue;
      for (const rg of s.regions) { c.shadowColor = rg.col; c.shadowBlur = 7; c.strokeStyle = hexA(rg.col, 0.92); c.lineWidth = 1.7;
        for (const pts of rg.perim) strokeEdge(c, pts, s.elev); }
    }
    c.shadowBlur = 0; c.restore();
  }
  function hazPattern(fillHex) {
    if (hazPat[fillHex]) return hazPat[fillHex];
    const t = document.createElement("canvas"); t.width = t.height = 15;
    const g = t.getContext("2d");
    g.fillStyle = fillHex; g.fillRect(0, 0, 15, 15);

    const h = fillHex.replace("#", ""), n = parseInt(h.length === 3 ? h.replace(/(.)/g, "$1$1") : h, 16);
    const dr = ((n >> 16) & 255) * 0.42, dg = ((n >> 8) & 255) * 0.42, db = (n & 255) * 0.42;
    g.strokeStyle = `rgba(${dr | 0},${dg | 0},${db | 0},0.45)`; g.lineWidth = 3; g.lineCap = "butt";
    g.beginPath(); g.moveTo(0, 15); g.lineTo(15, 0); g.moveTo(-15, 15); g.lineTo(15, -15); g.moveTo(0, 30); g.lineTo(30, 0); g.stroke();
    const p = offCtx.createPattern(t, "repeat"); hazPat[fillHex] = p; return p;
  }

  function asciiTile(col, level, cell) {
    const key = col + "|" + level + "|" + cell;
    if (asciiPat[key]) return asciiPat[key];
    const ch = ASCII_RAMP[level] || " ";
    const t = document.createElement("canvas"); t.width = t.height = cell;
    const g = t.getContext("2d");
    if (ch !== " ") {
      g.fillStyle = col; g.font = "700 " + Math.round(cell * 0.95) + "px " + ASCII_FONT;
      g.textAlign = "center"; g.textBaseline = "middle";
      g.fillText(ch, cell / 2, cell * 0.56);
    }
    const p = offCtx.createPattern(t, "repeat"); asciiPat[key] = p; return p;
  }

  const _DOT_T = [9, 7, 5];
  function dotPattern(fillHex, tier) {
    const key = fillHex + "|" + tier;
    if (dotPat[key]) return dotPat[key];
    const h = fillHex.replace("#", ""), n = parseInt(h.length === 3 ? h.replace(/(.)/g, "$1$1") : h, 16);
    const R = (n >> 16) & 255, G = (n >> 8) & 255, B = n & 255;
    const dk = (f) => "rgba(" + (R * f | 0) + "," + (G * f | 0) + "," + (B * f | 0) + ",";
    const lt = (f) => "rgba(" + ((R + (255 - R) * f) | 0) + "," + ((G + (255 - G) * f) | 0) + "," + ((B + (255 - B) * f) | 0) + ",";
    const T = _DOT_T[tier] || 7, a = 0.55 + tier * 0.18;
    const t = document.createElement("canvas"); t.width = t.height = T;
    const g = t.getContext("2d");
    g.fillStyle = dk(0.42) + "0.55)"; g.fillRect(0, 0, T, T);
    const cx = T / 2, cy = T / 2, r = 1.7;
    const grd = g.createRadialGradient(cx, cy, 0, cx, cy, r);
    grd.addColorStop(0, lt(0.5) + Math.min(1, a + 0.3) + ")");
    grd.addColorStop(0.5, dk(1) + a + ")");
    grd.addColorStop(1, dk(1) + "0)");
    g.fillStyle = grd; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
    const p = offCtx.createPattern(t, "repeat"); dotPat[key] = p; return p;
  }

  function drawGrid(c) {
    c.save();
    c.strokeStyle = "rgba(70,164,255,0.10)"; c.lineWidth = 1; c.setLineDash([4, 6]);
    for (let ring = 1; ring <= 10; ring++) { c.beginPath(); for (let i = 0; i <= 72; i++) { const a = (i / 72) * Math.PI * 2; const q = project(ring * 100 * Math.cos(a), ring * 100 * Math.sin(a), 0); i ? c.lineTo(q.x, q.y) : c.moveTo(q.x, q.y); } c.stroke(); }
    c.setLineDash([]); c.strokeStyle = "rgba(70,164,255,0.07)";
    const o = project(0, 0, 0);
    for (let n = 0; n < 24; n++) { const a = ang(n); const e = project(1000 * Math.cos(a), -1000 * Math.sin(a), 0); c.beginPath(); c.moveTo(o.x, o.y); c.lineTo(e.x, e.y); c.stroke(); }
    c.restore();
  }

  function drawLinks(c) {

    const zf = Math.max(0, Math.min(1, (cam.zoom - 0.55) / (0.95 - 0.55)));
    if (zf <= 0.01) return;
    c.save(); c.lineCap = "round";
    const settled = !interacting, oc = (o) => o >= 1 ? facColor(o) : "#46a4ff";
    LINKS.forEach((l) => {
      const ax = l.a.sx, ay = l.a.sy, bx = l.b.sx, by = l.b.sy;
      if (settled) {

        const ca = oc(l.a.p.owner), cb = oc(l.b.p.owner), mixed = l.a.p.owner !== l.b.p.owner;
        const g = c.createLinearGradient(ax, ay, bx, by);
        g.addColorStop(0, ca);
        if (!mixed) g.addColorStop(0.5, lightHex(ca, 0.45));   // same owner: keep the bright flowing core
        g.addColorStop(1, cb);                                 // cross-faction: pure 2-colour blend so BOTH read
        c.strokeStyle = g;
        c.globalAlpha = (mixed ? 0.17 : (l.col ? 0.18 : 0.12)) * zf; c.lineWidth = mixed ? 4.6 : 4.2; c.beginPath(); c.moveTo(ax, ay); c.lineTo(bx, by); c.stroke();
        c.globalAlpha = (mixed ? 0.8 : (l.col ? 0.7 : 0.5)) * zf;   c.lineWidth = mixed ? 1.5 : 1.3; c.beginPath(); c.moveTo(ax, ay); c.lineTo(bx, by); c.stroke();
      } else {
        const col = l.col || "#46a4ff";
        c.strokeStyle = hexA(col, (l.col ? 0.5 : 0.35) * zf); c.lineWidth = 1.25; c.beginPath(); c.moveTo(ax, ay); c.lineTo(bx, by); c.stroke();
      }
    });
    c.globalAlpha = 1; c.restore();
  }

  function drawStems(c) {
    c.save(); c.lineWidth = 1;
    for (const e of PLANETS) {
      const d = Math.hypot(e.gx - e.sx, e.gy - e.sy); if (d < 1.4) continue;

      c.globalAlpha = Math.min(0.22, 0.06 + d * 0.008); c.fillStyle = "#04080f";
      c.beginPath(); c.ellipse(e.gx, e.gy, 3.2, 1.5, 0, 0, Math.PI * 2); c.fill();
      c.globalAlpha = Math.min(0.32, 0.12 + d * 0.009); c.strokeStyle = hexA(facColor(e.p.owner), 0.55);
      c.beginPath(); c.moveTo(e.gx, e.gy); c.lineTo(e.sx, e.sy); c.stroke();
    }
    c.globalAlpha = 1; c.restore();
  }

  function drawFactionSigils(c) {
    if (!LABELS.length) return;
    let a = (1.55 - cam.zoom) / (1.55 - 0.68); a = a < 0 ? 0 : a > 1 ? 1 : a;
    if (a <= 0.02) return;
    const ease = a * a * (3 - 2 * a);
    loadEmblems();
    const W = cv.width / dpr, H = cv.height / dpr, EM = 56;
    c.save();
    c.textAlign = "center"; c.textBaseline = "middle"; c.lineJoin = "round"; c.miterLimit = 2;
    const ls = "letterSpacing" in c;
    for (const l of LABELS) {
      const q = project(l.cx, l.cy, 0);
      if (q.x < -120 || q.x > W + 120 || q.y < -120 || q.y > H + 120) continue;
      const sig = FAC_SIGIL[l.fid];
      if (sig) { c.globalAlpha = ease; c.drawImage(sig, q.x - EM, q.y - EM - 14, EM * 2, EM * 2); }
      c.globalAlpha = 1;
      // Scale the faction name with zoom so it reads clean when zoomed out (was a fixed 22px
      // that looked oversized at galaxy scale) and grows a little as you zoom toward the front.
      const fs = clamp(11 + cam.zoom * 6, 11, 18);
      if (ls) c.letterSpacing = "2px";
      c.font = "700 " + Math.round(fs) + "px " + headFont();
      const ny = q.y + EM - 30;
      c.lineWidth = Math.max(3, fs * 0.22); c.strokeStyle = "rgba(2,6,11," + (0.82 * ease).toFixed(3) + ")"; c.strokeText(l.t, q.x, ny);
      c.fillStyle = hexA(lightHex(l.col, 0.32), ease); c.fillText(l.t, q.x, ny);
      if (ls) c.letterSpacing = "0px";
    }
    c.restore();
  }

  let STAR_CFG = {};

  const STAR_PAL = ["#fff0d0", "#ffe39c", "#ffd07e", "#ffbe6a", "#ffa858", "#ff8f54", "#ff7c64", "#ff6a52", "#dbeaff", "#d8f0ff", "#c2d8ff", "#a8c4ff", "#92acff", "#7e98ff", "#cdb8ff"];
  const STAR_LAYOUT = { single: [[0, 0]], binary: [[-1, 0], [1, 0]], trinary: [[0, -1], [-0.87, 0.6], [0.87, 0.6]] };
  const _starCache = {}, _starSprite = {};
  function starRnd(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function starFor(p) {
    let s = _starCache[p.i]; if (s) return s;
    const rnd = starRnd((p.i + 1) * 2654435761), tr = rnd();
    s = {
      color: STAR_PAL[(rnd() * STAR_PAL.length) | 0],
      type: tr > 0.93 ? "trinary" : tr > 0.78 ? "binary" : "single",

      scale: 0.62 + rnd() * 0.66,
      brightness: 0.72 + rnd() * 0.4,
    };
    const cfg = STAR_CFG[p.i] || STAR_CFG[(p.name || "").toUpperCase()];
    if (cfg) { if (cfg.color) s.color = cfg.color; if (cfg.type) s.type = cfg.type; if (cfg.scale != null) s.scale = cfg.scale; if (cfg.brightness != null) s.brightness = cfg.brightness; }
    _starCache[p.i] = s; return s;
  }

  function starSprite(col) {
    if (_starSprite[col]) return _starSprite[col];
    const S = 48, cv = document.createElement("canvas"); cv.width = cv.height = S; const g = cv.getContext("2d"), m = S / 2;
    const halo = g.createRadialGradient(m, m, 0, m, m, m); halo.addColorStop(0, hexA(col, 0.55)); halo.addColorStop(0.32, hexA(col, 0.14)); halo.addColorStop(1, hexA(col, 0));
    g.fillStyle = halo; g.fillRect(0, 0, S, S);
    g.globalCompositeOperation = "lighter"; g.lineWidth = 1;
    const gh = g.createLinearGradient(0, m, S, m); gh.addColorStop(0, hexA(col, 0)); gh.addColorStop(0.5, hexA(col, 0.55)); gh.addColorStop(1, hexA(col, 0));
    g.strokeStyle = gh; g.beginPath(); g.moveTo(2, m); g.lineTo(S - 2, m); g.stroke();
    const gv = g.createLinearGradient(m, 0, m, S); gv.addColorStop(0, hexA(col, 0)); gv.addColorStop(0.5, hexA(col, 0.55)); gv.addColorStop(1, hexA(col, 0));
    g.strokeStyle = gv; g.beginPath(); g.moveTo(m, 2); g.lineTo(m, S - 2); g.stroke();
    const core = g.createRadialGradient(m, m, 0, m, m, S * 0.22); core.addColorStop(0, "rgba(255,255,255,1)"); core.addColorStop(0.4, "rgba(255,255,255,0.96)"); core.addColorStop(0.7, hexA(col, 0.95)); core.addColorStop(1, hexA(col, 0));
    g.fillStyle = core; g.beginPath(); g.arc(m, m, S * 0.22, 0, Math.PI * 2); g.fill();
    _starSprite[col] = cv; return cv;
  }
  function drawNodeStar(c, x, y, star, hot, ts) {
    const sprite = starSprite(star.color), comps = STAR_LAYOUT[star.type] || STAR_LAYOUT.single;
    const tw = (RMOTION || interacting) ? 1 : 0.86 + 0.14 * Math.sin(ts / 600 + x * 0.05);

    const zf = Math.max(0.5, Math.min(2.6, Math.pow(cam.zoom, 0.72)));
    const base = (hot ? 20 : 15) * star.scale * zf, sep = base * 0.26, s2 = base * (comps.length > 1 ? 0.72 : 1);
    const wm = _warpMag;
    if (wm) {
      const cx = cvW / 2, cy = cvH / 2, dx = x - cx, dy = y - cy, dist = Math.hypot(dx, dy) || 1, ux = dx / dist, uy = dy / dist;
      const tlen = Math.min(dist, 90) * 0.34 * wm, aw = Math.min(1, Math.abs(wm) / 0.4);
      c.globalAlpha = Math.min(1, star.brightness * 0.85 * aw);
      c.strokeStyle = star.color; c.lineWidth = Math.max(1.2, base * 0.12); c.lineCap = "round";
      c.beginPath(); c.moveTo(x, y); c.lineTo(x - ux * tlen, y - uy * tlen); c.stroke();
    }
    c.globalAlpha = Math.min(1, star.brightness * tw);
    for (const cmp of comps) c.drawImage(sprite, x + cmp[0] * sep - s2 / 2, y + cmp[1] * sep - s2 / 2, s2, s2);
  }
  function drawPlanetDots(c, ts) {
    if (LOWFX) {   // low mode: flat, consistent owner-coloured circles instead of glowing stars
      const zf = Math.max(0.5, Math.min(2.2, Math.pow(cam.zoom, 0.6))), r = 3.1 * zf;
      c.save();
      for (const e of PLANETS) {
        const p = e.p;
        if (p.fx && p.fx.some((f) => f.t === "black_hole")) continue;
        c.fillStyle = facColor(p.owner);
        c.beginPath(); c.arc(e.sx, e.sy, r, 0, Math.PI * 2); c.fill();
        c.lineWidth = 1; c.strokeStyle = "rgba(4,8,14,0.7)"; c.stroke();
      }
      c.restore();
      return;
    }
    c.save(); c.globalCompositeOperation = "lighter";
    for (const e of PLANETS) {
      const p = e.p;
      if (p.fx && p.fx.some((f) => f.t === "black_hole")) continue;
      drawNodeStar(c, e.sx, e.sy, starFor(p), p.active || !!p.ev, ts);
    }
    c.globalAlpha = 1; c.restore();
  }

  function drawPlanetRings(c) {
    PLANETS.forEach((e) => {
      const p = e.p; if (!p.active && !p.ev) return;
      const rr = (p.active ? 5.5 : 4) + 3.4;
      const threat = p.ev ? facColor(p.ev.race) : facColor(p.owner);
      c.lineWidth = 2; c.strokeStyle = hexA(threat, 0.30);
      c.beginPath(); c.arc(e.sx, e.sy, rr, 0, Math.PI * 2); c.stroke();
      const pct = clamp((p.ev ? evPlayerPct(p) : p.lib) / 100, 0, 1);
      if (pct > 0.004) {
        const a0 = -Math.PI / 2, a1 = a0 + pct * Math.PI * 2;
        c.strokeStyle = SE_COL.bg;
        c.lineWidth = 4.6; c.globalAlpha = 0.26; c.beginPath(); c.arc(e.sx, e.sy, rr, a0, a1); c.stroke();
        c.globalAlpha = 1; c.lineWidth = 2.4; c.beginPath(); c.arc(e.sx, e.sy, rr, a0, a1); c.stroke();
      }
    });
  }

  const _EMBLEM_SRC = { 1: "fac_superearth", 2: "fac_terminid", 3: "fac_automaton", 4: "fac_illuminate" };
  const FAC_EMBLEM = {}, FAC_SIGIL = {}; let _emblemTried = false;
  function loadEmblems() {
    if (_emblemTried) return; _emblemTried = true;
    for (const id of [1, 2, 3, 4]) {
      loadImage("img/icons/" + _EMBLEM_SRC[id] + ".png", (im) => {
        if (!im) { FAC_EMBLEM[id] = false; return; }
        const S = 96, cn = document.createElement("canvas"); cn.width = cn.height = S;
        const cc = cn.getContext("2d"); cc.imageSmoothingEnabled = true; cc.imageSmoothingQuality = "high";
        const r = Math.min(S / im.width, S / im.height) * 0.9, w = im.width * r, h = im.height * r;
        cc.drawImage(im, (S - w) / 2, (S - h) / 2, w, h);
        cc.globalCompositeOperation = "source-in"; cc.fillStyle = "#0a0f17"; cc.fillRect(0, 0, S, S);
        FAC_EMBLEM[id] = cn;

        const SS = 256, sc = document.createElement("canvas"); sc.width = sc.height = SS;
        const sg = sc.getContext("2d"); sg.imageSmoothingEnabled = true; sg.imageSmoothingQuality = "high";
        const vg = sg.createRadialGradient(SS / 2, SS / 2, 0, SS / 2, SS / 2, SS * 0.42);
        vg.addColorStop(0, "rgba(4,8,14,0.32)"); vg.addColorStop(0.7, "rgba(4,8,14,0.1)"); vg.addColorStop(1, "rgba(4,8,14,0)");
        sg.fillStyle = vg; sg.fillRect(0, 0, SS, SS);
        const tmp = document.createElement("canvas"); tmp.width = tmp.height = SS;
        const tg = tmp.getContext("2d"); tg.imageSmoothingEnabled = true; tg.imageSmoothingQuality = "high";
        const es = SS * 0.52, er = Math.min(es / im.width, es / im.height), ew = im.width * er, eh = im.height * er;
        tg.drawImage(im, (SS - ew) / 2, (SS - eh) / 2, ew, eh);
        tg.globalCompositeOperation = "source-in"; tg.fillStyle = lightHex(facColor(id), 0.4); tg.fillRect(0, 0, SS, SS);
        sg.shadowColor = facColor(id); sg.shadowBlur = 26; sg.drawImage(tmp, 0, 0); sg.drawImage(tmp, 0, 0);
        sg.shadowBlur = 0; sg.drawImage(tmp, 0, 0); sg.drawImage(tmp, 0, 0);
        FAC_SIGIL[id] = sc;
        staticKey = ""; render();
      });
    }
  }

  const plateFac = (p) => (p.owner >= 2 ? p.owner : (p.campRace || (p.ev && p.ev.race) || 2));

  const crestOf = (p, camp) => camp ? plateFac(p) : (p.owner >= 1 ? p.owner : (p.campRace || (p.ev && p.ev.race) || 2));
  const lightHex = (hex, f) => { const h = hex.replace("#", ""), n = parseInt(h.length === 3 ? h.replace(/(.)/g, "$1$1") : h, 16), m = (v) => (v + (255 - v) * f) | 0; return "#" + ((1 << 24) + (m((n >> 16) & 255) << 16) + (m((n >> 8) & 255) << 8) + m(n & 255)).toString(16).slice(1); };

  const scaleHex = (hex, k) => { const h = hex.replace("#", ""), n = parseInt(h.length === 3 ? h.replace(/(.)/g, "$1$1") : h, 16), m = (v) => Math.max(0, Math.min(255, v * k)) | 0; return "#" + ((1 << 24) + (m((n >> 16) & 255) << 16) + (m((n >> 8) & 255) << 8) + m(n & 255)).toString(16).slice(1); };
  const PLATE = { h: 23, padx: 7, crest: 15, gap: 9, poiW: 17 };
  function plateMetrics(c, name, poiN) {
    c.font = "700 12px " + headFont();
    const poiSeg = poiN ? (8 + poiN * PLATE.poiW) : 0;
    const blockW = PLATE.padx * 2 + PLATE.crest;
    const w = blockW + PLATE.gap + c.measureText(name).width + poiSeg + PLATE.padx + 4;
    return { w, poiSeg, blockW };
  }

  function drawNamePlate(c, cx, topY, p, name, fac, pois) {
    const col = facColor(fac), poiN = pois ? pois.length : 0;
    const m = plateMetrics(c, name, poiN), w = m.w, h = PLATE.h, x = cx - w / 2, y = topY, blockW = m.blockW;
    const ch = 6, cyr = y + h / 2;
    c.save(); c.lineJoin = "round"; c.miterLimit = 2;
    const panel = () => { c.beginPath(); c.moveTo(x, y); c.lineTo(x + w - ch, y); c.lineTo(x + w, y + ch); c.lineTo(x + w, y + h); c.lineTo(x, y + h); c.closePath(); };

    panel(); c.fillStyle = "rgba(11,15,22,0.97)"; c.fill();

    c.fillStyle = scaleHex(col, 0.78); c.fillRect(x, y, blockW, h);
    c.fillStyle = "rgba(255,255,255,0.16)"; c.fillRect(x, y, blockW, 1.5);
    c.fillStyle = "rgba(0,0,0,0.18)"; c.fillRect(x, y + h - 1.5, blockW, 1.5);

    const emb = FAC_EMBLEM[fac];
    if (emb) c.drawImage(emb, x + PLATE.padx, cyr - PLATE.crest / 2, PLATE.crest, PLATE.crest);

    panel(); c.lineWidth = 1.2; c.strokeStyle = hexA(col, 0.78); c.stroke();
    c.fillStyle = hexA(lightHex(col, 0.45), 0.95); c.fillRect(x + blockW, y, 1.6, h);

    c.font = "700 12px " + headFont(); c.textAlign = "left"; c.textBaseline = "middle";
    const nx = x + blockW + PLATE.gap;
    c.fillStyle = "rgba(0,0,0,0.6)"; c.fillText(name, nx + 0.7, cyr + 1.4);
    c.fillStyle = "#eef5fb"; c.fillText(name, nx, cyr + 0.5);

    if (poiN) {
      let px = x + w - PLATE.padx - poiN * PLATE.poiW;
      c.fillStyle = hexA(col, 0.35); c.fillRect(px - 6, y + 4, 1, h - 8);
      for (const id of pois) { drawPoi(c, id, px + 8, cyr, 15, POI_TINT); px += PLATE.poiW; }
    }
    if (p.home != null) { c.fillStyle = "#FFE900"; c.beginPath(); c.moveTo(x + w - ch, y); c.lineTo(x + w, y + ch); c.lineTo(x + w - ch, y + ch); c.closePath(); c.fill(); }
    c.restore();
  }

  function fmtHMS(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const hh = String(Math.floor(s / 3600)).padStart(2, "0");
    const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
    const ss = String(Math.floor(s % 60)).padStart(2, "0");
    return hh + ":" + mm + ":" + ss;
  }

  // Shared on-map countdown chip. Both event timers and Major Order target timers call
  // this, so they share one style; only `accent` differs (faction vs MO gold). It shows a
  // clock glyph + HH:MM:SS only -- the planet's own objective label (DEFEND / HOLD) already
  // says the action, so repeating the verb here was redundant. <1h or expired -> red + pulse.
  function drawMapTimer(c, cx, anchorY, deadlineMs, accent, ts) {
    const left = deadlineMs - Date.now();
    const expired = left <= 0, urgent = !expired && left < 3600000;
    const acc = (expired || urgent) ? "#FF5A5A" : accent;
    const pulse = urgent ? (0.6 + 0.4 * Math.abs(Math.sin(ts / 360))) : 1;
    const txt = expired ? "EXPIRED" : fmtHMS(left);
    c.save();
    c.font = "700 11px " + headFont();
    c.textAlign = "left"; c.textBaseline = "middle"; c.lineCap = "round";
    const padL = 7, iconR = 5, gap = 6, padR = 9, h = 18, ch = 5;
    const tw = c.measureText(txt).width, w = padL + iconR * 2 + gap + tw + padR;
    const x = cx - w / 2, y = anchorY - h, midY = y + h / 2;
    c.beginPath();
    c.moveTo(x, y); c.lineTo(x + w - ch, y); c.lineTo(x + w, y + ch);
    c.lineTo(x + w, y + h); c.lineTo(x, y + h); c.closePath();
    c.fillStyle = "rgba(9,13,20,0.95)"; c.fill();
    c.lineWidth = 1; c.strokeStyle = hexA(acc, 0.85 * pulse); c.stroke();
    // clock glyph (accent colour) in place of the old DEFEND/HOLD word
    const ccx = x + padL + iconR;
    c.strokeStyle = hexA(acc, pulse); c.lineWidth = 1.4;
    c.beginPath(); c.arc(ccx, midY, iconR, 0, Math.PI * 2); c.stroke();
    c.beginPath(); c.moveTo(ccx, midY); c.lineTo(ccx, midY - iconR * 0.62); c.moveTo(ccx, midY); c.lineTo(ccx + iconR * 0.5, midY + iconR * 0.18); c.stroke();
    const tx = x + padL + iconR * 2 + gap;
    c.fillStyle = "rgba(0,0,0,0.6)"; c.fillText(txt, tx + 0.7, midY + 1.3);
    c.fillStyle = "#eef5fb"; c.fillText(txt, tx, midY + 0.4);
    c.restore();
  }

  function drawNotableLabels(c) {
    if (cam.zoom < 0.8) return;
    loadEmblems();
    const W = cv.width / dpr, H = cv.height / dpr, ccx = W / 2, ccy = H / 2;
    const campZoom = cam.zoom > 1.7;
    const nameZoom = cam.zoom > 2.5;
    const lift = 11 + 9 * Math.min(2, Math.pow(cam.zoom, 0.6));
    const placed = [];
    const collide = (x0, y0, x1, y1) => { for (const b of placed) { if (x0 < b.x1 && x1 > b.x0 && y0 < b.y1 && y1 > b.y0) return true; } return false; };
    c.save();
    c.lineJoin = "round"; c.miterLimit = 2;

    const plates = [];
    PLANETS.forEach((e) => {
      if (e.sx < -90 || e.sx > W + 90 || e.sy < -40 || e.sy > H + 70) return;
      if (!(e.p.active || e.p.ev) || !campZoom) return;
      plates.push({ e, p: e.p, d2: (e.sx - ccx) * (e.sx - ccx) + (e.sy - ccy) * (e.sy - ccy) });
    });
    plates.sort((a, b) => a.d2 - b.d2);
    let budget = Math.max(4, Math.min(10, Math.round((cam.zoom - 1.5) * 6)));
    for (const it of plates) {
      if (budget <= 0) break;
      const pois = planetPOIs(it.p), name = it.p.name || "";
      const w = plateMetrics(c, name, pois.length).w, cx = it.e.sx, top = it.e.sy + lift;
      const x0 = cx - w / 2 - 4, y0 = top - 3, x1 = cx + w / 2 + 4, y1 = top + PLATE.h + 3;
      if (collide(x0, y0, x1, y1)) continue;
      placed.push({ x0, y0, x1, y1 }); budget--;
      drawNamePlate(c, cx, top, it.p, name, crestOf(it.p, true), pois);
    }

    if (nameZoom) {
      c.font = "700 11px " + headFont(); c.textAlign = "center"; c.textBaseline = "top";
      for (const e of PLANETS) {
        const p = e.p; if (p.active || p.ev) continue;
        if (e.sx < -40 || e.sx > W + 40 || e.sy < -20 || e.sy > H + 50) continue;
        const nm = p.name || ""; if (!nm) continue;
        const cx = e.sx, top = e.sy + lift, tw = c.measureText(nm).width;
        if (collide(cx - tw / 2 - 4, top - 2, cx + tw / 2 + 4, top + 14)) continue;
        placed.push({ x0: cx - tw / 2 - 4, y0: top - 2, x1: cx + tw / 2 + 4, y1: top + 14 });
        c.lineWidth = 3; c.strokeStyle = "rgba(3,7,12,0.82)"; c.strokeText(nm, cx, top);
        c.fillStyle = "#cfe0ea"; c.fillText(nm, cx, top);
        const pois = planetPOIs(p);
        if (pois.length) { let px = cx - pois.length * 8 + 8; for (const id of pois) { drawPoi(c, id, px, top + 21, 14, POI_TINT); px += 16; } }
      }
    }
    c.restore();
  }

  function drawQuestMark(c, sx, sy, col, label, fillA) {
    c.save(); c.translate(sx, sy); c.rotate(Math.PI / 4);
    c.fillStyle = hexA(col, fillA == null ? 0.14 : fillA); c.strokeStyle = col; c.lineWidth = 1.6;
    c.fillRect(-7, -7, 14, 14); c.strokeRect(-7, -7, 14, 14); c.rotate(-Math.PI / 4);
    c.fillStyle = col; c.beginPath(); c.arc(0, 0, 3.2, 0, Math.PI * 2); c.fill();
    c.font = "700 11px " + headFont(); c.textAlign = "center"; c.lineJoin = "round"; c.miterLimit = 2;
    c.lineWidth = 3; c.strokeStyle = "rgba(0,0,0,0.72)"; c.strokeText(label, 0, 22);
    c.fillStyle = col; c.fillText(label, 0, 22); c.restore();
  }
  function drawDSSMark(c, ts) {
    loadFleetIcons();

    const zf = Math.max(0.8, Math.min(1.28, Math.pow(cam.zoom, 0.5)));
    const SHIP = 17 * zf, nodeR = 7 * zf;
    const bob = (RMOTION || interacting) ? 0 : Math.sin(ts / 720 + DSS.sx * 0.05) * 1.2;
    const px = DSS.sx + nodeR + 8 * zf + SHIP / 2, py = DSS.sy + bob;
    const img = FLEET_ICONS["dss"];
    if (!img) { drawQuestMark(c, px, py, "#46a4ff", "DSS", 0.14); return; }
    c.save();
    c.imageSmoothingQuality = "high";
    const D = SHIP * (128 / 80);
    c.drawImage(img, px - D / 2, py - D / 2, D, D);
    c.restore();
    c.save();
    c.font = "700 " + Math.round(9 * zf) + "px " + headFont(); c.textAlign = "center"; c.textBaseline = "middle"; c.lineJoin = "round"; c.miterLimit = 2;
    const ly = py + SHIP / 2 + 8 * zf;
    c.lineWidth = 2.6; c.strokeStyle = "rgba(0,0,0,0.82)"; c.strokeText("DSS", px, ly);
    c.fillStyle = "#9fd6ff"; c.fillText("DSS", px, ly);
    c.restore();

    const dssStars = (DATA.dss && DATA.dss.effects) || 5;
    drawStarRank(c, px + SHIP * 0.5, py - SHIP * 0.5, dssStars, "#46a4ff", zf * 0.8);
  }
  function drawObjectives(c) {

    MO_MARKS.forEach((m) => { const e = byIndex[m.index]; if (e) drawQuestMark(c, e.sx, e.sy, "#FFE900", m.verb, 0.16); });

    DEFENSE_MARKS.forEach((e) => drawQuestMark(c, e.sx, e.sy, facColor(e.p.ev.race), "DEFEND", 0.16));
  }
  // Embedder hook (lore editor): a green diamond + entry-count on planets that have lore, driven by
  // window.__loreMarks = { planetIndex: count }. Unset on the public site, so this is a no-op there.
  function drawLoreMarks(c) {
    const marks = window.__loreMarks; if (!marks) return;
    for (const k in marks) { const n = marks[k]; if (!n) continue; const e = byIndex[k]; if (e) drawQuestMark(c, e.sx, e.sy, "#5ce372", "" + n, 0.18); }
  }

  function drawEnvFX(ts) {
    if (!FX_MARKS.length || !window.EnvFX) return;
    const R = 19 * Math.min(2.5, Math.max(0.85, Math.sqrt(cam.zoom)));
    const W = cv.width / dpr, H = cv.height / dpr;
    const hsh = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

    const bridgeCap = 7;
    for (const lk of GLOOM_LINKS) {
      const ax = lk.a.sx, ay = lk.a.sy, dx = lk.b.sx - ax, dy = lk.b.sy - ay;
      const dist = Math.hypot(dx, dy) || 1, steps = Math.min(bridgeCap, Math.floor(dist / (R * 0.8)));
      const px = -dy / dist, py = dx / dist;
      for (let i = 1; i <= steps; i++) {
        const sd = lk.a.p.i * 131 + lk.b.p.i * 17 + i * 7, t = i / (steps + 1);
        const perp = (hsh(sd) - 0.5) * R * 1.2;
        const rr = R * (0.45 + 0.4 * hsh(sd + 5));
        window.EnvFX.gloomBlob(ctx, ax + dx * t + px * perp, ay + dy * t + py * perp, rr, ts, RMOTION, interacting, sd);
      }
    }
    for (const e of FX_MARKS) {
      const fx = e.p.fx;
      const hasVoid = e.voidCell && fx.some((f) => f.t === "void");
      if (hasVoid) drawVoidCell(e, ts);

      const rest = hasVoid ? fx.filter((f) => f.t !== "void") : fx;
      if (rest.length && !(e.sx < -R * 1.6 || e.sx > W + R * 1.6 || e.sy < -R * 1.6 || e.sy > H + R * 1.6)) {
        window.EnvFX.draw(ctx, rest, e.sx, e.sy, R, ts, RMOTION, interacting || REDUCED, e.p.i);
      }
    }
    drawVoidOutline(ts);
  }

  // Glowing boundary outline around the whole void region. Only edges belonging to a SINGLE void
  // cell are stroked -- shared internal seams appear in two cells and are skipped -- so adjacent
  // cells read as one mass with a clean glitch-magenta edge (the Blackwall border the user asked for).
  function drawVoidOutline(ts) {
    const cells = FX_MARKS.filter((e) => e.voidCell && e.voidCell.length >= 3 && e.p.fx.some((f) => f.t === "void"));
    if (!cells.length) return;
    const col = "#b06bff";   // WarForge-style vivid violet edge glow
    const edges = {};
    const key = (a, b) => { const ax = Math.round(a.x), ay = Math.round(a.y), bx = Math.round(b.x), by = Math.round(b.y); return (ax < bx || (ax === bx && ay <= by)) ? ax + "_" + ay + "_" + bx + "_" + by : bx + "_" + by + "_" + ax + "_" + ay; };
    cells.forEach((e) => { const cl = e.voidCell; for (let i = 0; i < cl.length; i++) { const a = cl[i], b = cl[(i + 1) % cl.length], k = key(a, b); (edges[k] || (edges[k] = { n: 0, a: a, b: b })).n++; } });
    const flick = RMOTION ? 1 : 0.78 + 0.22 * Math.sin(ts / 240);
    ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.lineCap = "round"; ctx.lineJoin = "round";
    const passes = [[3.4, 0.14], [1.3, 0.62 * flick]];
    for (const pass of passes) {
      ctx.lineWidth = pass[0]; ctx.strokeStyle = hexA(col, pass[1]); ctx.beginPath();
      for (const k in edges) { const ed = edges[k]; if (ed.n !== 1) continue; const A = project(ed.a.x, ed.a.y, 0), B = project(ed.b.x, ed.b.y, 0); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); }
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawVoidCell(e, ts) {
    const cell = e.voidCell, col = (e.p.fx.find((f) => f.t === "void") || {}).c || "#A124E3";
    if (!cell || cell.length < 3) {
      const R = 19 * Math.min(2.5, Math.max(0.85, Math.sqrt(cam.zoom)));
      window.EnvFX.draw(ctx, [{ t: "void", c: col }], e.sx, e.sy, R, ts, RMOTION, interacting || REDUCED, e.p.i);
      return;
    }
    const W = cv.width / dpr, H = cv.height / dpr;
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    const pp = new Array(cell.length);
    for (let i = 0; i < cell.length; i++) { const q = project(cell[i].x, cell[i].y, 0); pp[i] = q; if (q.x < x0) x0 = q.x; if (q.x > x1) x1 = q.x; if (q.y < y0) y0 = q.y; if (q.y > y1) y1 = q.y; }
    if (x1 < 0 || y1 < 0 || x0 > W || y0 > H) return;
    ctx.save();
    ctx.beginPath(); ctx.moveTo(pp[0].x, pp[0].y); for (let i = 1; i < pp.length; i++) ctx.lineTo(pp[i].x, pp[i].y); ctx.closePath();
    ctx.clip();   // clip only - the union boundary is stroked once in drawVoidOutline (no internal seams)
    const o = project(0, 0, 0);   // anchor the field pattern to the map so it doesn't swim when panning
    window.EnvFX.voidFieldRect(ctx, Math.max(0, x0), Math.max(0, y0), Math.min(W, x1), Math.min(H, y1), col, ts, RMOTION, interacting || REDUCED, o.x, o.y);
    ctx.restore();
  }

  function drawDynamic(ts) {

    if (!LOWFX) {
      const o = project(0, 0, 0), breathe = 0.85 + 0.15 * Math.sin(ts / 900), R = 30 * Math.sqrt(cam.zoom) * breathe;
      const g = ctx.createRadialGradient(o.x, o.y, 0, o.x, o.y, R);
      g.addColorStop(0, "rgba(210,245,255,0.92)"); g.addColorStop(0.18, "rgba(120,210,240,0.5)"); g.addColorStop(0.5, "rgba(0,160,210,0.18)"); g.addColorStop(1, "rgba(0,120,180,0)");
      ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.fillStyle = g; ctx.beginPath(); ctx.arc(o.x, o.y, R, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "rgba(235,250,255,0.95)"; ctx.beginPath(); ctx.arc(o.x, o.y, Math.max(2.2, 3 * Math.sqrt(cam.zoom)), 0, Math.PI * 2); ctx.fill(); ctx.restore();
    }

    drawSectorFX(ctx, ts);

    if (LAYERS.effects) drawEnvFX(ts);

    if (LAYERS.attacks && ATTACKS.length) {
      ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.lineCap = "round";
      ATTACKS.forEach((a, ai) => {
        const ax = a.a.sx, ay = a.a.sy, bx = a.b.sx, by = a.b.sy;
        const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len;
        const col = facColor(a.a.p.owner);   // attacker = the source planet's owner -> conduit matches the attacking faction (purple = Illuminate, red = Automaton, etc.)
        const cg = ctx.createLinearGradient(ax, ay, bx, by);
        cg.addColorStop(0, hexA(col, 0.12)); cg.addColorStop(1, hexA(col, 0.55));
        ctx.strokeStyle = cg; ctx.lineWidth = 4.5; ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
        ctx.strokeStyle = hexA(col, 0.7); ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
        if (!REDUCED) {   // moving conduit pulses + endpoint glow are fluff -> bare lines in medium/low
          const PULSES = 3, tail = Math.min(len * 0.45, 64);
          for (let i = 0; i < PULSES; i++) {
            const t = RMOTION ? (i + 0.5) / PULSES : ((ts / 2600) + i / PULSES) % 1;
            const hx = ax + dx * t, hy = ay + dy * t, tl = tail * Math.min(1, t * 5);
            const tg = ctx.createLinearGradient(hx - ux * tl, hy - uy * tl, hx, hy);
            tg.addColorStop(0, hexA(col, 0)); tg.addColorStop(1, "rgba(255,255,255,0.9)");
            ctx.strokeStyle = tg; ctx.lineWidth = 2.3; ctx.beginPath(); ctx.moveTo(hx - ux * tl, hy - uy * tl); ctx.lineTo(hx, hy); ctx.stroke();
            ctx.fillStyle = "rgba(255,255,255,0.95)"; ctx.beginPath(); ctx.arc(hx, hy, 2.1, 0, Math.PI * 2); ctx.fill();
          }
          const ip = RMOTION ? 0.6 : 0.5 + 0.5 * Math.sin(ts / 680 + ai);
          ctx.fillStyle = hexA(col, 0.12 + 0.13 * ip); ctx.beginPath(); ctx.arc(bx, by, 4.5 + 2.5 * ip, 0, Math.PI * 2); ctx.fill();
        }
      });
      ctx.restore();
    }

    if (LAYERS.supply && !interacting && !RMOTION && !REDUCED && SE_LINKS.length) {
      const W = cv.width / dpr, H = cv.height / dpr;
      ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.fillStyle = "#9be6ff";
      for (let k = 0, drawn = 0; k < SE_LINKS.length && drawn < 44; k += 2) {
        const l = SE_LINKS[k], ax = l.a.sx, ay = l.a.sy, bx = l.b.sx, by = l.b.sy;
        if ((ax < 0 && bx < 0) || (ax > W && bx > W) || (ay < 0 && by < 0) || (ay > H && by > H)) continue;
        const t = ((ts * 0.00012) + k * 0.16) % 1;
        ctx.globalAlpha = 0.26 * Math.sin(t * Math.PI);
        ctx.beginPath(); ctx.arc(ax + (bx - ax) * t, ay + (by - ay) * t, 1.3, 0, Math.PI * 2); ctx.fill();
        drawn++;
      }
      ctx.restore();
    }

    // cross-faction supply lines flow with a particle that changes colour at the midpoint (A's -> B's)
    if (LAYERS.supply && !interacting && !RMOTION && !REDUCED && MIXED_LINKS.length) {
      const W = cv.width / dpr, H = cv.height / dpr, oc2 = (o) => o >= 1 ? facColor(o) : "#46a4ff";
      ctx.save(); ctx.globalCompositeOperation = "lighter";
      for (let k = 0, drawn = 0; k < MIXED_LINKS.length && drawn < 40; k++) {
        const l = MIXED_LINKS[k], ax = l.a.sx, ay = l.a.sy, bx = l.b.sx, by = l.b.sy;
        if ((ax < 0 && bx < 0) || (ax > W && bx > W) || (ay < 0 && by < 0) || (ay > H && by > H)) continue;
        const t = ((ts * 0.00013) + k * 0.21) % 1;
        ctx.globalAlpha = 0.5 * Math.sin(t * Math.PI); ctx.fillStyle = t < 0.5 ? oc2(l.a.p.owner) : oc2(l.b.p.owner);
        ctx.beginPath(); ctx.arc(ax + (bx - ax) * t, ay + (by - ay) * t, 1.7, 0, Math.PI * 2); ctx.fill();
        drawn++;
      }
      ctx.globalAlpha = 1; ctx.restore();
    }

    ctx.save(); ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = 1;
    drawPlanetDots(ctx, ts);
    if (LAYERS.objectives) drawPlanetRings(ctx);   // campaign threat + liberation-progress rings
    if (LAYERS.objectives) drawObjectives(ctx);
    if (window.__loreMarks) drawLoreMarks(ctx);
    if (LAYERS.objectives && DSS) drawDSSMark(ctx, ts);
    if (FLEETS_ENABLED) drawFleetPawns(ctx, ts);
    drawSubfactions(ctx, ts);
    if (LAYERS.text) { drawFactionSigils(ctx); drawNotableLabels(ctx); }
    ctx.restore();

    if (LAYERS.objectives) { const pulse = 1 - ((ts / 2400) % 1), R = 6 + (1 - pulse) * 16;
      const ring = (sx, sy, col) => { ctx.strokeStyle = hexA(col, pulse * 0.7); ctx.lineWidth = 1.4; ctx.beginPath(); ctx.arc(sx, sy, R, 0, Math.PI * 2); ctx.stroke(); };
      const gl = (sx, sy, col, seed) => { if (!interacting) drawMarkGlitch(ctx, sx, sy, col, ts, seed); };
      if (DSS) { ring(DSS.sx, DSS.sy, "#46a4ff"); }
      MO_MARKS.forEach((m) => { const e = byIndex[m.index]; if (e) { ring(e.sx, e.sy, "#FFE900"); gl(e.sx, e.sy, "#FFE900", m.index + 2); } }); }

    if (LAYERS.objectives) PLANETS.forEach((e) => { if (e.p.ev) drawUrgentPulse(ctx, e.sx, e.sy, facColor(e.p.ev.race), ts, e.p.i); });

    if (LAYERS.timers) {
      const W = cv.width / dpr, H = cv.height / dpr, moDl = window.__MO_DEADLINE || 0;
      const chips = {};
      const add = (idx, chip) => { if (byIndex[idx]) (chips[idx] = chips[idx] || []).push(chip); };
      // Major Order targets share the single order deadline -> the whole objective ticks in sync.
      if (moDl > 0) MO_MARKS.forEach((m) => add(m.index, { dl: moDl, accent: "#FFE900" }));
      // Event planets use their own expiry; the faction accent (and the planet's own DEFEND/CLAIM
      // label below) convey the action, so the chip itself stays a pure countdown.
      PLANETS.forEach((e) => { const p = e.p; if (p.ev && p.ev.expireEpoch) { const mm = tipMeta(p); add(p.i, { dl: p.ev.expireEpoch * 1000, accent: facColor(mm.dispFac) }); } });
      Object.keys(chips).forEach((idx) => {
        const e = byIndex[idx]; if (!e || e.sx < -160 || e.sx > W + 160 || e.sy < -120 || e.sy > H + 120) return;
        let ay = e.sy - 13;
        chips[idx].forEach((cp) => { drawMapTimer(ctx, e.sx, ay, cp.dl, cp.accent, ts); ay -= 20; });
      });
    }

    const hi = selected != null ? selected : hovered;
    if (hi !== _hiLast) { _hiLast = hi; _hiT0 = ts; }
    if (hi != null && byIndex[hi]) drawHighlightLines(ctx, byIndex[hi].sx, byIndex[hi].sy, ts, RMOTION ? 1 : Math.min(1, (ts - _hiT0) / 280));

    const pulse = (ts / 2200) % 1;
    PLANETS.forEach((e) => {
      const p = e.p;
      if (LAYERS.objectives && p.active && !p.ev) { const col = facColor(p.owner); ctx.strokeStyle = hexA(col, 0.85 * (1 - pulse)); ctx.lineWidth = 1.4; ctx.beginPath(); ctx.arc(e.sx, e.sy, 7 + pulse * 9, 0, Math.PI * 2); ctx.stroke(); }
      if (selected === p.i) drawSelectRing(ctx, e.sx, e.sy, ts);
      else if (hovered === p.i) drawReticle(ctx, e.sx, e.sy, ts);
    });
  }

  let _hiLast = null, _hiT0 = 0;
  function drawHighlightLines(c, sx, sy, ts, sweep) {
    if (sweep <= 0) return;
    const gap = 22, margin = 48;
    const eU = Math.max(0, sy - margin) * sweep, eD = Math.max(0, cvH - margin - sy) * sweep;
    const eL = Math.max(0, sx - margin) * sweep, eR = Math.max(0, cvW - margin - sx) * sweep;
    c.save(); c.globalCompositeOperation = "lighter";
    const col = "#5fe9ff", a = 0.2 * (0.8 + 0.2 * Math.sin(ts / 380));
    c.strokeStyle = hexA(col, a); c.lineWidth = 1;
    c.beginPath();
    c.moveTo(sx, sy - gap); c.lineTo(sx, sy - gap - eU);
    c.moveTo(sx, sy + gap); c.lineTo(sx, sy + gap + eD);
    c.moveTo(sx - gap, sy); c.lineTo(sx - gap - eL, sy);
    c.moveTo(sx + gap, sy); c.lineTo(sx + gap + eR, sy);
    c.stroke();
    if (sweep > 0.6) {
      c.strokeStyle = hexA(col, a * 1.4); const tk = 4;
      c.beginPath();
      c.moveTo(sx - tk, sy - gap - eU); c.lineTo(sx + tk, sy - gap - eU);
      c.moveTo(sx - tk, sy + gap + eD); c.lineTo(sx + tk, sy + gap + eD);
      c.moveTo(sx - gap - eL, sy - tk); c.lineTo(sx - gap - eL, sy + tk);
      c.moveTo(sx + gap + eR, sy - tk); c.lineTo(sx + gap + eR, sy + tk);
      c.stroke();
    }
    c.restore();
  }

  function drawSelectRing(c, x, y, ts) {
    const TAU = Math.PI * 2, t = RMOTION ? 0 : ts, r = 11 + (RMOTION ? 0 : 0.6 * Math.sin(t / 320));
    c.save(); c.globalCompositeOperation = "lighter"; c.lineCap = "round";
    c.lineWidth = 3.2; c.strokeStyle = "rgba(120,235,255,0.18)"; c.beginPath(); c.arc(x, y, r, 0, TAU); c.stroke();
    c.lineWidth = 1.5; c.strokeStyle = "rgba(214,250,255,0.95)"; c.beginPath(); c.arc(x, y, r, 0, TAU); c.stroke();
    const ro = r + 4;
    c.lineWidth = 1.2; c.strokeStyle = "rgba(95,233,255,0.7)"; c.setLineDash([3, 7]); c.lineDashOffset = -t * 0.02;
    c.beginPath(); c.arc(x, y, ro, 0, TAU); c.stroke(); c.setLineDash([]);
    const rot = t * 0.0009; c.lineWidth = 1.6; c.strokeStyle = "rgba(184,248,255,0.92)";
    for (let k = 0; k < 4; k++) { const a = rot + k * (TAU / 4), ca = Math.cos(a), sa = Math.sin(a); c.beginPath(); c.moveTo(x + ca * (ro + 1), y + sa * (ro + 1)); c.lineTo(x + ca * (ro + 5), y + sa * (ro + 5)); c.stroke(); }
    c.restore();
  }
  function drawReticle(c, sx, sy, ts) {
    const r = 10 + (RMOTION ? 0 : 1.4 * (0.5 + 0.5 * Math.sin(ts / 300))), len = 4;
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    const brackets = (col, ox) => {
      c.strokeStyle = col;
      for (const k of corners) {
        c.beginPath();
        c.moveTo(sx + ox + k[0] * (r - len), sy + k[1] * r);
        c.lineTo(sx + ox + k[0] * r, sy + k[1] * r);
        c.lineTo(sx + ox + k[0] * r, sy + k[1] * (r - len));
        c.stroke();
      }
    };
    c.save(); c.lineWidth = 1.4; c.lineCap = "round";
    if (!RMOTION && Math.sin(ts * 0.045) > 0.88) { brackets("rgba(255,43,94,0.5)", -1.6); brackets("rgba(39,224,255,0.5)", 1.6); }
    brackets("rgba(178,248,255,0.95)", 0);
    c.restore();
  }

  function drawMarkGlitch(c, sx, sy, col, ts, seed) {
    const PER = 0.06, ph = (ts * 0.0004 + seed * 0.137) % 1;
    if (ph > PER) return;
    const f = ph / PER, j = (f < 0.5 ? 1.6 : -1.6);
    c.save(); c.lineWidth = 1.3;
    c.strokeStyle = "rgba(255,43,94,0.5)"; c.save(); c.translate(sx - j, sy); c.rotate(Math.PI / 4); c.strokeRect(-7, -7, 14, 14); c.restore();
    c.strokeStyle = "rgba(39,224,255,0.5)"; c.save(); c.translate(sx + j, sy); c.rotate(Math.PI / 4); c.strokeRect(-7, -7, 14, 14); c.restore();
    c.strokeStyle = hexA(col, 0.6); c.lineWidth = 1;
    const ty = sy - 7 + f * 14;
    c.beginPath(); c.moveTo(sx - 8, ty); c.lineTo(sx + 8, ty); c.stroke();
    c.restore();
  }

  function drawUrgentPulse(c, sx, sy, col, ts, seed) {
    const T = 2200, base = ts / T + seed * 0.37, beat = base % 1;
    c.save(); c.globalCompositeOperation = "lighter"; c.lineCap = "round";
    for (let k = 0; k < 3; k++) {
      const ph = (base + k / 3) % 1, r = 8 + ph * 30, a = (1 - ph) * (1 - ph) * 0.9;
      c.strokeStyle = hexA(col, a); c.lineWidth = 2.4 * (1 - ph) + 0.4;
      c.beginPath(); c.arc(sx, sy, r, 0, Math.PI * 2); c.stroke();
    }
    const fl = Math.pow(1 - beat, 5);
    if (fl > 0.02) { c.globalAlpha = fl * 0.55; c.fillStyle = col; c.beginPath(); c.arc(sx, sy, 8.5, 0, Math.PI * 2); c.fill(); c.globalAlpha = 1; }
    const conv = 24 - beat * 10;
    c.strokeStyle = hexA(col, 0.35 + 0.55 * (1 - beat)); c.lineWidth = 1.6; c.beginPath();
    for (let d = 0; d < 4; d++) {
      const ang = d * Math.PI / 2 + Math.PI / 4, ix = sx + Math.cos(ang) * conv, iy = sy + Math.sin(ang) * conv, w = 5;
      c.moveTo(ix + Math.cos(ang + 0.5) * w, iy + Math.sin(ang + 0.5) * w);
      c.lineTo(ix, iy);
      c.lineTo(ix + Math.cos(ang - 0.5) * w, iy + Math.sin(ang - 0.5) * w);
    }
    c.stroke(); c.restore();
  }
  function hexRGB(hex) { const h = hex.replace("#", ""); const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16); return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`; }
  const hexA = (hex, a) => `rgba(${hexRGB(hex)},${a})`;
  function headFont() { return "'FS Sinclair','Swiss 721 Extended',sans-serif"; }

  let hovered = null, selected = null;
  function installControls() {
    let mode = null, lastX = 0, lastY = 0, downX = 0, downY = 0, moved = false, panVel = { x: 0, y: 0 }, panT = 0, rotVel = 0, rotT = 0;
    const pointers = new Map();
    let pinchD = 0, pinchA = null, lastTap = null;
    cv.addEventListener("contextmenu", (e) => e.preventDefault());
    // MOBILE/iOS: keep every map gesture ON the map. touch-action:none (CSS) covers most browsers,
    // but iOS Safari IGNORES it for PAGE pinch-zoom -- those legacy gesture* events fire at the
    // document level regardless of what's under the fingers, so binding them to the canvas alone lets
    // a pinch that drifts off-canvas zoom the whole page. Bind at the document so a pinch never zooms
    // the page; the canvas touchmove/multitouch guards keep map drags off the page too.
    ["gesturestart", "gesturechange", "gestureend"].forEach((g) => document.addEventListener(g, (e) => e.preventDefault(), { passive: false }));
    cv.addEventListener("touchmove", (e) => e.preventDefault(), { passive: false });
    cv.addEventListener("touchstart", (e) => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });
    cv.addEventListener("pointerdown", (e) => {
      try { cv.setPointerCapture(e.pointerId); } catch (_) {}
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size >= 2) {
        const p = [...pointers.values()];
        pinchD = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
        pinchA = Math.atan2(p[1].y - p[0].y, p[1].x - p[0].x);
        mode = "pinch"; moved = true; cv.classList.add("dragging"); camAnim = null; return;
      }
      mode = (e.button === 2 || e.shiftKey) ? "orbit" : "pan";
      lastX = downX = e.clientX; lastY = downY = e.clientY; moved = false; cv.classList.add("dragging");
      camAnim = null; camVel.x = camVel.y = 0; zoomTarget = null;
      panVel.x = panVel.y = 0; rotVel = 0; panT = rotT = (typeof performance !== "undefined" ? performance.now() : Date.now());
    });
    cv.addEventListener("pointermove", (e) => {
      const r = cv.getBoundingClientRect();
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (mode === "pinch" && pointers.size >= 2) {
        const p = [...pointers.values()], d = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y), a = Math.atan2(p[1].y - p[0].y, p[1].x - p[0].x);
        const mx = (p[0].x + p[1].x) / 2 - r.left, my = (p[0].y + p[1].y) / 2 - r.top;
        const before = unproject(mx, my);
        if (pinchD > 0) cam.zoom = clamp(cam.zoom * (d / pinchD), ZMIN, ZMAX);
        if (pinchA != null) cam.rot = (cam.rot + (a - pinchA) * 180 / Math.PI) % 360;
        const after = unproject(mx, my); cam.x += before.x - after.x; cam.y += before.y - after.y;
        pinchD = d; pinchA = a; pokeInteract(); return;
      }
      if (!mode) { pick(e.clientX - r.left, e.clientY - r.top, e); return; }
      const dx = e.clientX - lastX, dy = e.clientY - lastY;
      if (Math.abs(e.clientX - downX) + Math.abs(e.clientY - downY) > 3) { moved = true; if (fleetCardOpen) hideFleetCard(); }
      if (mode === "pan") {
        const w = screenDeltaToWorld(dx, dy); cam.x -= w.x; cam.y -= w.y;
        const tn = (typeof performance !== "undefined" ? performance.now() : Date.now()), dtv = Math.max(8, tn - panT);
        panVel.x = 0.6 * (-w.x / dtv) + 0.4 * panVel.x; panVel.y = 0.6 * (-w.y / dtv) + 0.4 * panVel.y; panT = tn;
      } else {
        cam.pitch = clamp(cam.pitch - dy * 0.005, 0.2, 1.0); cam.rot = (cam.rot + dx * 0.5) % 360;
        const tn = (typeof performance !== "undefined" ? performance.now() : Date.now()), dtv = Math.max(8, tn - rotT);
        rotVel = 0.6 * (dx * 0.5 / dtv) + 0.4 * rotVel; rotT = tn;
      }
      lastX = e.clientX; lastY = e.clientY; pokeInteract();
    });
    const up = (e) => {
      pointers.delete(e.pointerId);
      if (mode === "pan" && !moved) {
        const r = cv.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top;
        const fhit = pickFleet(sx, sy);
        if (fhit) { showFleetCard(fhit.fleet, sx, sy); lastTap = null; }
        else {
          hideFleetCard();
          const hit = pickNearest(sx, sy);
          const now = (typeof performance !== "undefined" ? performance.now() : Date.now());
          const dbl = lastTap && (now - lastTap.t < 300) && Math.hypot(sx - lastTap.x, sy - lastTap.y) < 28;
          lastTap = { t: now, x: sx, y: sy };
          if (hit) { selectPlanet(hit.p); lastTap = null; }
          else if (dbl) { zoomToScreen(sx, sy, 1.7); lastTap = null; }
          else closeConsole();
        }
      }
      else if (mode === "pan" && moved) {
        const tn = (typeof performance !== "undefined" ? performance.now() : Date.now());
        if (tn - panT < 60 && Math.hypot(panVel.x, panVel.y) > 0.01) { camVel.x = panVel.x; camVel.y = panVel.y; }
      }
      else if (mode === "orbit" && moved) {
        const tn = (typeof performance !== "undefined" ? performance.now() : Date.now());
        if (tn - rotT < 70 && Math.abs(rotVel) > 0.03) { const fling = clamp(rotVel * 165, -190, 190); animateCam({ rot: cam.rot + fling }, 760, easeOutBack); }
      }
      if (pointers.size < 2) pinchD = 0;
      if (pointers.size === 0) { mode = null; cv.classList.remove("dragging"); }
      else if (mode === "pinch") { const p = [...pointers.values()][0]; mode = "pan"; lastX = downX = p.x; lastY = downY = p.y; moved = true; }
      try { cv.releasePointerCapture(e.pointerId); } catch (_) {}
    };
    cv.addEventListener("pointerup", up);
    cv.addEventListener("pointercancel", (e) => { pointers.delete(e.pointerId); if (pointers.size < 2) pinchD = 0; if (!pointers.size) { mode = null; cv.classList.remove("dragging"); } });
    cv.addEventListener("pointerleave", () => { hovered = null; hideCompact(); });
    cv.addEventListener("wheel", (e) => {
      e.preventDefault();
      const r = cv.getBoundingClientRect();
      const base = zoomTarget != null ? zoomTarget : cam.zoom;
      zoomTarget = clamp(base * (e.deltaY < 0 ? 1.18 : 0.85), ZMIN, ZMAX);
      zoomAnchor = { sx: e.clientX - r.left, sy: e.clientY - r.top };
      camAnim = null; camVel.x = camVel.y = 0; pokeInteract();
    }, { passive: false });
    const btn = (id, fn) => { const b = document.getElementById(id); if (b) b.onclick = fn; };
    btn("zin", () => zoomCenter(1.25)); btn("zout", () => zoomCenter(0.8));
    btn("zreset", () => animateCam({ x: HOME.x, y: HOME.y, zoom: 1, pitch: 0.65, rot: 0 }, 520));
    btn("ztop", () => animateCam(cam.pitch > 0.95 ? { pitch: 0.65 } : { pitch: 1.0, rot: 0 }, 420));
    const mfPanel = () => document.getElementById("map-fleets");
    btn("zfleet", () => { const p = mfPanel(); if (p) { p.classList.toggle("open"); const b = document.getElementById("zfleet"); if (b) b.classList.toggle("on", p.classList.contains("open")); } });
    btn("mf-close", () => { const p = mfPanel(); if (p) p.classList.remove("open"); const b = document.getElementById("zfleet"); if (b) b.classList.remove("on"); });

    Array.prototype.forEach.call(document.querySelectorAll("#map-layers button[data-layer]"), (b) => {
      b.onclick = () => {
        const keys = b.getAttribute("data-layer").split(/\s+/);   // one button can drive a group of layers
        const on = !LAYERS[keys[0]];
        keys.forEach((k) => { LAYERS[k] = on; });
        b.classList.toggle("on", on);
        staticKey = "";
        if (window.__mapRender) window.__mapRender(performance.now());
      };
    });
    Array.prototype.forEach.call(document.querySelectorAll("#map-layers button[data-gfx]"), (b) => {
      b.classList.toggle("on", GFX_LEVELS[b.getAttribute("data-gfx")] === GFX);
      b.onclick = () => setGfx(b.getAttribute("data-gfx"));
    });
    // Re-derive the device default once the viewport has settled (no stored choice yet); don't persist.
    if (!GFX_STORED) { const wl = wantLowGfx() ? 0 : 2; if (wl !== GFX) setGfx(wl, false); }
    const lbtn = document.getElementById("layers-btn"), lpanel = document.getElementById("map-layers");
    if (lbtn && lpanel) {
      lbtn.onclick = (e) => { e.stopPropagation(); const open = lpanel.classList.toggle("open"); lbtn.classList.toggle("open", open); lbtn.setAttribute("aria-expanded", open ? "true" : "false"); };
      cv.addEventListener("pointerdown", () => { lpanel.classList.remove("open"); lbtn.classList.remove("open"); lbtn.setAttribute("aria-expanded", "false"); });
    }
  }
  function zoomCenter(f) { zoomTarget = clamp((zoomTarget != null ? zoomTarget : cam.zoom) * f, ZMIN, ZMAX); zoomAnchor = { sx: cvW / 2, sy: cvH / 2 }; camAnim = null; camVel.x = camVel.y = 0; pokeInteract(); }

  function zoomToScreen(sx, sy, factor) {
    const before = unproject(sx, sy), oz = cam.zoom, nz = clamp(cam.zoom * factor, ZMIN, ZMAX);
    cam.zoom = nz; syncCam();
    const after = unproject(sx, sy), tx = cam.x + before.x - after.x, ty = cam.y + before.y - after.y;
    cam.zoom = oz; syncCam();
    animateCam({ zoom: nz, x: tx, y: ty }, 300);
  }
  function pick(sx, sy, e) {
    const hit = pickNearest(sx, sy), id = hit ? hit.p.i : null;
    cv.style.cursor = hit ? "pointer" : "grab";
    if (id !== hovered) { hovered = id; if (hit) showCompact(hit.p); else hideCompact(); }
    if (hit && e) moveCompact(e);
  }
  function pickNearest(sx, sy) {
    let best = null, bd = 16 * 16;
    for (const e of PLANETS) { const rr = (e.p.active ? 12 : 11) ** 2; const d = (e.sx - sx) ** 2 + (e.sy - sy) ** 2; if (d < rr && d < bd) { bd = d; best = e; } }
    return best;
  }
  function pickFleet(sx, sy) {
    let best = null, bd = 13 * 13;
    for (const h of _fleetHits) { const d = (h.x - sx) ** 2 + (h.y - sy) ** 2; if (d < bd) { bd = d; best = h; } }
    return best;
  }

  let fleetCardEl = null, fleetCardOpen = false;
  function buildFleetCard(f) {
    const fac = f.faction === 0 ? 1 : f.faction, col = facColor(fac), src = FLEET_ICON_SRC[fac] || FLEET_ICON_SRC[2];
    const role = (f.role || "DEPLOYED").toUpperCase(), atk = /ATTACK|INVAD|OCCUP|ASSAULT/.test(role);
    return `<div class="fc" style="--fac:${col}">` +
      `<span class="fc-cnr tl"></span><span class="fc-cnr tr"></span><span class="fc-cnr bl"></span><span class="fc-cnr br"></span><span class="fc-scan"></span>` +
      `<div class="fc-head"><img class="fc-ship" src="${src}" alt=""><div class="fc-htx"><span class="fc-fac">${facName(fac)} FLEET</span><b class="fc-nm">${esc(f.name || "UNKNOWN FLEET")}</b></div></div>` +
      `<div class="fc-grid">` +
        `<div class="fc-cell"><span class="fc-k">LEVEL</span><b class="fc-v">${f.level || 0}</b></div>` +
        `<div class="fc-cell"><span class="fc-k">STATUS</span><b class="fc-v ${atk ? "atk" : "def"}">${role}</b></div>` +
        `<div class="fc-cell wide"><span class="fc-k">LOCATION</span><b class="fc-v">${esc(f.planet || "-")}</b></div>` +
      `</div></div>`;
  }
  function showFleetCard(f, sx, sy) {
    if (!fleetCardEl) { fleetCardEl = document.createElement("div"); fleetCardEl.className = "fleet-card"; fleetCardEl.addEventListener("pointerdown", (ev) => ev.stopPropagation()); wrap.appendChild(fleetCardEl); }
    fleetCardEl.innerHTML = buildFleetCard(f); fleetCardEl.classList.add("show"); fleetCardOpen = true;
    const w = fleetCardEl.offsetWidth || 230, h = fleetCardEl.offsetHeight || 150, W = cv.width / dpr, H = cv.height / dpr;
    let x = clamp(sx + 16, 8, W - w - 8), y = sy - h - 12; if (y < 8) y = sy + 20; y = clamp(y, 8, H - h - 8);
    fleetCardEl.style.left = x + "px"; fleetCardEl.style.top = y + "px";
  }
  function hideFleetCard() { if (fleetCardEl && fleetCardOpen) { fleetCardEl.classList.remove("show"); fleetCardOpen = false; } }

  let camAnim = null, camVel = { x: 0, y: 0 }, zoomTarget = null, zoomAnchor = null, _stepTs = 0;
  function easeOutBack(u) { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(u - 1, 3) + c1 * Math.pow(u - 1, 2); }
  function animateCam(to, dur, ease) {
    camVel.x = camVel.y = 0; zoomTarget = null;
    const from = { x: cam.x, y: cam.y, zoom: cam.zoom, pitch: cam.pitch, rot: cam.rot }, t = {};
    for (const k in to) t[k] = to[k];
    if (t.rot != null && !ease) { let d = ((t.rot - from.rot + 540) % 360) - 180; t.rot = from.rot + d; }
    camAnim = { from, to: t, t0: null, dur, ease };
  }
  function stepCamAnim(ts) {
    const dt = _stepTs ? Math.min(50, ts - _stepTs) : 16.7; _stepTs = ts;
    if (camAnim) {
      if (camAnim.t0 == null) camAnim.t0 = ts;
      const u = clamp((ts - camAnim.t0) / camAnim.dur, 0, 1), e = camAnim.ease ? camAnim.ease(u) : 1 - Math.pow(1 - u, 3);
      for (const k in camAnim.to) cam[k] = camAnim.from[k] + (camAnim.to[k] - camAnim.from[k]) * e;
      if (cam.rot != null) cam.rot = ((cam.rot % 360) + 360) % 360;
      if (u >= 1) camAnim = null; else pokeInteract();
      return;
    }

    if (zoomTarget != null && zoomAnchor) {
      const before = unproject(zoomAnchor.sx, zoomAnchor.sy);
      cam.zoom += (zoomTarget - cam.zoom) * (1 - Math.pow(0.78, dt / 16.67));
      const after = unproject(zoomAnchor.sx, zoomAnchor.sy);
      cam.x += before.x - after.x; cam.y += before.y - after.y;
      if (Math.abs(zoomTarget - cam.zoom) <= zoomTarget * 0.0015) { cam.zoom = zoomTarget; zoomTarget = null; }
      else pokeInteract();
    }

    if (camVel.x || camVel.y) {
      cam.x += camVel.x * dt; cam.y += camVel.y * dt;
      const decay = Math.pow(0.0018, dt / 1000); camVel.x *= decay; camVel.y *= decay;
      if (Math.hypot(camVel.x, camVel.y) < 0.015) { camVel.x = camVel.y = 0; }
      else pokeInteract();
    }
  }
  function selectPlanet(p) {
    selected = p.i; hovered = null; hideCompact(); hideFleetCard();
    animateCam({ x: byIndex[p.i].wx, y: byIndex[p.i].wy, zoom: Math.max(cam.zoom, 2.6) }, 600);
    openConsole(p);
    if (window.__onPlanetSelect) { try { window.__onPlanetSelect(p.i); } catch (e) {} }   // lets an embedder (lore editor) sync selection
  }

  const FAC_ICON = { 1: "fac_superearth", 2: "fac_terminid", 3: "fac_automaton", 4: "fac_illuminate" };
  const CAMP_ICON = { 0: "campaign_liberation", 1: "campaign_recon", 2: "campaign_high_priority", 3: "campaign_battle_of_super_earth", 4: "campaign_defense", 5: "campaign_battle_of_super_earth" };
  const CAMP_NAME = { 0: "LIBERATION", 1: "RECON", 2: "HIGH PRIORITY", 3: "BATTLE FOR SUPER EARTH", 4: "DEFENSE", 5: "BATTLE FOR CYBERSTAN" };
  const HAZ_ICON = {
    "SANDSTORMS": "Sandstorms.png", "FIRE TORNADOES": "Fire_tornadoes.png", "BLIZZARDS": "Blizzards.png", "THICK FOG": "Thick_Fog.png",
    "ION STORMS": "ion storm.png", "TREMORS": "Tremors.png", "METEOR STORMS": "Meteor_Storms.png", "VOLCANIC ACTIVITY": "VOLCANIC ACTIVITY.png",
    "ACID STORMS": "Acid_storms.png", "RAIN STORMS": "Rain_Storms.png", "RAINSTORMS": "Rain_Storms.png", "EXTREME COLD": "Extreme_cold.png", "INTENSE HEAT": "Intense_heat.png",
  };
  const facIcon = (id) => `img/icons/${FAC_ICON[id] || "fac_superearth"}.png`;
  const hazIcon = (n) => (HAZ_ICON[n] ? `img/env/${encodeURIComponent(HAZ_ICON[n])}` : null);
  const resistance = (p) => (p.max > 0 ? (p.regen * 3600 / p.max * 100) : 0);
  const hazTag = (e) => { const ic = hazIcon(e); return `<span class="haz">${ic ? `<img src="${ic}" alt="">` : ""}${e}</span>`; };
  // Subfaction display-name -> Discord emoji icon (id + anim), lifted from fleet_catalogue.json.
  // Lets ENEMY FORCES chips show the real WarForge subfaction icon (img/enemies/<id>.png, with
  // a Discord-CDN fallback via enemyIcon). Strains with no emoji fall back to the faction icon.
  const SUBFAC_ICON = {
    "PREDATOR STRAIN": { eid: "1433396632912924682" }, "RUPTURE STRAIN": { eid: "1433395636241432676" },
    "DRAGONROACHES": { eid: "1433396592836087869" }, "HIVE LORDS": { eid: "1430405000349094008", anim: true },
    "THE JET BRIGADE": { eid: "1433397113831817258" }, "THE INCINERATION CORPS": { eid: "1430317932805754972" },
    "CYBORGS": { eid: "1468838016742068244" }, "APPROPRIATORS": { eid: "1484679532450549891" },
    "ASSIMILATORS": { eid: "1507917832795721758" }, "PANZER DIVISION": { eid: "1507491787764400239" },
    "SEAF": { eid: "1506468708342562908" },
  };
  const PB = { GAP: 14, PAD: 2, TRI_W: 7, TRI_H: 9, CHEV_W: 5, CHEV_THICK: 6, CHEV_SPACE: 8, STRIPE_W: 5, STRIPE_SPACE: 6, STRIPE_ANGLE: 32, SPEED_SE: 0.5, SPEED_EN: 0.125 };
  const SE_COL = { bg: "#8BCCDF", fg: "#78AFBE" };
  const ENEMY_COL = { 0: { bg: "#A0A0A0", fg: "#707070" }, 2: { bg: "#FFCB00", fg: "#D9AC00" }, 3: { bg: "#FF7F7F", fg: "#DB6E6E" }, 4: { bg: "#DAA4EF", fg: "#BA8CCC" } };
  const MARK = "#5ce372";
  const FAC_LOWER = { 1: "superearth", 2: "terminid", 3: "automaton", 4: "illuminate" };
  const FAC_NAME_S = { 0: "UNCONTROLLED", 1: "SUPER EARTH", 2: "TERMINID", 3: "AUTOMATON", 4: "ILLUMINATE" };
  const facNameS = (id) => FAC_NAME_S[id] || facName(id);
  const CAMPDESC = {
    0: "This planet is considered enemy territory. The Helldivers must reclaim it from its oppressive occupants.",
    DEFENSE: "This planet is under attack. The Helldivers must defend it against the forces of tyranny.",
    CLAIM: "The Helldivers must liberate this planet before time runs out. Failure will have severe consequences.",
  };
  const RES_CLASS = (pct) => pct <= 1.5 ? ["LOW", "#7EAEFF"] : pct <= 2.5 ? ["AVERAGE", "#6FE994"] : pct <= 5.0 ? ["HIGH", "#FFA33F"] : ["VERY HIGH", "#FF5A5A"];

  function pbBar(c, x0, y0, w, h, lib, faction, offSE, offEN, o) {
    o = o || {}; lib = clamp(lib, 0, 100);
    const gap = PB.GAP, pad = PB.PAD, markerX = Math.max(x0 + gap / 2, Math.min(x0 + w - gap / 2, x0 + w * (lib / 100)));
    const leftW = markerX - x0 - gap / 2, rightX = markerX + gap / 2, rightW = x0 + w - rightX;
    const seBg = o.seBg || SE_COL.bg, seFg = o.seFg || SE_COL.fg, en = ENEMY_COL[faction] || ENEMY_COL[0], enBg = o.enBg || en.bg, enFg = o.enFg || en.fg;
    if (leftW > 0) {
      c.fillStyle = seBg; c.fillRect(x0, y0, leftW, h);
      const cl = x0 + pad, cr = x0 + leftW - pad, ct = y0 + pad, cb = y0 + h - pad, cm = y0 + h / 2;
      if (cr > cl) { c.save(); c.beginPath(); c.rect(cl, ct, cr - cl, cb - ct); c.clip(); c.fillStyle = seFg; const cw = PB.CHEV_W, th = PB.CHEV_THICK, step = cw + PB.CHEV_SPACE; for (let x = cl - step + (offSE % step); x < cr + step; x += step) { c.beginPath(); c.moveTo(x, ct); c.lineTo(x + cw, cm); c.lineTo(x, cb); c.lineTo(x - th, cb); c.lineTo(x + cw - th, cm); c.lineTo(x - th, ct); c.closePath(); c.fill(); } c.restore(); }
    }
    if (rightW > 0) {
      c.fillStyle = enBg; c.fillRect(rightX, y0, rightW, h);
      const cl = rightX + pad, cr = rightX + rightW - pad, ct = y0 + pad, cb = y0 + h - pad;
      if (cr > cl) { c.save(); c.beginPath(); c.rect(cl, ct, cr - cl, cb - ct); c.clip(); c.translate((cl + cr) / 2, (ct + cb) / 2); c.rotate(-PB.STRIPE_ANGLE * Math.PI / 180); c.strokeStyle = enFg; c.lineWidth = PB.STRIPE_W; c.lineCap = "butt"; const step = PB.STRIPE_W + PB.STRIPE_SPACE, diag = Math.hypot(w, h) + 50; for (let x = -diag - (offEN % step); x < diag; x += step) { c.beginPath(); c.moveTo(x, -diag); c.lineTo(x, diag); c.stroke(); } c.restore(); }
    }
    const tw = PB.TRI_W, tht = PB.TRI_H, my = y0 + h / 2; c.fillStyle = o.marker || MARK; c.beginPath();
    c.moveTo(markerX - tw / 2, my - tht / 2); c.lineTo(markerX + tw / 2, my); c.lineTo(markerX - tw / 2, my + tht / 2); c.closePath(); c.fill();
  }

  function tipMeta(p) {
    const owner = p.owner; let dispFac = owner, title = "PLANET", campIc = null, mode = "none", isDefense = false;
    if (p.ev) { mode = "event"; if (owner === 1) { dispFac = p.ev.race; title = "DEFENSE"; campIc = "campaign_defense"; isDefense = true; } else { dispFac = owner; title = "LIBERATION"; campIc = "campaign_claim"; } }
    else if (p.active) { mode = "standard"; const t = p.campType; dispFac = owner !== 1 ? owner : (p.campRace || 2); if (t === 4) { dispFac = p.campRace || 2; title = "DEFENSE"; campIc = "campaign_defense"; } else if (t === 2) { title = "HIGH PRIORITY"; campIc = "campaign_high_priority"; } else { title = CAMP_NAME[t] || "LIBERATION"; campIc = CAMP_ICON[t] || "campaign_liberation"; } }
    return { owner, dispFac, title, campIc, mode, isDefense };
  }
  function tipDesc(p, m) { if (m.mode === "event") return m.isDefense ? CAMPDESC.DEFENSE : CAMPDESC.CLAIM; if (m.mode === "standard" && p.campType === 0) return CAMPDESC[0]; return ""; }
  const invLevel = (p) => Math.max(1, Math.round(p.ev.max / 50000));
  const evPlayerPct = (p) => clamp((1 - p.ev.hp / p.ev.max) * 100, 0, 100);
  const evEnemyPct = (p) => { const span = p.ev.expireEpoch - p.ev.startEpoch; return span > 0 ? clamp((Date.now() / 1000 - p.ev.startEpoch) / span * 100, 0, 100) : 100; };

  function drawEventBar(canvas, p, dispFac, off) {
    const c = canvas.getContext("2d"); c.clearRect(0, 0, canvas.width, canvas.height); const w = canvas.width;
    const grey = ENEMY_COL[0], en = ENEMY_COL[dispFac] || ENEMY_COL[2];
    pbBar(c, 0, 0, w, 17, evPlayerPct(p), dispFac, off, off * 0.5, { seBg: SE_COL.bg, seFg: SE_COL.fg, enBg: grey.bg, enFg: grey.fg });
    pbBar(c, 0, 21, w, 17, evEnemyPct(p), dispFac, off, off * 0.5, { seBg: en.bg, seFg: en.fg, enBg: grey.bg, enFg: grey.fg });
  }

  let compactState = null;
  function buildCompact(p) {
    const m = tipMeta(p), fc = facColor(m.dispFac), oc = facColor(p.owner);
    let h = `<div class="wf-mini" style="--fac:${fc}">`;
    h += `<div class="wf-mini-head"><span class="wf-mini-fac"><span class="wf-mini-icon" style="-webkit-mask:url(${facIcon(m.dispFac)}) center/contain no-repeat;mask:url(${facIcon(m.dispFac)}) center/contain no-repeat;background:${fc}"></span><span class="wf-outline" style="color:${fc}">${facNameS(m.dispFac)}</span></span><span class="wf-mini-idx"><span class="wf-mini-pi"></span><b class="wf-outline">${p.i}</b></span></div>`;
    const _bh = p.fx && p.fx.find((f) => f.t === "black_hole");
    const globeAttr = _bh ? `class="wf-mini-globe blackhole" style="--bh:${_bh.c || "#A640FF"};--fac:${oc}"` : `class="wf-mini-globe" style="background-image:url(${p.globe});--fac:${oc}"`;
    h += `<div class="wf-mini-body"><div class="wf-mini-top"><span ${globeAttr}></span><div class="wf-mini-titles">`;

    if (m.mode !== "none") h += `<div class="wf-mini-status camp"><img class="wf-mini-campic" src="img/icons/${m.campIc || "campaign_liberation"}.png" alt=""><b class="wf-outline" style="color:${fc}">${m.title}</b></div>`;
    else h += statusPill(p);
    h += `<div class="wf-outline wf-mini-name">${p.name}</div><div class="wf-mini-biome">${p.biome || ""}</div></div></div>`;
    if (m.mode === "event") {
      const frame = `img/icons/frame_${FAC_LOWER[m.dispFac] || "terminid"}.png`;
      h += `<div class="wf-mini-event"><div class="wf-mini-badge"><span class="wf-mini-frame" style="-webkit-mask:url(${frame}) center/contain no-repeat;mask:url(${frame}) center/contain no-repeat;background:${fc}"></span><span class="wf-mini-lvl" style="color:${fc}">${invLevel(p)}</span></div>` +
        `<canvas class="wf-mini-evbar" width="170" height="38"></canvas></div>` +
        `<div class="wf-mini-timer" data-exp="${p.ev.expireEpoch}" data-label="${m.isDefense ? "DEFEND" : "CLAIM"}">${m.isDefense ? "DEFEND" : "CLAIM"} --:--:--</div>`;
      h += `<div class="wf-mini-foot"><span>INVASION LEVEL</span><b style="color:${fc}">${invLevel(p)}</b></div>`;
    } else {
      const isControl = m.mode === "none", val = p.active ? p.lib : (p.max > 0 ? p.hp / p.max * 100 : 0);
      h += `<canvas class="wf-mini-bar" width="222" height="15"></canvas><div class="wf-outline wf-mini-lbl">${val.toFixed(isControl ? 1 : 3)}% ${isControl ? "CONTROL" : "LIBERATED"}</div>`;
      const res = resistance(p), rc = RES_CLASS(res);
      h += `<div class="wf-mini-foot"><span>RESISTANCE</span><b style="color:${rc[1]}">${rc[0]} <i>(${res.toFixed(2)}%)</i></b></div>`;
    }
    h += `</div></div>`; return h;
  }
  function showCompact(p) { if (consoleOpen) return; tip.innerHTML = buildCompact(p); tip.classList.add("show"); compactState = { p, m: tipMeta(p) }; paintCompactBar(); }
  function paintCompactBar() {
    if (!compactState) return; const p = compactState.p, m = compactState.m, off = animOff * PB.SPEED_SE;
    if (m.mode === "event") { const cvs = tip.querySelector(".wf-mini-evbar"); if (cvs) drawEventBar(cvs, p, m.dispFac, off); }
    else { const cvs = tip.querySelector(".wf-mini-bar"); if (cvs) { const c = cvs.getContext("2d"); c.clearRect(0, 0, cvs.width, cvs.height); const val = p.active ? p.lib : (p.max > 0 ? p.hp / p.max * 100 : 0); pbBar(c, 0, 0, cvs.width, cvs.height, val, m.dispFac, animOff * PB.SPEED_SE, animOff * PB.SPEED_EN, {}); } }
    paintTimer(tip);
  }
  function moveCompact(e) {
    const r = wrap.getBoundingClientRect(), w = tip.offsetWidth || 240, hh = tip.offsetHeight || 190;
    let x = clamp(e.clientX - r.left, w / 2 + 6, r.width - w / 2 - 6), y = e.clientY - r.top;
    tip.style.transform = (y - 16 - hh < 6) ? "translate(-50%, 18px)" : "translate(-50%, calc(-100% - 14px))";
    tip.style.left = x + "px"; tip.style.top = y + "px";
  }
  function hideCompact() { tip.classList.remove("show"); compactState = null; }
  function paintTimer(container) {
    container.querySelectorAll("[data-exp]").forEach((t) => { const left = Math.max(0, (+t.dataset.exp) - Date.now() / 1000); const hh = String(Math.floor(left / 3600)).padStart(2, "0"), mm = String(Math.floor((left % 3600) / 60)).padStart(2, "0"), ss = String(Math.floor(left % 60)).padStart(2, "0"); t.textContent = `${t.dataset.label} ${hh}:${mm}:${ss}`; });
  }

  let consoleOpen = false, consoleState = null;
  const card = (title, body) => `<div class="wf-card"><div class="wf-card-h">${title}</div>${body}</div>`;
  const subh = (t, cls) => `<div class="pc-subh${cls ? " " + cls : ""}">${t}</div>`;

  function hpRingSVG(p, cls) {
    const oc = facColor(p.owner), sc = facColor(1);
    const pct = clamp((p.ev ? evPlayerPct(p) : (p.lib || 0)) / 100, 0, 1);
    const cx = 108, cy = 108, r = 103;
    const pol = (deg) => { const a = (deg - 90) * Math.PI / 180; return [(cx + r * Math.cos(a)).toFixed(2), (cy + r * Math.sin(a)).toFixed(2)]; };
    let h = `<svg class="${cls || "dsr-hpring"}" viewBox="0 0 216 216" aria-hidden="true">`;
    h += `<circle class="hp-track" cx="${cx}" cy="${cy}" r="${r}" stroke="${oc}"/>`;
    if (pct >= 0.999) {
      h += `<circle class="hp-fill" cx="${cx}" cy="${cy}" r="${r}" stroke="${sc}" style="filter:drop-shadow(0 0 4px ${sc})"/>`;
    } else if (pct > 0.004) {
      const [x0, y0] = pol(0), [x1, y1] = pol(pct * 360);
      h += `<path class="hp-fill" d="M ${x0} ${y0} A ${r} ${r} 0 ${pct * 360 > 180 ? 1 : 0} 1 ${x1} ${y1}" stroke="${sc}" style="filter:drop-shadow(0 0 4px ${sc})"/>`;
    }
    return h + `</svg>`;
  }
  function buildDashboard(p) {
    const m = tipMeta(p), fc = facColor(m.dispFac), oc = facColor(p.owner), hasCamp = m.mode !== "none";
    let h = `<div class="wf-dash" style="--fac:${fc}">`;

    h += `<div class="wf-dash-head"><span class="wf-dash-fac"><span class="wf-dash-ficon" style="-webkit-mask:url(${facIcon(m.dispFac)}) center/contain no-repeat;mask:url(${facIcon(m.dispFac)}) center/contain no-repeat"></span><span class="wf-dash-facname">${facNameS(m.dispFac)}</span><span class="wf-dash-pname">${p.name}</span></span>` +
      `<span class="wf-dash-name">${p.name}</span>` +
      `<span class="wf-dash-idx"><span class="wf-idx-icon"></span><b>${p.i}</b></span>` +
      `<button class="pc-close" id="pc-close" title="Close">&times;</button></div>`;
    h += `<div class="wf-dash-body">`;
    const hasStorm = p.fx && p.fx.some((f) => f.t === "vortex");
    const hasBH = p.fx && p.fx.some((f) => f.t === "black_hole");

    h += `<div class="dsr-identity"><div class="dsr-globe">` +
      `<span class="wf-globe-wrap"><span class="wf-globe${hasStorm ? " exostorm" : ""}${hasBH ? " blackhole" : ""}" style="background-image:url(${p.globe});--fac:${oc}"></span>` +
      (p.fx && p.fx.length ? `<canvas class="wf-globe-fx" aria-hidden="true"></canvas>` : ``) + hpRingSVG(p) +
      `<span class="dsr-ret" aria-hidden="true"></span><span class="dsr-tick tl"></span><span class="dsr-tick tr"></span><span class="dsr-tick bl"></span><span class="dsr-tick br"></span></span>` +
      `<div class="dsr-globe-cap"><span>WORLD TYPE</span><b>${p.biome || "UNKNOWN"}</b></div></div>`;
    h += `<div class="dsr-vitals">`;
    if (hasCamp) h += `<div class="wf-dash-op">${m.campIc ? `<img src="img/icons/${m.campIc}.png" alt="">` : ""}<div><b style="color:${fc}">${m.title}</b><span>${facName(p.owner)}-held world</span></div></div>`;
    else h += statusCard(p);
    const desc = tipDesc(p, m); if (desc) h += `<div class="wf-dash-desc">${desc}</div>`;
    if (m.mode === "event") { const frame = `img/icons/frame_${FAC_LOWER[m.dispFac] || "terminid"}.png`; h += `<div class="wf-eventwrap"><div class="wf-badge"><span class="wf-badge-frame" style="-webkit-mask:url(${frame}) center/contain no-repeat;mask:url(${frame}) center/contain no-repeat;background:${fc}"></span><span class="wf-badge-lvl" style="color:${fc}">${invLevel(p)}</span></div><canvas class="wf-eventbar" width="232" height="38"></canvas></div><div class="wf-timer" data-exp="${p.ev.expireEpoch}" data-label="${m.isDefense ? "DEFEND" : "CLAIM"}">${m.isDefense ? "DEFEND" : "CLAIM"} --:--:--</div>`; }
    else if (m.mode === "standard") h += `<canvas class="wf-bar" width="232" height="15"></canvas><div class="wf-outline wf-liblbl">${p.lib.toFixed(1)}% LIBERATED</div>`;

    const resSpec = m.isDefense
      ? (function () { const lv = invLevel(p); return `<div class="dsr-spec has-bar"><span>INVASION LEVEL</span><b>${lv}</b><i class="dsr-spec-bar" style="--p:${clamp(lv / 10 * 100, 8, 100)}%;--c:#FF7676"></i></div>`; })()
      : (function () { const res = resistance(p), rc = RES_CLASS(res); return `<div class="dsr-spec has-bar"><span>RESISTANCE</span><b style="color:${rc[1]}">${rc[0]} (${res.toFixed(2)}%)</b><i class="dsr-spec-bar" style="--p:${clamp(res / 8 * 100, 4, 100)}%;--c:${rc[1]}"></i></div>`; })();
    h += `<div class="dsr-specgrid">${resSpec}${specRibbon(p)}</div>`;
    h += `</div></div>`;

    const env = dashEnv(p), sup = dashSupply(p), reg = dashRegions(p), cam = dashCampaign(p), forces = dashForces(p);
    const sec = (title, body, cls) => `<div class="dsr-sec${cls ? " " + cls : ""}"><div class="wf-card-h">${title}</div>${body}</div>`;
    const grid = (arr) => { if (arr.length % 2 === 1) arr[arr.length - 1] = arr[arr.length - 1].replace('class="dsr-sec', 'class="dsr-sec span2'); return `<div class="dsr-intel">${arr.join("")}</div>`; };
    // Intel split into stylized tabs; only tabs that have content appear, first is active by default.
    const tabs = [];
    const sitrep = [];
    if (cam) sitrep.push(sec("CAMPAIGN", cam));
    if (sup) sitrep.push(sec("SUPPLY NETWORK", sup));
    if (env) sitrep.push(sec("ENVIRONMENT", env));
    if (sitrep.length) tabs.push({ id: "sitrep", label: "SITREP", body: grid(sitrep) });
    const force = [];
    if (forces) force.push(sec("ENEMY FORCES PRESENT", forces));
    if (reg) { const rn = p.regions.length; force.push(sec(rn + " " + (rn === 1 ? "REGION" : "REGIONS"), reg)); }
    if (force.length) tabs.push({ id: "forces", label: "FRONT", body: grid(force) });
    // INTEL only appears for worlds that actually have documented lore in data/lore.json.
    const _lore = LORE[String(p.i)];
    if (_lore && _lore.poi && _lore.poi.length) tabs.push({ id: "intel", label: "INTEL", body: grid([sec("POINTS OF INTEREST", `<div class="lore-inner">${renderLore(p)}</div>`, "dsr-poi")]) });
    if (!tabs.length) tabs.push({ id: "sitrep", label: "SITREP", body: grid([sec("SUPPLY NETWORK", sup || `<div class="lore-empty">No telemetry on record for this world.</div>`)]) });
    h += `<div class="dsr-right">` +
      `<div class="dsr-tabs" role="tablist">` + tabs.map((t, i) => `<button class="dsr-tab${i === 0 ? " on" : ""}" data-tab="${t.id}" role="tab" aria-selected="${i === 0 ? "true" : "false"}">${t.label}</button>`).join("") + `</div>` +
      `<div class="dsr-panels">` + tabs.map((t, i) => `<div class="dsr-panel${i === 0 ? " on" : ""}" data-panel="${t.id}">${t.body}</div>`).join("") + `</div>` +
      `</div>`;
    h += `</div></div>`;
    return h;
  }

  // one stat box; pass pct (0-100) + col to draw a mini progress bar beneath the value
  function specBox(label, val, pct, col) {
    const bar = (pct != null) ? `<i class="dsr-spec-bar" style="--p:${clamp(pct, 2, 100)}%;--c:${col || "#46a4ff"}"></i>` : "";
    return `<div class="dsr-spec${pct != null ? " has-bar" : ""}"><span>${label}</span><b>${val}</b>${bar}</div>`;
  }
  // status tags — driven by live planet state; styled as filled HUD pills (see .pc-badge)
  function dashTags(p) {
    const t = [];
    if (p.mo) t.push(["MAJOR ORDER", "mo"]);
    if (p.home != null) t.push(["HOME WORLD", "home"]);
    const inbound = ATTACKS.filter((a) => a.b.p.i === p.i).length;
    if (p.ev && p.owner === 1) t.push(["UNDER DEFENSE", "atk"]);
    else if (inbound) t.push(["INCOMING ASSAULT", "atk"]);
    if (p.active && !p.ev) t.push(["ACTIVE FRONT", "active"]);
    if (p.active && p.lib >= 90) t.push(["FINAL PUSH", "push"]);
    if ((p.adj || []).length >= 4) t.push(["SUPPLY HUB", "hub"]);
    const FXLBL = { black_hole: "BLACK HOLE", vortex: "EXOSTORM", void: "THE VOID", gloom: "GLOOM" };
    (p.fx || []).forEach((f) => { if (FXLBL[f.t]) t.push([FXLBL[f.t], "anom"]); });
    return t.map(([label, cls]) => `<span class="pc-badge ${cls}">${label}</span>`).join("");
  }
  function specRibbon(p) {
    const ctrl = p.max > 0 ? Math.round(p.hp / p.max * 100) : 0, oc = facColor(p.owner);
    let h = specBox("SECTOR", SECTOR_NAME[p.sector] || ("SECTOR " + p.sector));
    h += specBox("CONTROL", ctrl + "%", ctrl, oc);
    h += specBox("INTEGRITY", Math.round(p.hp).toLocaleString() + " / " + Math.round(p.max).toLocaleString());
    if (p.players > 0) h += specBox("HELLDIVERS", p.players.toLocaleString());
    h += specBox("INDEX", "#" + p.i);
    const tags = dashTags(p);
    if (tags) h += `<div class="dsr-spec-badges">${tags}</div>`;
    return h;
  }

  const STRONGHOLD = { 2: "bugstronghold", 3: "botstronghold", 4: "squidstronghold" };
  function statusPill(p) {
    const se = p.owner === 1, ic = se ? "fac_superearth" : (STRONGHOLD[p.owner] || "lock");
    const col = se ? "#ffffff" : facColor(p.owner), txt = se ? "LIBERTY SECURED" : "PENDING LIBERATION";
    return `<div class="wf-mini-status ${se ? "secured" : "pending"}" style="--sc:${col}">` +
      `<span class="wf-mini-status-ic" style="-webkit-mask:url(img/icons/${ic}.png) center/contain no-repeat;mask:url(img/icons/${ic}.png) center/contain no-repeat"></span><b>${txt}</b></div>`;
  }
  function statusCard(p) {
    if (p.owner === 1) {
      return `<div class="wf-status secured" style="--sc:#ffffff">` +
        `<span class="wf-status-ic" style="-webkit-mask:url(img/icons/fac_superearth.png) center/contain no-repeat;mask:url(img/icons/fac_superearth.png) center/contain no-repeat"></span>` +
        `<div class="wf-status-t"><b>LIBERTY SECURED</b><span>Super Earth holds this world</span></div></div>`;
    }
    const oc = facColor(p.owner), sh = STRONGHOLD[p.owner] || "lock";
    return `<div class="wf-status pending" style="--sc:${oc}">` +
      `<span class="wf-status-ic" style="-webkit-mask:url(img/icons/${sh}.png) center/contain no-repeat;mask:url(img/icons/${sh}.png) center/contain no-repeat"></span>` +
      `<div class="wf-status-t"><b>PENDING LIBERATION</b><span>${facName(p.owner)} stronghold - awaiting liberation</span></div></div>`;
  }

  function dashStats(p) {

    const rows = [
      ["BIOME", p.biome || "UNKNOWN", 1],
      ["SECTOR", SECTOR_NAME[p.sector] || ("SECTOR " + p.sector), 0],
      ["INDEX", p.i, 0],
      ["CONTROL", (p.max > 0 ? Math.round(p.hp / p.max * 100) : 0) + "%", 0],
      ["RESISTANCE", resistance(p).toFixed(2) + "%", 0],
      ["HEALTH", Math.round(p.hp).toLocaleString() + " / " + Math.round(p.max).toLocaleString(), 1],
    ];
    let h = `<div class="pc-grid">` + rows.map(([k, v, w]) => `<div class="pc-stat${w ? " wide" : ""}"><span>${k}</span><b>${v}</b></div>`).join("") + `</div>`;
    const badges = []; if (p.home != null) badges.push(`<span class="pc-badge home">HOME WORLD</span>`); if (p.active) badges.push(`<span class="pc-badge active">ACTIVE FRONT</span>`); if (p.mo) badges.push(`<span class="pc-badge mo">MAJOR ORDER</span>`);
    if (badges.length) h += `<div class="pc-badges">${badges.join("")}</div>`;
    return h;
  }
  function dashEnv(p) { const cl = (p.climate || []).concat(p.env || []); return cl.length ? `<div class="pc-haz">${cl.map(hazTag).join("")}</div>` : ""; }
  // ENEMY FORCES PRESENT — the subfaction names active on the planet (faction-coloured), shown on
  // the inspect screen in place of the (disabled) live fleet tracker.
  function dashForces(p) {
    if (!p.forces || !p.forces.length) return "";
    return `<div class="pc-haz pc-forces">` + p.forces.map((f) => {
      const c = facColor(f.f), em = f.eid ? { eid: f.eid, anim: f.anim } : SUBFAC_ICON[(f.n || "").toUpperCase()];
      const ic = (em && em.eid) ? enemyIcon(em, "") : `<img src="${facIcon(f.f)}" alt="">`;
      return `<span class="haz force" style="--fac:${c}">${ic}${esc(f.n)}</span>`;
    }).join("") + `</div>`;
  }
  function dashSupply(p) {
    const adj = p.adj || []; let h = "";
    if (adj.length) h += adj.map((a) => { const c = facColor(a.owner), globe = a.globe || "img/globes/default_planet.png"; return `<div class="pc-adj"><span class="mf-globe pc-adj-globe" style="background-image:url(${globe});--fac:${c}"></span><span class="pc-adj-name">${a.name}</span><span class="pc-adj-fac" style="color:${c}">${facName(a.owner)}</span></div>`; }).join("");
    const inbound = ATTACKS.filter((a) => a.b.p.i === p.i).map((a) => a.a.p.name), outbound = ATTACKS.filter((a) => a.a.p.i === p.i).map((a) => a.b.p.name);
    if (inbound.length) h += subh("UNDER ASSAULT FROM", "atk") + inbound.map((n) => `<div class="pc-line atk">${n}</div>`).join("");
    if (outbound.length) h += subh("STAGING ASSAULT ON") + outbound.map((n) => `<div class="pc-line">${n}</div>`).join("");
    return h;
  }
  function dashRegions(p) {
    if (!p.regions || !p.regions.length) return "";
    return p.regions.map((r) => { const c = facColor(r.owner), pct = r.max > 0 ? Math.round(r.hp / r.max * 100) : 0, ic = "region_" + (r.ic || (/^FACTORY/.test(r.tier || "") ? "t1_factory" : "city")); return `<div class="pc-card"><div class="pc-card-top"><span class="pc-card-name"><span class="pc-region-ic" style="-webkit-mask:url(img/icons/${ic}.png) center/contain no-repeat;mask:url(img/icons/${ic}.png) center/contain no-repeat;background:${c}"></span>${r.name}</span><span class="pc-tier">${r.tier || ""}</span></div><div class="pc-bar"><span style="width:${Math.max(2, pct)}%;background:${c};box-shadow:0 0 7px ${c}"></span></div><div class="pc-card-sub"><span style="color:${c}">${facName(r.owner)}</span><span>${pct}%</span></div></div>`; }).join("");
  }
  function dashCampaign(p) {
    let h = "", m = tipMeta(p);
    if (p.active || p.ev) h += `<div class="pc-op"><img src="img/icons/${(m.campIc && m.campIc !== "campaign_claim" ? m.campIc : "campaign_liberation")}.png" alt=""><div><b>${m.title}</b><span>${m.mode === "event" ? (m.isDefense ? "Active defense campaign" : "Liberation campaign") : "Active campaign"}</span></div></div>`;
    const fleets = (DATA.fleets || []).filter((f) => f.planet && f.planet.toUpperCase() === (p.name || "").toUpperCase());
    if (fleets.length) h += subh("DETECTED FLEETS") + fleets.map((f) => { const fac = f.faction === 0 ? 1 : f.faction, src = FLEET_ICON_SRC[fac] || FLEET_ICON_SRC[2]; return `<div class="pc-fleet"><img class="pc-fleet-ship" src="${src}" alt=""><span class="pc-fleet-lvl">LV ${f.level}</span><span class="pc-fleet-name">${f.name}</span><span class="pc-fleet-verb ${f.faction === 1 ? "def" : "atk"}">${f.faction === 1 ? "DEF" : "ATK"}</span></div>`; }).join("");
    return h;
  }

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
  function safeUrl(u) { return /^https?:\/\//i.test(u || "") ? esc(u) : "#"; }
  function loreInline(str) {
    let s = esc(str);
    s = s.replace(/\[link=([^\]]+)\]([\s\S]*?)\[\/link\]/g, (m, u, t) => `<a href="${safeUrl(u)}" target="_blank" rel="noopener">${t}</a>`);
    s = s.replace(/\[c=(#[0-9a-fA-F]{3,8})\]([\s\S]*?)\[\/c\]/g, (m, c, t) => `<span style="color:${c}">${t}</span>`);
    s = s.replace(/\*\*([\s\S]+?)\*\*/g, "<b>$1</b>");
    s = s.replace(/(^|[^*])\*([^*][\s\S]*?)\*/g, "$1<i>$2</i>");
    return s;
  }
  const loreIcon = (n) => `img/icons/${esc(n)}.png`;
  function safeImg(u) { u = String(u || "").trim(); if (/^https?:\/\//i.test(u)) return esc(u); if (/^(img\/|\.\.?\/|\/)[\w./%\- ]*$/i.test(u)) return esc(u); return ""; }

  function poiPart(b) {
    switch (b && b.type) {
      case "text": return `<p class="poi-p">${loreInline(b.text)}</p>`;
      case "image": return `<figure class="poi-img"><img src="${safeImg(b.url)}" alt="" loading="lazy" onerror="this.closest('.poi-img').classList.add('img-fail')">${b.caption ? `<figcaption>${loreInline(b.caption)}</figcaption>` : ""}</figure>`;
      case "quote": return `<blockquote class="poi-q">${loreInline(b.text)}${b.by ? `<cite>${esc(b.by)}</cite>` : ""}</blockquote>`;
      default: return "";
    }
  }
  function poiCard(e) {
    const sc = /^#[0-9a-fA-F]{3,8}$/.test(e.statusColor || "") ? e.statusColor : "#ff5a5a";
    let h = `<div class="poi"><div class="poi-head">`;
    if (e.icon) h += `<img class="poi-ic" src="${loreIcon(e.icon)}" alt="">`;
    h += `<div class="poi-htext">`;
    if (e.category) h += `<div class="poi-cat">${esc(e.category)}</div>`;
    h += `<div class="poi-title">${esc(e.title)}</div></div>`;
    if (e.date) h += `<div class="poi-date">${esc(e.date)}</div>`;
    h += `</div>`;
    if (e.status) h += `<div class="poi-status" style="color:${sc};border-color:${sc}">${esc(e.status)}</div>`;
    if (Array.isArray(e.body)) h += `<div class="poi-body">${e.body.map(poiPart).join("")}</div>`;
    return h + `</div>`;
  }

  function renderLore(p) {
    const entry = LORE[String(p.i)], pois = entry && entry.poi;
    if (!pois || !pois.length) return `<div class="lore-empty">No points of interest on record for this world. Author its intel in <b>data/lore.json</b>.</div>`;
    return pois.map(poiCard).join("");
  }

  function openConsole(p) { consoleState = { p, m: tipMeta(p) }; consoleOpen = true; renderConsole(); consoleEl.classList.add("open"); consoleEl.setAttribute("aria-hidden", "false"); }
  function renderConsole() {
    consoleEl.innerHTML = buildDashboard(consoleState.p);
    consoleEl.querySelector("#pc-close").onclick = closeConsole;
    const tabBtns = consoleEl.querySelectorAll(".dsr-tab");
    const showTab = (id) => {
      consoleState.tab = id;
      tabBtns.forEach((x) => { const on = x.getAttribute("data-tab") === id; x.classList.toggle("on", on); x.setAttribute("aria-selected", on ? "true" : "false"); });
      consoleEl.querySelectorAll(".dsr-panel").forEach((pn) => pn.classList.toggle("on", pn.getAttribute("data-panel") === id));
    };
    tabBtns.forEach((b) => { b.onclick = () => showTab(b.getAttribute("data-tab")); });
    // restore the tab the user was on across the 30s live re-render (if it still exists)
    if (consoleState.tab && consoleEl.querySelector('.dsr-tab[data-tab="' + consoleState.tab + '"]')) showTab(consoleState.tab);
    paintGlanceBars();
    paintGlobeFx(typeof performance !== "undefined" ? performance.now() : 0);
  }
  function closeConsole() { consoleOpen = false; consoleState = null; selected = null; consoleEl.classList.remove("open"); consoleEl.setAttribute("aria-hidden", "true"); }
  function paintGlanceBars() {
    if (!consoleState) return; const p = consoleState.p, m = consoleState.m, off = animOff * PB.SPEED_SE;
    if (m.mode === "standard") { const cvs = consoleEl.querySelector(".wf-bar"); if (cvs) { const c = cvs.getContext("2d"); c.clearRect(0, 0, cvs.width, cvs.height); pbBar(c, 0, 0, cvs.width, cvs.height, p.lib, m.dispFac, off, animOff * PB.SPEED_EN, {}); } }
    else if (m.mode === "event") { const cvs = consoleEl.querySelector(".wf-eventbar"); if (cvs) drawEventBar(cvs, p, m.dispFac, off); }
    paintTimer(consoleEl);
  }

  function paintGlobeFx(ts) {
    if (!consoleState || !window.EnvFX) return;
    const p = consoleState.p; if (!p.fx || !p.fx.length) return;
    const cvs = consoleEl.querySelector(".wf-globe-fx"), globe = consoleEl.querySelector(".wf-globe-wrap .wf-globe");
    if (!cvs || !globe) return;
    const gw = globe.offsetWidth; if (!gw) return;
    const gR = gw / 2, size = Math.round(gR * 3.0), d = dpr;
    if (cvs._sz !== size || cvs._d !== d) {
      cvs.width = size * d; cvs.height = size * d; cvs.style.width = size + "px"; cvs.style.height = size + "px";
      cvs._sz = size; cvs._d = d;
    }
    const c = cvs.getContext("2d"); c.setTransform(d, 0, 0, d, 0, 0); c.clearRect(0, 0, size, size);
    window.EnvFX.drawClose(c, p.fx, size / 2, size / 2, gR, ts, RMOTION);
  }

  let animOff = 0, lastTs = 0, lastFrame = 0, _looping = false;
  function frame(ts) {
    ts = ts || (typeof performance !== "undefined" ? performance.now() : Date.now());

    if (cv.offsetParent === null || (typeof document !== "undefined" && document.hidden)) { _looping = false; lastTs = 0; lastFrame = 0; return; }
    const dt = lastTs ? Math.min(50, ts - lastTs) : 16.7; lastTs = ts; lastFrame = ts;

    try {
      animOff += dt / 30; stepCamAnim(ts); render(ts);
      if (compactState) paintCompactBar();
      if (consoleOpen) { paintGlanceBars(); paintGlobeFx(ts); }
    } catch (e) {
      if (!frame._warned) { frame._warned = true; if (typeof console !== "undefined") console.error("[map] render frame error (loop kept alive):", e); }
    }
    requestAnimationFrame(frame);
  }

  function startLoop() { if (_looping) return; _looping = true; lastTs = 0; requestAnimationFrame(frame); }
  setInterval(() => {
    if (cv.offsetParent === null || (typeof document !== "undefined" && document.hidden)) return;
    startLoop();
  }, 220);
  window.__mapRender = render;
  window.__mapResize = resize;

  let _mapEntered = false;
  function runMapLoader() {
    const el = document.getElementById("map-loader"); if (!el) return;
    const fill = document.getElementById("hp-fill"), pctEl = document.getElementById("hp-pct"), st = document.getElementById("hp-status");
    const lines = ["INITIALISING HOLOTABLE", "ESTABLISHING UPLINK TO HIGH COMMAND", "SYNCING GALACTIC WAR DATA", "CALIBRATING SECTOR TELEMETRY", "RENDERING GALAXY MAP"];
    const fin = () => el.classList.add("done");
    el.addEventListener("pointerdown", fin, { once: true });
    setTimeout(fin, 3400);
    if (RMOTION) { if (fill) fill.style.width = "100%"; if (pctEl) pctEl.textContent = "100"; if (st) st.textContent = "HOLOTABLE ONLINE"; fin(); return; }
    const DUR = 1900; let t0 = null, li = -1;
    (function step(ts) {
      if (el.classList.contains("done")) return;
      ts = ts || (typeof performance !== "undefined" ? performance.now() : Date.now());
      if (t0 == null) t0 = ts;
      const u = Math.min(1, (ts - t0) / DUR), p = Math.round((1 - Math.pow(1 - u, 2)) * 100);
      if (fill) fill.style.width = p + "%"; if (pctEl) pctEl.textContent = p;
      const wl = Math.min(lines.length - 1, Math.floor(u * lines.length));
      if (wl !== li) { li = wl; if (st) st.textContent = lines[li]; }
      if (u < 1) requestAnimationFrame(step);
      else { if (st) st.textContent = "HOLOTABLE ONLINE - STAND BY, HELLDIVER"; setTimeout(fin, 520); }
    })();
  }
  window.__mapEnter = function () { if (_mapEntered) return; _mapEntered = true; runMapLoader(); };

  window.__refreshDispatch = function () {
    if (!DATA) return Promise.resolve(0);
    const prevIds = new Set((DATA.dispatch || []).map((d) => d.id));
    return Promise.all([
      J("data/dispatch.json", []),
      fetch("live/dispatch_posts.json", { cache: "no-store" }).then((r) => r.ok ? r.json() : []).catch(() => []),
    ]).then(([disp, live]) => {
      DATA.dispatch = Array.isArray(disp) ? disp : [];
      mergeLivePosts(live);
      const added = DATA.dispatch.filter((d) => !prevIds.has(d.id)).length;
      if (added > 0 || DATA.dispatch.length !== prevIds.size) buildDispatch();
      return added;
    }).catch(() => 0);
  };

  window.__refreshMap = function () {
    if (!DATA) return Promise.resolve(0);
    const prevDisp = new Set((DATA.dispatch || []).map((d) => d.id));
    const j = (u, fb) => fetch(u, { cache: "no-store" }).then((r) => r.ok ? r.json() : fb).catch(() => fb);
    return Promise.all([
      j("data/map.json", null), j("data/planets.json", null),
      j("data/dispatch.json", []), j("data/fleets.json", []), j("data/bestiary.json", {}),
      j("live/dispatch_posts.json", []),
    ]).then(([core, planets, disp, fleets, bestiary, live]) => {
      const mapOk = core && Array.isArray(planets) && planets.length;
      if (mapOk && core.fetchedAt !== DATA.fetchedAt) {
        const prevDATA = DATA, prevFAC = FAC;
        try {
          DATA = core; DATA.planets = planets;
          DATA.dispatch = Array.isArray(disp) ? disp : [];
          DATA.fleets = Array.isArray(fleets) ? fleets : [];
          DATA.bestiary = bestiary || {};
          FAC = core.factions || {};
          rehydratePlanets(); mergeLivePosts(live);
          buildScene(); fillStats(); fillMajorOrder(); buildFleets(); buildTicker(); buildHome();
          if (consoleOpen && consoleState && byIndex[consoleState.p.i]) { consoleState.p = byIndex[consoleState.p.i].p; renderConsole(); }
          staticKey = ""; render();
        } catch (e) {

          DATA = prevDATA; FAC = prevFAC;
          if (typeof console !== "undefined") console.error("[map] live refresh failed (kept previous scene):", e);
        }
      } else {
        if (mapOk && Array.isArray(disp)) DATA.dispatch = disp;
        mergeLivePosts(live);
      }
      const added = DATA.dispatch.filter((d) => !prevDisp.has(d.id)).length;
      if (added > 0 || DATA.dispatch.length !== prevDisp.size) buildDispatch();
      return added;
    }).catch(() => 0);
  };
  window.__test = {
    pos: (i) => { const e = byIndex[i]; return e ? { sx: e.sx, sy: e.sy } : null; },
    borderCount: () => ({ total: ENEMY_BORDER.length, contested: ENEMY_BORDER.filter((b) => b.contested).length, cols: [...new Set(ENEMY_BORDER.map((b) => b.col))] }),
    benchRebuild(testDpr, n) {
      n = n || 12; const savedI = interacting;
      interacting = true;
      off.width = Math.round(cvW * testDpr); off.height = Math.round(cvH * testDpr);
      const sd = renderDpr; renderDpr = testDpr;
      const t0 = performance.now();
      for (let i = 0; i < n; i++) { staticKey = ""; buildStatic(); }
      const ms = (performance.now() - t0) / n;
      renderDpr = sd; interacting = savedI; off.width = Math.round(cvW * sd); off.height = Math.round(cvH * sd); staticKey = "";
      return { testDpr, msPerRebuild: +ms.toFixed(2), cvW, cvH, dpr };
    },
    hover(i) { const e = byIndex[i]; if (!e) return false; closeConsole(); hovered = e.p.i; showCompact(e.p); const r = cv.getBoundingClientRect(); moveCompact({ clientX: r.left + e.sx, clientY: r.top + e.sy }); return true; },
    click(i) { const e = byIndex[i]; if (!e) return false; selectPlanet(e.p); return true; },
    firstActive() { const e = PLANETS.find((e) => e.p.active && !e.p.ev); return e ? e.p.i : null; },
    firstEvent() { const e = PLANETS.find((e) => e.p.ev); return e ? e.p.i : null; },
    cam: () => ({ x: cam.x, y: cam.y, zoom: cam.zoom, pitch: cam.pitch, rot: cam.rot }),
    zoomStep: (d) => { cam.zoom = Math.max(ZMIN, Math.min(ZMAX, cam.zoom * (1 + (d == null ? 0.06 : d)))); if (window.__mapRender) window.__mapRender(performance.now()); return cam.zoom; },
    setMO: (m) => { DATA.majorOrder = m; renderMO(); return true; },
    panTo: (i, z) => { const e = byIndex[i]; if (!e) return false; cam.x = e.wx; cam.y = e.wy; cam.zoom = z || 6; syncCam(); staticKey = ""; if (window.__mapRender) window.__mapRender(performance.now()); return true; },
    // Flat top-down view of the whole galaxy, centred, optionally stripped to a clean "minimap" look
    // (used by the lore editor's locator). pitch=1 is fully top-down in this projection.
    birdseye: (z, mini) => { cam.x = 0; cam.y = 0; cam.zoom = z || 0.9; cam.pitch = 1; cam.rot = 0; camAnim = null; if (mini) { LAYERS.text = false; LAYERS.effects = false; LAYERS.attacks = false; LAYERS.subfactions = false; } syncCam(); staticKey = ""; if (window.__mapRender) window.__mapRender(performance.now()); return true; },
    setLayers: (o) => { if (o) { for (const k in o) { if (k in LAYERS) LAYERS[k] = !!o[k]; } } staticKey = ""; if (window.__mapRender) window.__mapRender(performance.now()); return true; },

    perf() {
      const N = 90; let i = 0, t0 = performance.now(), worst = 0, prev = t0;
      return new Promise((res) => {
        const tick = (ts) => {
          const dt = ts - prev; prev = ts; if (i > 2 && dt > worst) worst = dt;
          if (++i < N) { requestAnimationFrame(tick); return; }
          const total = performance.now() - t0, fps = Math.round(1000 / (total / N));
          res({ dpr, devicePixelRatio: window.devicePixelRatio, canvas: cv.width + "x" + cv.height, css: cvW + "x" + cvH, avgFps: fps, worstFrameMs: +worst.toFixed(1) });
        };
        requestAnimationFrame(tick);
      });
    },
    marks: () => ({ dss: DSS ? DATA.dss.name : null,
                    mo: MO_MARKS.map((m) => ({ verb: m.verb, planet: (byIndex[m.index] || {}).p ? byIndex[m.index].p.name : m.index })),
                    defense: PLANETS.filter((e) => e.p.ev && e.p.ev.type === 1).map((e) => ({ planet: e.p.name, attacker: facName(e.p.ev.race) })),
                    homeMarkersGone: PLANETS.filter((e) => e.p.home != null).length }),
    injectMO: (idx, verb) => { MO_MARKS = [{ index: idx, verb: verb }]; staticKey = null; return true; },
    quality: () => ({ interacting, renderDpr, dpr, offW: off.width, cvW: cv.width }),
    sceneCounts: () => ({ data: DATA.planets.length, rendered: PLANETS.length, links: LINKS.length, attacks: ATTACKS.length,
                          unreachableInData: DATA.planets.filter(isUnreachable).length,
                          anyRenderedUnreachable: PLANETS.filter((e) => isUnreachable(e.p)).length,
                          subfacMarks: SUBFAC_MARKS.length, fxMarks: FX_MARKS.length,
                          subfacFleetsEnabled: FLEETS_ENABLED }),
    voidCells: () => FX_MARKS.filter((e) => e.voidCell).map((e) => ({
      name: e.p.name, verts: e.voidCell.length,
      screen: e.voidCell.map((v) => { const q = project(v.x, v.y, 0); return [Math.round(q.x), Math.round(q.y)]; }) })),
    fxCheck: () => {
      if (window.__mapRender) window.__mapRender(performance.now());
      let sampled = null;
      if (FX_MARKS.length) {
        const e = FX_MARKS[0], cx = Math.round(e.sx * dpr), cy = Math.round(e.sy * dpr), R = Math.round(22 * dpr);
        const d = ctx.getImageData(Math.max(0, cx - R), Math.max(0, cy - R), R * 2, R * 2).data;
        let lit = 0; for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 30 && (d[i] + d[i + 1] + d[i + 2]) > 80) lit++;
        sampled = { name: e.p.name, fx: e.p.fx.map((f) => f.t), litPixels: lit };
      }
      return { count: FX_MARKS.length, types: FX_MARKS.flatMap((e) => e.p.fx.map((f) => f.t)), sampled };
    },
    vibeCheck: () => {
      const ai = PLANETS.find((x) => x.p.active); if (!ai) return { error: "no active" };
      hovered = ai.p.i; selected = null; window.__mapRender(performance.now());
      const cx = Math.round(ai.sx * dpr), cy = Math.round(ai.sy * dpr), R = Math.round(14 * dpr);
      const d = ctx.getImageData(Math.max(0, cx - R), Math.max(0, cy - R), R * 2, R * 2).data;
      let bright = 0; for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 40 && d[i + 2] > 180 && d[i + 1] > 180) bright++;
      let supply = 0;
      if (ATTACKS.length) { const a = ATTACKS[0], A = project(a.a.wx, a.a.wy, 0), B = project(a.b.wx, a.b.wy, 0);
        for (let s = 1; s < 8; s++) { const t = s / 8, x = Math.round((A.x + (B.x - A.x) * t) * dpr), y = Math.round((A.y + (B.y - A.y) * t) * dpr);
          try { const dd = ctx.getImageData(Math.max(0, x - 4), Math.max(0, y - 4), 8, 8).data; for (let i = 0; i < dd.length; i += 4) if (dd[i + 3] > 40 && dd[i] > 190 && dd[i + 1] > 150) supply++; } catch (_) {} } }
      return { reticleBright: bright, attacks: ATTACKS.length, supplyDotPix: supply };
    },
    gloomLinks: () => GLOOM_LINKS.map((l) => ({ a: l.a.p.name, b: l.b.p.name })),
    gloomBridge: () => {
      if (!GLOOM_LINKS.length) return { error: "no gloom links" };
      const lk = GLOOM_LINKS[0];
      cam.x = (lk.a.wx + lk.b.wx) / 2; cam.y = (lk.a.wy + lk.b.wy) / 2; cam.zoom = 2.6; cam.pitch = 0; cam.rot = 0;
      staticKey = null; window.__mapRender(performance.now());
      const mx = Math.round((lk.a.sx + lk.b.sx) / 2 * dpr), my = Math.round((lk.a.sy + lk.b.sy) / 2 * dpr);
      const d = ctx.getImageData(Math.max(0, mx - 8), Math.max(0, my - 8), 16, 16).data;
      let lit = 0; for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 20 && (d[i] + d[i + 1] + d[i + 2]) > 70) lit++;
      return { a: lk.a.p.name, b: lk.b.p.name, screenDist: Math.round(Math.hypot(lk.b.sx - lk.a.sx, lk.b.sy - lk.a.sy)), midLit: lit };
    },
    ringCheck: () => {
      const e = PLANETS.find((x) => x.p.active && x.p.lib > 15) || PLANETS.find((x) => x.p.active);
      if (!e) return { error: "no active planet" };
      const cx = Math.round(e.sx * dpr), cy = Math.round(e.sy * dpr), R = Math.round(13 * dpr);
      const d = ctx.getImageData(Math.max(0, cx - R), Math.max(0, cy - R), R * 2, R * 2).data;
      let cyan = 0; for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 40 && d[i + 2] > d[i] + 25 && d[i + 1] > d[i] && d[i + 2] > 140) cyan++;
      return { planet: e.p.name, lib: e.p.lib, ringCyanPixels: cyan, ringRendered: cyan > 4 };
    },
    sectorPix: () => {
      const s = SECTORS.find((x) => x.enemy && x.fillHex); if (!s) return { error: "no enemy sector" };
      const q = project(s.cx, s.cy, 0), dx = Math.round(q.x * dpr), dy = Math.round(q.y * dpr);
      let best = 0, sample = null;
      for (let row = -10; row <= 10; row += 3) {
        try {
          const d = ctx.getImageData(Math.max(0, dx - 32), Math.max(0, dy + row), 64, 1).data, lum = [];
          for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 20) lum.push((d[i] + d[i + 1] + d[i + 2]) / 3);
          if (lum.length > 10) { const rng = Math.max(...lum) - Math.min(...lum); if (rng > best) { best = rng; sample = lum.map((x) => Math.round(x)); } }
        } catch (_) {}
      }
      return { fillHex: s.fillHex, alpha: +s.alpha.toFixed(2), interacting, lumRange: Math.round(best), striped: best > 22, sample: sample && sample.slice(0, 24) };
    },
  };

  function fillMajorOrder() {
    renderMO();
    const mo = DATA.majorOrder; if (!mo) return;
    setText("mo-title", mo.title); if (mo.brief) setText("mo-brief", mo.brief);
    const planets = (mo.tasks || []).map((t) => t.planet).filter(Boolean);
    if (planets.length) setText("mo-objective", "HOLD: " + planets.join(" - "));
    setText("mo-reward", (mo.rewards && mo.rewards.length) ? mo.rewards.map((r) => r.amount || r).join(" + ") : "CLASSIFIED");
    if (mo.expiresIn > 0) window.__MO_DEADLINE = Date.now() + mo.expiresIn * 1000;
  }

  function moEndsIn(secs) {
    secs = Math.max(0, secs | 0); if (secs <= 0) return "EXPIRED";
    const d = Math.floor(secs / 86400), h = Math.floor((secs % 86400) / 3600), m = Math.floor((secs % 3600) / 60);
    return d > 0 ? d + "D " + h + "H" : h > 0 ? h + "H " + m + "M" : m + "M";
  }
  function moBar(t) {
    const kind = t.kind || "count", goal = t.goal || 0, pv = t.progress || 0;
    if (kind === "liberation") { const pct = t.complete ? 100 : 0; return `<div class="mo-bar lib"><span style="width:${pct}%"></span><i>${pct.toFixed(1)}%</i></div>`; }
    if (kind === "segments") { const n = Math.max(1, goal); let s = ""; for (let i = 0; i < n; i++) s += `<b class="${i < pv ? "on" : ""}"></b>`; return `<div class="mo-bar seg">${s}</div>`; }
    if (kind === "tugofwar") { const sign = pv >= 0 ? "+" : ""; return `<div class="mo-bar tug"><span class="lost"></span><span class="won"></span></div><div class="mo-tugd"><span class="mo-tri"></span>${sign}${pv}</div>`; }
    const pct = goal ? Math.min(100, pv / goal * 100) : 0;
    return `<div class="mo-bar cnt"><span style="width:${pct}%"></span><i>${pv.toLocaleString()} (${pct.toFixed(1)}%)</i></div>`;
  }
  function renderMO() {
    const el = document.getElementById("home-mo"); if (!el) return;
    const mo = DATA && DATA.majorOrder;
    el.style.setProperty("--acc", "#ffe21f");
    if (!mo) {
      el.innerHTML = `<div class="mo-head"><span class="mo-tic"></span><span class="mo-htitle mq"><span>MAJOR ORDER</span></span></div><div class="mo-hr"></div><div class="mo-standby">AWAITING DIRECTIVE<span>Stand by for orders, Helldiver.</span></div>`;
      return;
    }
    const tasks = (mo.tasks || []).map((t) => {
      const cap = (t.segments && t.segments.length ? t.segments : [[t.verb || "OBJECTIVE", false]])
        .map((seg) => `<span class="${seg[1] ? "hl" : ""}">${esc(String(seg[0]))}</span>`).join("");
      const noBar = t.complete && t.kind === "liberation";
      return `<div class="mo-task${t.complete ? " done" : ""}" style="--ft:${facColor(t.race || 0)}"><div class="mo-trow"><div class="mo-cap">${cap}</div><span class="mo-box"></span></div>${noBar ? "" : moBar(t)}</div>`;
    }).join("");
    const reward = mo.rewardAmount ? `<div class="mo-reward"><div class="mo-rwtxt"><i>REWARD</i><b>${esc(mo.rewardType || "")}</b></div><div class="mo-medal"><span class="mo-medal-ic"></span><b>${mo.rewardAmount}</b></div></div>` : "";
    el.innerHTML =
      `<div class="mo-head"><span class="mo-tic"></span><span class="mo-htitle mq"><span>${esc(mo.title || "MAJOR ORDER")}</span></span><span class="mo-ends">ENDS IN <b>${moEndsIn(mo.expiresIn)}</b></span></div>` +
      `<div class="mo-hr"></div>` +
      (mo.brief ? `<div class="mo-brief">${esc(mo.brief)}</div>` : "") +
      `<div class="mo-tasks">${tasks}</div>` + reward;
    marquee(el);
  }
  const FAC_CLASS = { 1: "f-superearth", 2: "f-terminid", 3: "f-automaton", 4: "f-illuminate" };
  const facKey = (s) => /TERMINID/.test(s) ? 2 : /AUTOMATON/.test(s) ? 3 : /ILLUMINATE/.test(s) ? 4 : 1;

  const MIN_FALLBACK = { truth: { name: "Ministry of Truth", handle: "@SE_Truth", accent: "#FE90F5" }, defense: { name: "Ministry of Defense", handle: "@SE_Defense", accent: "#3AA0FF" } };
  let ACCOUNTS = {}, ACCT_ORDER = [], DISPATCH_ITEMS = [], dispMin = "all";
  function buildAccounts() {
    ACCOUNTS = {}; ACCT_ORDER = [];
    (DATA.accounts && DATA.accounts.length ? DATA.accounts : Object.keys(MIN_FALLBACK).map((id) => Object.assign({ id }, MIN_FALLBACK[id]))).forEach((a) => { ACCOUNTS[a.id] = a; ACCT_ORDER.push(a.id); });
  }
  const acct = (id) => ACCOUNTS[id] || ACCOUNTS.truth || { id: "se", name: "Super Earth", handle: "@SuperEarth", accent: "#FFE900" };
  function acctMono(a) { return (a.name || "?").split(/\s+/).filter((w) => /[A-Z]/.test(w[0] || "")).map((w) => w[0]).join("").slice(0, 2).toUpperCase() || "SE"; }
  function avatarHtml(a, extra) {
    if (a.icon) return `<span class="ava ava-svg${extra ? " " + extra : ""}" style="--ac:${a.accent}"><img src="img/ministries/${esc(a.icon)}.svg" alt="" onerror="this.parentElement.classList.add('noimg');this.parentElement.textContent='${acctMono(a)}'"></span>`;
    return `<span class="ava${extra ? " " + extra : ""}" style="--ac:${a.accent}">${acctMono(a)}</span>`;
  }
  function agoLabel(ts) { if (!ts || ts < 1e9) return "LIVE"; let s = Math.max(0, Date.now() / 1000 - ts); if (s < 60) return "now"; const m = Math.floor(s / 60); if (m < 60) return m + "m"; const h = Math.floor(m / 60); if (h < 24) return h + "h"; return Math.floor(h / 24) + "d"; }
  function postDate(ts) { if (!ts || ts < 1e9) return "LIVE"; const d = new Date(ts * 1000); return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) + " " + d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }); }
  function eng(s) { let h = 5381; for (let i = 0; i < (s || "").length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return h; }
  function kfmt(n) { return n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, "") + "K" : String(n); }

  function buildDispatch() {
    buildAccounts();
    DISPATCH_ITEMS = (Array.isArray(DATA.dispatch) ? DATA.dispatch.slice() : []).sort((a, b) => (b.ts || 0) - (a.ts || 0));
    const tag = document.getElementById("dispatch-count"); if (tag) tag.textContent = DISPATCH_ITEMS.length + " TRANSMISSIONS";
    renderDispRail(); renderDispatch();
  }
  function renderDispRail() {
    const rail = document.getElementById("dispatch-rail"); if (!rail) return;
    const counts = {}; DISPATCH_ITEMS.forEach((d) => counts[d.ministry] = (counts[d.ministry] || 0) + 1);
    const active = ACCT_ORDER.filter((id) => counts[id]);
    let h = `<div class="rail-h">ACCOUNTS</div>`;
    h += `<button class="acct${dispMin === "all" ? " on" : ""}" data-min="all"><span class="ava all">SE</span><span class="acct-id"><b>All Ministries</b><span>the full feed</span></span></button>`;
    active.forEach((id) => { const a = acct(id); h += `<button class="acct${dispMin === id ? " on" : ""}" data-min="${id}">${avatarHtml(a)}<span class="acct-id"><b>${a.name}${a.verified !== false ? '<i class="vchk">&#10003;</i>' : ""}</b><span>${a.handle} - ${counts[id]}</span></span></button>`; });
    rail.innerHTML = h;
    rail.querySelectorAll(".acct").forEach((b) => b.onclick = () => { dispMin = b.dataset.min; renderDispRail(); renderDispatch(); });
  }
  function dispatchPost(d, i, idp) {
    const a = acct(d.ministry), inc = (i === 0 || d.severity === "critical") ? " incoming" : "";
    const e = eng(d.title || ""), salutes = 240 + e % 18000, shares = 30 + (e >> 5) % 4200;
    const tag = d.faction >= 1 ? `<span class="ftag" style="--fac:${facColor(d.faction)}">${facName(d.faction)}</span>` : "";
    const tcol = d.accent || a.accent, tlabel = d.name || d.type;
    const media = d.image ? `<div class="post-media"><img src="${esc(d.image)}" alt="" loading="lazy" onerror="this.closest('.post-media').remove()"></div>` : "";
    return `<article class="post${inc}" id="${idp || "post-"}${esc(d.id || "")}" style="--ac:${a.accent}"><div class="post-head">${avatarHtml(a)}<div class="post-id"><div class="post-name">${a.name}${a.verified !== false ? '<i class="vchk">&#10003;</i>' : ""}</div><div class="post-sub">${a.handle} - ${agoLabel(d.ts)}</div></div><span class="post-type" style="color:${tcol};border-color:${tcol}">${tlabel}</span></div>` +
      `<div class="post-title">${d.title || ""}</div><p class="post-body">${d.body || ""}</p>${media}` +
      `<div class="post-foot"><span class="post-plat">HOLOTABLE - ${postDate(d.ts)}</span>${tag}<span class="eng"><b>${kfmt(salutes)}</b> SALUTES</span><span class="eng"><b>${kfmt(shares)}</b> SHARES</span><button class="post-share" data-id="${esc(d.id || "")}" title="Copy link">SHARE</button></div></article>`;
  }

  function openDispatchPost(id) {
    const el = document.getElementById("post-" + id);
    if (!el) { if (dispMin !== "all") { dispMin = "all"; renderDispRail(); renderDispatch(); } return setTimeout(() => openDispatchPost(id), 30); }
    el.scrollIntoView({ block: "center", behavior: "smooth" }); el.classList.add("flash");
    setTimeout(() => el.classList.remove("flash"), 1600);
  }
  window.__openDispatchPost = openDispatchPost;
  function renderDispatch() {
    const feed = document.getElementById("dispatch-feed"); if (!feed) return;
    const items = DISPATCH_ITEMS.filter((d) => dispMin === "all" || d.ministry === dispMin);
    feed.innerHTML = items.length ? items.map((d, i) => dispatchPost(d, i)).join("") : `<div class="fleet-empty">No transmissions from this account.</div>`;
    if (!feed.dataset.wired) {
      feed.dataset.wired = "1";
      feed.addEventListener("click", (ev) => {
        const b = ev.target.closest(".post-share"); if (!b) return;
        const url = location.origin + location.pathname + "#dispatch?post=" + b.dataset.id;
        if (navigator.clipboard) navigator.clipboard.writeText(url).catch(() => {});
        const o = b.textContent; b.textContent = "LINK COPIED"; setTimeout(() => { b.textContent = o; }, 1400);
      });
    }
  }

  let FLEETS = [], fleetSort = "faction";
  function normFleet(f) {
    const fac = f.faction === 0 ? 1 : f.faction;
    const role = f.role || (f.faction === f.owner ? "DEFENDING" : "ATTACKING");
    const maxLvl = (DATA.stats && DATA.stats.maxFleetLevel) || 18;
    const strength = (f.strength != null) ? f.strength : Math.min(1, (f.level || 1) / maxLvl);
    return Object.assign({}, f, { fac, role, strength });
  }
  function enemyIcon(em, cls) {
    if (!em || !em.eid) return "";
    const ext = em.anim ? "gif" : "png";
    return `<img class="${cls || "esp"}" src="img/enemies/${em.eid}.${ext}" alt="" loading="lazy" onerror="this.onerror=null;this.src='https://cdn.discordapp.com/emojis/${em.eid}.${ext}'">`;
  }
  function spawnsPanel(f) {
    const subs = (f.subs && f.subs.length) ? f.subs : (f.strain ? [f.strain] : []);
    let h = `<div class="fleet-spawns">`;

    const facFallback = `<span class="strain-ic" style="display:inline-block;-webkit-mask:url(${facIcon(f.fac)}) center/contain no-repeat;mask:url(${facIcon(f.fac)}) center/contain no-repeat;background:${facColor(f.fac)}"></span>`;
    if (subs.length) h += `<div class="subs-h">SPAWN ${subs.length > 1 ? "SUBFACTIONS - " + subs.length : "SUBFACTION"}</div><div class="subs-row">` +
      subs.map((s) => `<div class="strain" title="${esc(s.label || "STRAIN")}">${enemyIcon(s.emoji, "strain-ic") || facFallback}<span>${esc(s.label || "STRAIN")}</span></div>`).join("") + `</div>`;
    else h += `<div class="spawns-empty">No spawn manifest on file.</div>`;

    return h + `</div>`;
  }
  function fleetRow(f) {
    const col = facColor(f.fac), ic = facIcon(f.fac), def = f.role === "DEFENDING";
    return `<div class="fleet-item"><div class="fleet-row" style="--fac:${col}"><span class="fleet-glyph" style="-webkit-mask:url(${ic}) center/contain no-repeat;mask:url(${ic}) center/contain no-repeat;background:${col}"></span><div class="fleet-lvl">LV ${f.level}</div><div class="fleet-info"><div class="fn">${f.name}</div><div class="fl">${f.planet}</div><div class="fleet-bar"><span style="width:${Math.max(5, Math.round(f.strength * 100))}%;background:${col};box-shadow:0 0 7px ${col}"></span></div></div><div class="fleet-verb ${def ? "def" : "atk"}">${def ? "DEFENDING" : "ATTACKING"}</div><span class="fl-exp">&#9662;</span></div>${spawnsPanel(f)}</div>`;
  }

  function fleetSummary() {
    if (!FLEETS.length) return "0 ACTIVE";
    const atk = FLEETS.filter((f) => f.role === "ATTACKING").length, def = FLEETS.length - atk, top = Math.max.apply(null, FLEETS.map((f) => f.level));
    return `<b>${atk}</b> ATK / <b>${def}</b> DEF - TOP LV ${top}`;
  }

  function rosterHTML(sort) {
    if (!FLEETS.length) return `<div class="fleet-empty">No active fleets in the galaxy.</div>`;
    if (sort === "faction") {
      let h = "";
      [1, 2, 3, 4].forEach((fc) => {
        const g = FLEETS.filter((f) => f.fac === fc); if (!g.length) return;
        const col = facColor(fc), ga = g.filter((f) => f.role === "ATTACKING").length, gd = g.length - ga;
        h += `<div class="fleet-group"><div class="fg-head" style="--fac:${col}"><span class="fleet-glyph" style="-webkit-mask:url(${facIcon(fc)}) center/contain no-repeat;mask:url(${facIcon(fc)}) center/contain no-repeat;background:${col}"></span><span class="fg-name" style="color:${col}">${facName(fc)}</span><span class="fg-tot">${g.length} FLEETS - ${ga}A / ${gd}D</span></div>` +
          g.sort((a, b) => b.level - a.level).map(fleetRow).join("") + `</div>`;
      });
      return h;
    }
    const arr = FLEETS.slice();
    if (sort === "level") arr.sort((a, b) => b.level - a.level);
    else arr.sort((a, b) => (a.role < b.role ? -1 : a.role > b.role ? 1 : b.level - a.level));
    return arr.map(fleetRow).join("");
  }
  function renderFleets() {
    const list = document.getElementById("fleet-list"), count = document.getElementById("fleet-count"); if (!list) return;
    if (count) count.innerHTML = fleetSummary();
    list.innerHTML = rosterHTML(fleetSort);
  }

  let mapFleetSort = "faction";
  const mfCollapsed = new Set();
  const mfOpen = new Set();

  function marquee(root) {
    (root || document).querySelectorAll(".mq").forEach((el) => {
      const inner = el.firstElementChild; if (!inner) return;
      const over = inner.scrollWidth - el.clientWidth;
      if (over > 3 && el.clientWidth > 4) {
        el.style.setProperty("--mqd", (over + 10) + "px");
        el.style.setProperty("--mqt", Math.max(4, (over + 10) / 24).toFixed(1) + "s");
        el.classList.add("on");
      } else { el.classList.remove("on"); el.style.removeProperty("--mqd"); el.style.removeProperty("--mqt"); }
    });
  }
  const MF_JUMP = '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="8" cy="8" r="3.3"/><path d="M8 1v2.4M8 12.6V15M1 8h2.4M12.6 8H15" stroke-linecap="round"/></svg>';
  function mfDrawer(f) {
    const def = f.role === "DEFENDING";
    const meta = `<div class="mf-meta">` +
      `<span class="mf-mk">LOCATION</span><span class="mf-mv">${esc(f.planet)}</span>` +
      `<span class="mf-mk">${def ? "POSTURE" : "TARGET HELD BY"}</span><span class="mf-mv ${def ? "def" : "atk"}">${def ? "GARRISON / DEFENDING" : esc(facName(f.owner))}</span>` +
      `<span class="mf-mk">STRENGTH</span><span class="mf-mv">LV ${f.level} - ${Math.round(f.strength * 100)}% RATING</span>` +
      `</div>`;
    return `<div class="mf-drawer"><div class="mf-drawer-in">${meta}${spawnsPanel(f)}</div></div>`;
  }
  function mapFleetRow(f) {
    const col = facColor(f.fac), ic = facIcon(f.fac), def = f.role === "DEFENDING";
    const pct = Math.max(6, Math.round(f.strength * 100)), units = (f.subs && f.subs.length) || 0;
    const ge = byIndex[f.planetIndex], globe = (ge && ge.p && ge.p.globe) || "";
    const fk = f.name + "|" + f.planetIndex, op = mfOpen.has(fk) ? " open" : "";
    return `<div class="mf-item${op}" style="--fac:${col}" data-pi="${f.planetIndex == null ? "" : f.planetIndex}" data-fk="${esc(fk)}">` +
      `<div class="mf-row">` +
        `<span class="mf-glyph" style="-webkit-mask:url(${ic}) center/contain no-repeat;mask:url(${ic}) center/contain no-repeat;background:${col}"></span>` +
        `<div class="mf-body">` +
          `<div class="mf-l1"><span class="mf-name mq" title="${esc(f.name)}"><span>${esc(f.name)}</span></span><span class="mf-loc" title="${esc(f.planet)}">${globe ? `<span class="mf-globe" style="background-image:url(${globe})"></span>` : ""}<span class="mf-loc-t">${esc(f.planet)}</span></span></div>` +
          `<div class="mf-l2"><span class="mf-lv">LV ${f.level}</span><span class="mf-bar"><span style="width:${pct}%;background:${col};box-shadow:0 0 7px ${col}"></span></span><span class="mf-role ${def ? "def" : "atk"}">${def ? "DEF" : "ATK"}</span>${units ? `<span class="mf-str">${units} STR</span>` : ""}</div>` +
        `</div>` +
        `<button class="mf-jump" title="Locate on map" aria-label="Locate ${esc(f.name)}">${MF_JUMP}</button>` +
        `<span class="mf-exp" title="Manifest">&#9662;</span>` +
      `</div>` + mfDrawer(f) + `</div>`;
  }
  function mapRosterHTML() {
    if (!FLEETS.length) return `<div class="fleet-empty">No active fleets in the galaxy.</div>`;
    if (mapFleetSort === "faction") {
      let h = "";
      [1, 2, 3, 4].forEach((fc) => {
        const g = FLEETS.filter((f) => f.fac === fc); if (!g.length) return;
        const col = facColor(fc), ga = g.filter((f) => f.role === "ATTACKING").length, gd = g.length - ga;
        const avg = Math.round(g.reduce((s, f) => s + f.level, 0) / g.length), isCol = mfCollapsed.has(fc);
        h += `<div class="mf-group${isCol ? " col" : ""}" data-fac="${fc}">` +
          `<div class="mf-ghead" style="--fac:${col}"><span class="mf-glyph" style="-webkit-mask:url(${facIcon(fc)}) center/contain no-repeat;mask:url(${facIcon(fc)}) center/contain no-repeat;background:${col}"></span><span class="mf-gname" style="color:${col}">${facName(fc)}</span><span class="mf-gmeta">${ga}A / ${gd}D - AVG ${avg}</span><span class="mf-gcount">${g.length}</span><span class="mf-gchev">&#9662;</span></div>` +
          `<div class="mf-gbody"><div class="mf-ginner">` + g.sort((a, b) => b.level - a.level).map(mapFleetRow).join("") + `</div></div>` +
        `</div>`;
      });
      return h;
    }
    const arr = FLEETS.slice();
    if (mapFleetSort === "level") arr.sort((a, b) => b.level - a.level);
    else arr.sort((a, b) => (a.role < b.role ? -1 : a.role > b.role ? 1 : b.level - a.level));
    return arr.map(mapFleetRow).join("");
  }
  function renderMapFleets() {
    const list = document.getElementById("mf-list"); if (!list) return;
    const sum = document.getElementById("mf-sum"); if (sum) sum.innerHTML = fleetSummary();
    const cnt = document.getElementById("mf-count"); if (cnt) cnt.textContent = FLEETS.length;
    list.innerHTML = mapRosterHTML();
    marquee(list);
  }

  function locateFleet(pi, itEl) {
    const e = byIndex[pi]; if (!e) return;
    document.querySelectorAll("#mf-list .mf-item.active").forEach((x) => x.classList.remove("active"));
    if (itEl) itEl.classList.add("active");

    selected = e.p.i; hovered = null; hideCompact(); hideFleetCard();
    animateCam({ x: e.wx, y: e.wy, zoom: Math.max(cam.zoom, 2.2) }, 600);
  }
  function buildFleets() {
    FLEETS = (DATA.fleets || []).map(normFleet);
    const box = document.getElementById("fleet-sort");
    if (box && !box.dataset.wired) { box.dataset.wired = "1"; box.querySelectorAll("button").forEach((b) => b.onclick = () => { fleetSort = b.dataset.sort; box.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b)); renderFleets(); }); }
    const list = document.getElementById("fleet-list");
    if (list && !list.dataset.wired) { list.dataset.wired = "1"; list.addEventListener("click", (e) => { const it = e.target.closest(".fleet-item"); if (it) it.classList.toggle("open"); }); }
    renderFleets();

    const msort = document.getElementById("mf-sort");
    if (msort && !msort.dataset.wired) { msort.dataset.wired = "1"; msort.querySelectorAll("button").forEach((b) => b.onclick = () => { mapFleetSort = b.dataset.sort; msort.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b)); renderMapFleets(); }); }
    const mlist = document.getElementById("mf-list");
    if (mlist && !mlist.dataset.wired) {
      mlist.dataset.wired = "1";
      mlist.addEventListener("click", (e) => {
        const head = e.target.closest(".mf-ghead");
        if (head) { const grp = head.parentElement, fc = +grp.dataset.fac; grp.classList.toggle("col"); if (grp.classList.contains("col")) mfCollapsed.add(fc); else mfCollapsed.delete(fc); return; }
        const jump = e.target.closest(".mf-jump");
        if (jump) { const it = jump.closest(".mf-item"), pi = it && it.dataset.pi; if (pi) locateFleet(+pi, it); return; }
        const it = e.target.closest(".mf-item");
        if (it) { const fk = it.dataset.fk, now = it.classList.toggle("open"); if (fk) { if (now) mfOpen.add(fk); else mfOpen.delete(fk); } }
      });
    }
    const panel = document.getElementById("map-fleets");
    if (panel && !panel.dataset.wired) { panel.dataset.wired = "1"; panel.addEventListener("pointerdown", (e) => e.stopPropagation()); panel.addEventListener("wheel", (e) => e.stopPropagation(), { passive: true }); }
    renderMapFleets();
  }

  function stripLore(s) { return String(s || "").replace(/\[c=#?[0-9a-fA-F]{3,8}\]|\[\/c\]|\*\*|\*|\[link=[^\]]+\]|\[\/link\]/g, ""); }
  function loreCount() { let n = 0; for (const k in LORE) { if (/^\d+$/.test(k) && LORE[k] && LORE[k].poi) n += LORE[k].poi.length; } return n; }
  function firstPoi() { for (const k in LORE) { if (!/^\d+$/.test(k)) continue; const e = LORE[k]; if (e && e.poi && e.poi.length) { const pl = byIndex[k]; return { entry: e.poi[0], planetName: pl ? pl.p.name : "" }; } } return null; }
  function buildHome() {
    const s = DATA.stats || {};
    const setC = (id, val, suffix) => { const e = document.getElementById(id); if (!e) return; e.dataset.count = String(val); if (suffix != null) e.dataset.suffix = suffix; };
    setC("h-lib", s.seControlledPct ?? 0, "%"); setC("h-camp", s.activeCampaigns ?? 0, ""); setC("h-fleets", (DATA.fleets || []).length, ""); setC("h-enemy", (100 - (s.seControlledPct || 0)).toFixed(1), "%");
    if (window.__animateCounters) window.__animateCounters();
    const dir = document.getElementById("home-directive");
    if (dir) dir.innerHTML = `ACTIVE DIRECTIVE &mdash; <span>${(DATA.majorOrder && DATA.majorOrder.brief) ? esc(DATA.majorOrder.brief) : "All fronts contested. Liberation of the galaxy is ongoing. Stand by for orders, Helldiver."}</span>`;
    setText("dc-war", "SE CONTROL " + (s.seControlledPct ?? "--") + "%");
    setText("dc-fleets", (DATA.fleets || []).length + " ACTIVE");
    setText("dc-status", (s.activeCampaigns ?? "--") + " CAMPAIGNS");
    setText("dc-dss", DATA.dss ? DATA.dss.name : "DSS");
    const pn = loreCount(); setText("dc-dispatch", pn ? pn + " INTEL FILES" : "MINISTRY OF TRUTH");
    renderMO(); buildHomeFeatured();
  }
  function buildHomeDispatch() {
    const box = document.getElementById("home-dispatch"); if (!box) return;
    let card;
    if (DISPATCH_ITEMS && DISPATCH_ITEMS.length) card = dispatchPost(DISPATCH_ITEMS[0], 0, "home-post-");
    else { const p = firstPoi(); const e = p && p.entry; card = `<article class="post" style="--ac:#FE90F5"><div class="post-head"><span class="ava" style="--ac:#FE90F5">MT</span><div class="post-id"><div class="post-name">Ministry of Truth<i class="vchk">&#10003;</i></div><div class="post-sub">@SE_Truth - LIVE</div></div></div><div class="post-title">${e ? esc(e.title) : "All Fronts Contested"}</div><p class="post-body">${e ? esc(stripLore(e.body && e.body[0] ? e.body[0].text : "")).slice(0, 180) : "Liberation of the galaxy is ongoing. Spread Managed Democracy."}</p></article>`; }
    box.innerHTML = card;
  }
  function buildHomeFeatured() {
    const box = document.getElementById("home-featured"); if (!box) return;
    const ps = DATA.planets || [];
    const p = ps.find((x) => x.active && x.ev) || ps.filter((x) => x.active).sort((a, b) => b.lib - a.lib)[0] || ps.slice().sort((a, b) => b.lib - a.lib)[0];
    if (!p) { box.innerHTML = ""; return; }
    const col = facColor(p.owner), m = tipMeta(p), val = p.active ? p.lib : (p.max > 0 ? p.hp / p.max * 100 : 0);
    const tag = p.ev ? (p.owner === 1 ? "DEFENSE" : "LIBERATION") : (p.active ? m.title : ""), res = resistance(p), rc = RES_CLASS(res);
    box.innerHTML = `<a class="feat-card" href="#war" style="--fac:${col}"><span class="feat-globe-wrap"><span class="feat-globe" style="background-image:url(${p.globe})"></span>${hpRingSVG(p, "dsr-hpring feat-hpring")}</span><div class="feat-body"><div class="feat-fac" style="color:${col}">${facName(p.owner)}${tag ? " - " + tag : ""}</div><div class="feat-name">${p.name}</div><div class="feat-biome">${p.biome || ""}</div><div class="feat-pct"><b>${val.toFixed(1)}%</b> ${p.active ? "LIBERATED" : "CONTROL"} <span style="color:${rc[1]}">RESISTANCE ${rc[0]}</span></div></div></a>`;
  }
  function fillStats() {
    const s = DATA.stats || {};
    const setC = (id, val, suffix) => { const e = document.getElementById(id); if (!e) return; e.dataset.count = String(val); if (suffix != null) e.dataset.suffix = suffix; };
    setC("st-lib", s.seControlledPct ?? 0, "%"); setC("st-fleets", (DATA.fleets || []).length, ""); setC("st-contested", s.activeCampaigns ?? 0, ""); setC("st-enemy", (100 - (s.seControlledPct || 0)).toFixed(1), "%");
    if (window.__animateCounters) window.__animateCounters();
  }
  function buildTicker() {
    const track = document.getElementById("ticker-track"); if (!track) return;
    const s = DATA.stats || {}; const nm = {}; DATA.planets.forEach((p) => (nm[p.i] = p.name));
    const lines = [];
    if (DATA.majorOrder) lines.push(`MAJOR ORDER: <b>${DATA.majorOrder.brief}</b>`);
    lines.push(`SUPER EARTH CONTROLS <b>${s.seControlledPct}%</b> OF THE GALAXY`); lines.push(`<b>${s.activeCampaigns}</b> ACTIVE CAMPAIGNS ACROSS THE FRONT`);
    DATA.planets.filter((p) => p.active).sort((a, b) => b.lib - a.lib).slice(0, 3).forEach((p) => lines.push(`LIBERATION AT <b>${p.name}</b> - ${p.lib}%`));
    (DATA.attacks || []).slice(0, 3).forEach((a) => lines.push(`ENEMY ASSAULT ON <b>${nm[a.t]}</b>`));
    if (!lines.length) return;
    const html = lines.map((h) => `<span>&#9656; ${h}</span>`).join("");
    track.innerHTML = matchMedia("(prefers-reduced-motion: reduce)").matches ? html : html + html;
  }
})();
