
window.EnvFX = (function () {
  "use strict";
  const TAU = Math.PI * 2;

  function hexA(hex, a) {
    const h = hex.replace("#", "");
    const v = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
    return `rgba(${(v >> 16) & 255},${(v >> 8) & 255},${v & 255},${a})`;
  }
  function hexRGBarr(hex) {
    const h = hex.replace("#", ""), v = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  }
  function h1(n) { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); }

  function gloomTiers() { return { dim: "#8c7a24", mid: "#e3b21c", hot: "#ffe7a0" }; }

  const GR = "#ff2b5e", GC = "#27e0ff";

  function newBuckets(nb) { const a = new Array(nb); for (let i = 0; i < nb; i++) a[i] = new Path2D(); return a; }
  function addDot(buckets, nb, x, y, b, rad) {
    if (b <= 0.04) return;
    const k = b >= 1 ? nb - 1 : (b * nb) | 0;
    const p = buckets[k]; p.moveTo(x + rad, y); p.arc(x, y, rad, 0, TAU);
  }
  function paintBuckets(ctx, buckets, nb, palette) {
    for (let k = 0; k < nb; k++) {
      const t = (k + 0.5) / nb, col = palette(t);
      ctx.globalAlpha = col.a; ctx.fillStyle = col.c; ctx.fill(buckets[k]);
    }
  }
  const NB = 7;

  function fieldGloom(ctx, sx, sy, R, ts, rm, simple, seed) {
    const T = gloomTiers(), B = newBuckets(NB), STEP = 7, t = rm ? 0 : ts * 0.0006;
    const ph = (seed || 0) * 1.7;
    for (let gy = -R; gy <= R; gy += STEP) {
      for (let gx = -R; gx <= R; gx += STEP) {
        const nx = gx / R, ny = gy / R, d = Math.hypot(nx, ny);
        if (d > 1.1) continue;
        const a = Math.atan2(ny, nx);
        const warp = 0.82 + 0.2 * Math.sin(a * 3 + ph) + 0.12 * Math.sin(a * 5 - ph * 1.4);
        const z = Math.sqrt(Math.max(0, 1 - Math.min(1, d) * Math.min(1, d)));
        const light = Math.max(0, -nx * 0.34 - ny * 0.4 + z * 1.04);
        const edge = 1 - Math.pow(Math.min(1, d / warp), 2.4);
        const n = 0.5 + 0.5 * Math.sin(gx * 0.2 + t * 3.1 + ph) * Math.cos(gy * 0.18 - t * 2.3 + ph);
        const n2 = 0.5 + 0.5 * Math.sin((gx - gy) * 0.33 - t * 2.6 + ph * 0.6);
        let b = (0.4 + 0.6 * light) * edge * (0.4 + 0.5 * n + 0.22 * n2); b = b < 0 ? 0 : b > 1 ? 1 : b;
        addDot(B, NB, sx + gx, sy + gy, b, b > 0.62 ? 3.1 : 2.4);
      }
    }
    ctx.save(); ctx.globalCompositeOperation = "lighter";
    paintBuckets(ctx, B, NB, (k) => ({ c: k > 0.8 ? T.hot : k > 0.5 ? T.mid : T.dim, a: 0.16 + 0.6 * k }));
    ctx.restore();
  }

  function fieldVortex(ctx, sx, sy, R, c, ts, rm, simple, f) {
    const B = newBuckets(NB), STEP = 4, spin = rm ? 0 : ts * 0.0016;
    const dens = f && f.d ? f.d : 12, gain = 0.5 + Math.min(1, dens / 22) * 0.5;
    for (let gy = -R; gy <= R; gy += STEP) {
      for (let gx = -R; gx <= R; gx += STEP) {
        const nx = gx / R, ny = gy / R, d = Math.hypot(nx, ny);
        if (d > 1.04 || d < 0.03) continue;
        const ang = Math.atan2(ny, nx);
        const arms = Math.sin(2 * ang + 5 * Math.log(0.1 + d) - spin);
        let b = (0.5 + 0.5 * arms) * gain * (1 - d * 0.5);
        b *= 0.86 + 0.14 * Math.sin(d * 6 - spin * 1.3);
        b = b < 0 ? 0 : b > 1 ? 1 : b;
        addDot(B, NB, sx + gx, sy + gy, b, b > 0.6 ? 1.7 : 1.3);
      }
    }
    ctx.save(); ctx.globalCompositeOperation = "lighter";
    paintBuckets(ctx, B, NB, (k) => ({ c: k > 0.85 ? "#ffffff" : c, a: 0.14 + 0.5 * k }));
    const cg = ctx.createRadialGradient(sx, sy, 0, sx, sy, R * 0.18);
    cg.addColorStop(0, "rgba(255,255,255,0.72)"); cg.addColorStop(1, hexA(c, 0));
    ctx.globalAlpha = 1; ctx.fillStyle = cg; ctx.beginPath(); ctx.arc(sx, sy, R * 0.18, 0, TAU); ctx.fill();
    ctx.restore();
  }

  function fieldBH(ctx, sx, sy, R, c, ts, rm, simple) {
    const B = newBuckets(NB), STEP = 4, spin = rm ? 0 : ts * 0.0011, hr = 0.2;
    for (let gy = -R; gy <= R; gy += STEP) {
      for (let gx = -R; gx <= R; gx += STEP) {
        const nx = gx / R, ny = gy / R, d = Math.hypot(nx, ny);
        if (d > 1.02 || d < hr) continue;
        const ang = Math.atan2(ny, nx);
        const ring = Math.exp(-Math.pow((d - hr - 0.09) / 0.14, 2));
        let b = ring * (0.5 + 0.5 * Math.sin(ang * 2 - spin * 2.2)) + (1 - d) * 0.1;
        b = b < 0 ? 0 : b > 1 ? 1 : b;
        addDot(B, NB, sx + gx, sy + gy, b, b > 0.6 ? 1.6 : 1.25);
      }
    }
    ctx.save(); ctx.globalCompositeOperation = "lighter";
    paintBuckets(ctx, B, NB, (k) => ({ c: k > 0.85 ? "#ffffff" : c, a: 0.12 + 0.42 * k }));
    ctx.restore();
    const hrp = hr * R;
    ctx.save(); ctx.fillStyle = "rgba(2,0,8,0.92)"; ctx.beginPath(); ctx.arc(sx, sy, hrp, 0, TAU); ctx.fill();
    ctx.globalCompositeOperation = "lighter"; ctx.lineWidth = 1.3;
    ctx.strokeStyle = hexA(c, rm ? 0.55 : 0.42 + 0.18 * Math.sin(ts / 360));
    ctx.beginPath(); ctx.arc(sx, sy, hrp, 0, TAU); ctx.stroke(); ctx.restore();
  }

  // The Void is canonically "impenetrable darkness" born of an Illuminate Class-3 Exostorm, so it
  // reads as a DARK patch with a deep-violet/indigo cast -- not a glow. Same circular "voxel cell"
  // style as gloom / black holes over a dark core wash, with a faint Blackwall red/cyan flicker.
  function fieldVoid(ctx, sx, sy, R, c, ts, rm, simple) {
    const B = newBuckets(NB), STEP = 7, t = rm ? 0 : ts * 0.0008;
    const glitch = [];
    ctx.save();
    const dg = ctx.createRadialGradient(sx, sy, 0, sx, sy, R);
    dg.addColorStop(0, "rgba(13,5,30,0.66)"); dg.addColorStop(0.7, "rgba(13,5,30,0.4)"); dg.addColorStop(1, "rgba(13,5,30,0)");
    ctx.fillStyle = dg; ctx.beginPath(); ctx.arc(sx, sy, R, 0, TAU); ctx.fill();
    ctx.restore();
    for (let gy = -R; gy <= R; gy += STEP) {
      for (let gx = -R; gx <= R; gx += STEP) {
        const nx = gx / R, ny = gy / R, d = Math.hypot(nx, ny);
        if (d > 1.06) continue;
        const a = Math.atan2(ny, nx), edge = 1 - Math.pow(Math.min(1, d), 2.2);
        let n = 0.5 + 0.5 * Math.sin(gx * 0.16 + t * 3 + a) * Math.cos(gy * 0.15 - t * 2.4);
        n += 0.35 * (0.5 + 0.5 * Math.sin((gx - gy) * 0.3 - t * 4));
        let b = edge * (0.32 + 0.5 * n);
        if (!rm && Math.sin(h1((gx * 0.5) | 0) * 30 + ts * 0.012) < -0.4) b *= 0.32;
        b = b < 0 ? 0 : b > 1 ? 1 : b;
        addDot(B, NB, sx + gx, sy + gy, b, b > 0.64 ? 2.9 : 2.3);
        if (!rm && b > 0.84) glitch.push(sx + gx, sy + gy, b);
      }
    }
    ctx.save(); ctx.globalCompositeOperation = "lighter";
    paintBuckets(ctx, B, NB, (k) => ({ c: k > 0.9 ? "#e6d2ff" : k > 0.68 ? "#b96cff" : k > 0.42 ? "#8a3ff0" : "#5421a8", a: 0.14 + 0.5 * k }));
    for (let i = 0; i < glitch.length; i += 3) {
      ctx.globalAlpha = 0.12 * glitch[i + 2]; ctx.fillStyle = GR; ctx.beginPath(); ctx.arc(glitch[i] - 2, glitch[i + 1], 1.4, 0, TAU); ctx.fill();
      ctx.fillStyle = GC; ctx.beginPath(); ctx.arc(glitch[i] + 2, glitch[i + 1], 1.4, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  // WarForge-style void field as circular "voxel cells" (same system as gloom / black holes) but kept
  // DARK to match the canonical Void (impenetrable darkness, Illuminate-violet cast): a dark base wash
  // with dim indigo/violet cells and a faint Blackwall red/cyan flicker. phaseX/phaseY anchor the
  // cells to the map so the pattern doesn't swim against the region edge when you pan.
  function voidFieldRect(ctx, x0, y0, x1, y1, c, ts, rm, simple, phaseX, phaseY) {
    phaseX = phaseX || 0; phaseY = phaseY || 0;
    const w = x1 - x0, h = y1 - y0, t = rm ? 0 : ts * 0.00045;
    // The cell's on-screen rect grows with zoom^2, so a fixed pixel STEP made this the single most
    // expensive thing on the map when zoomed in (tens of thousands of noise samples/frame). Cap the
    // voxel count: past the cap, grow STEP and the dot radius together so it stays a smooth haze.
    const MAXV = 2400, base = simple ? 9 : 8;
    let STEP = base; const est = (w / base) * (h / base);
    if (est > MAXV) STEP = Math.sqrt((w * h) / MAXV);
    const ds = STEP / 5;   // dots sized vs the original 5px grid so coverage holds as STEP grows
    const B = newBuckets(NB), glitch = [];
    ctx.save(); ctx.globalAlpha = 0.5; ctx.fillStyle = "#0c0522"; ctx.fillRect(x0, y0, w, h); ctx.restore();
    for (let gy = y0; gy <= y1; gy += STEP) {
      for (let gx = x0; gx <= x1; gx += STEP) {
        const ux = (gx - phaseX) * 0.06, uy = (gy - phaseY) * 0.06;
        let n = 0.5 + 0.5 * Math.sin(ux + t * 3) * Math.cos(uy - t * 2.2);
        n += 0.45 * (0.5 + 0.5 * Math.sin((ux - uy) * 1.6 + t * 4));
        const colh = h1(((gx - phaseX) * 0.5) | 0);
        let b = n * (0.4 + 0.4 * colh);
        if (!rm && Math.sin(colh * 30 + ts * 0.012) < -0.4) b *= 0.32;
        b = b < 0 ? 0 : b > 1 ? 1 : b;
        if (b < 0.07) continue;
        addDot(B, NB, gx, gy, b, (b > 0.66 ? 1.9 : 1.4) * ds);
        if (!rm && b > 0.82 && colh > 0.55) glitch.push(gx, gy, b);
      }
    }
    ctx.save(); ctx.globalCompositeOperation = "lighter";
    paintBuckets(ctx, B, NB, (k) => ({ c: k > 0.9 ? "#e6d2ff" : k > 0.68 ? "#b96cff" : k > 0.42 ? "#8a3ff0" : "#5421a8", a: 0.14 + 0.5 * k }));
    const gr = 1.5 * ds;
    for (let i = 0; i < glitch.length; i += 3) {
      ctx.globalAlpha = 0.12 * glitch[i + 2]; ctx.fillStyle = GR; ctx.beginPath(); ctx.arc(glitch[i] - 2.2 * ds, glitch[i + 1], gr, 0, TAU); ctx.fill();
      ctx.fillStyle = GC; ctx.beginPath(); ctx.arc(glitch[i] + 2.2 * ds, glitch[i + 1], gr, 0, TAU); ctx.fill();
    }
    if (!rm) {
      const ty = y0 + ((ts * 0.1) % Math.max(1, h));
      ctx.globalAlpha = 0.14; ctx.fillStyle = GR; ctx.fillRect(x0, ty, w, 1.2);
      ctx.fillStyle = GC; ctx.fillRect(x0, ty + 2.2, w * (0.4 + 0.5 * h1((ts / 200) | 0)), 1.0);
    }
    ctx.restore();
  }

  function tierR(R, f) { return R * (0.72 + ((f && f.s ? f.s : 0.3) / 0.3) * 0.6); }
  function draw(ctx, fxList, x, y, R, ts, rm, simple, seed) {
    for (let i = 0; i < fxList.length; i++) {
      const f = fxList[i], t = f.t, c = f.c;
      if (t === "gloom") fieldGloom(ctx, x, y, tierR(R, f), ts, rm, simple, (seed || 0) + i * 3);
      else if (t === "vortex") fieldVortex(ctx, x, y, tierR(R, f), c, ts, rm, simple, f);
      else if (t === "black_hole") fieldBH(ctx, x, y, R * 0.95, c, ts, rm, simple);
      else if (t === "void") fieldVoid(ctx, x, y, R, c, ts, rm, simple);
    }
  }

  function gloomBlob(ctx, x, y, R, ts, rm, simple, seed) { fieldGloom(ctx, x, y, R, ts, rm, simple, seed); }

  function closeGloom(ctx, cx, cy, gR, ts, rm) {
    const T = gloomTiers(), B = newBuckets(NB), R = gR * 1.2, STEP = 4, t = rm ? 0 : ts * 0.0007;
    for (let gy = -R; gy <= R; gy += STEP) {
      for (let gx = -R; gx <= R; gx += STEP) {
        const nx = gx / R, ny = gy / R, d = Math.hypot(nx, ny);
        if (d > 1.04) continue;
        const z = Math.sqrt(Math.max(0, 1 - d * d)), light = Math.max(0, -nx * 0.38 - ny * 0.42 + z * 1.06);
        const edge = 1 - Math.pow(d < 1 ? d : 1, 2.4);
        const n = 0.5 + 0.5 * Math.sin(gx * 0.13 + t * 3.1) * Math.cos(gy * 0.12 - t * 2.3);
        let b = light * edge * (0.45 + 0.72 * n); b = b < 0 ? 0 : b > 1 ? 1 : b;
        addDot(B, NB, cx + gx, cy + gy, b, b > 0.62 ? 2.0 : 1.5);
      }
    }
    ctx.save(); ctx.globalCompositeOperation = "lighter";
    paintBuckets(ctx, B, NB, (k) => ({ c: k > 0.8 ? T.hot : k > 0.52 ? T.mid : T.dim, a: 0.16 + 0.64 * k }));
    ctx.restore();
  }

  function closeVortex(ctx, cx, cy, gR, c, ts, rm) {
    const PUR = c || "#b45bff", MAG = "#ff2fd0";
    ctx.save(); ctx.globalCompositeOperation = "lighter";

    const halo = ctx.createRadialGradient(cx, cy, gR * 0.78, cx, cy, gR * 1.22);
    halo.addColorStop(0, hexA(PUR, 0)); halo.addColorStop(0.4, hexA(PUR, 0.4)); halo.addColorStop(1, hexA(PUR, 0));
    ctx.globalAlpha = rm ? 0.8 : 0.68 + 0.3 * Math.sin(ts / 520);
    ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(cx, cy, gR * 1.22, 0, TAU); ctx.fill();
    const NT = 18;
    for (let i = 0; i < NT; i++) {
      const a = (i / NT) * TAU + (rm ? 0 : Math.sin(ts / 1100 + i) * 0.1);
      const flick = rm ? 0.7 : 0.32 + 0.68 * Math.abs(Math.sin(ts / 340 + i * 1.9));
      const reach = gR * (0.14 + 0.18 * h1(i) + (rm ? 0 : 0.05 * Math.sin(ts / 300 + i)));
      const col = h1(i + 9) > 0.62 ? MAG : PUR, steps = 6;
      for (let s = 1; s <= steps; s++) {
        const t = s / steps, wob = (rm ? 0 : Math.sin(ts / 250 + i * 2.0) * 0.16) * t;
        const rr = gR * 0.88 + reach * t;
        const px = cx + Math.cos(a + wob) * rr, py = cy + Math.sin(a + wob) * rr;
        const blobR = gR * (0.16 * (1 - t) + 0.045) * (1 + 0.5 * h1(i + s));
        const g = ctx.createRadialGradient(px, py, 0, px, py, blobR);
        g.addColorStop(0, hexA(col, 0.34 * flick * (1 - t * 0.55))); g.addColorStop(1, hexA(col, 0));
        ctx.globalAlpha = 1; ctx.fillStyle = g; ctx.beginPath(); ctx.arc(px, py, blobR, 0, TAU); ctx.fill();
      }
    }

    ctx.beginPath(); ctx.arc(cx, cy, gR, 0, TAU); ctx.clip();
    const NP = 13;
    for (let i = 0; i < NP; i++) {
      const a = h1(i) * TAU, rr = Math.pow(h1(i + 1), 0.6) * gR * 0.84;
      const px = cx + Math.cos(a) * rr, py = cy + Math.sin(a) * rr, pr = gR * (0.15 + 0.22 * h1(i + 2));
      const pulse = rm ? 0.7 : 0.42 + 0.58 * Math.abs(Math.sin(ts / 600 + i * 2.3));
      const col = h1(i + 5) > 0.5 ? MAG : PUR;
      const g = ctx.createRadialGradient(px, py, 0, px, py, pr);
      g.addColorStop(0, hexA(col, 0.62 * pulse)); g.addColorStop(0.5, hexA(col, 0.22 * pulse)); g.addColorStop(1, hexA(col, 0));
      ctx.globalAlpha = 1; ctx.fillStyle = g; ctx.beginPath(); ctx.arc(px, py, pr, 0, TAU); ctx.fill();
      ctx.globalAlpha = 0.5 * pulse; ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(px, py, pr * 0.15, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  const _bhRim = {};
  function bhRimSprite(col) {
    if (_bhRim[col]) return _bhRim[col];
    const sz = 256, cv = document.createElement("canvas"); cv.width = cv.height = sz;
    const c2 = cv.getContext("2d"), img = c2.createImageData(sz, sz), d = img.data, cen = sz / 2, norm = sz * 0.36, rgb = hexRGBarr(col);
    const PEAK = 0.9, SOFT = 0.12, FLOOR = 0.42, STR = 1.4, lx = -0.4, ly = -0.85, ln = Math.hypot(lx, ly);
    for (let y = 0; y < sz; y++) {
      for (let x = 0; x < sz; x++) {

        const nx = (x - (cen - 0.5)) / norm, ny = (y - (cen - 0.5)) / norm, rad = Math.hypot(nx, ny) || 1e-3;
        const band = Math.exp(-Math.pow((rad - PEAK) / SOFT, 2)), inv = 1 / rad;
        let litw = nx * inv * (lx / ln) + ny * inv * (ly / ln); litw = litw < 0 ? 0 : litw > 1 ? 1 : litw;
        let glow = band * (FLOOR + (1 - FLOOR) * litw) * STR; glow = glow < 0 ? 0 : glow > 1 ? 1 : glow;
        let heat = glow * 1.25 - 0.45; heat = heat < 0 ? 0 : heat > 1 ? 1 : heat;
        const i = (y * sz + x) * 4;
        d[i] = rgb[0] + (255 - rgb[0]) * heat; d[i + 1] = rgb[1] + (255 - rgb[1]) * heat; d[i + 2] = rgb[2] + (255 - rgb[2]) * heat; d[i + 3] = glow * 255;
      }
    }
    c2.putImageData(img, 0, 0); _bhRim[col] = cv; return cv;
  }

  function closeBH(ctx, cx, cy, gR, c, ts, rm) {
    ctx.save();
    ctx.fillStyle = "#000"; ctx.beginPath(); ctx.arc(cx, cy, gR, 0, TAU); ctx.fill();

    const rim = bhRimSprite(c), ext = gR * 1.54;
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = rm ? 1 : 1 - 0.14 * (0.5 - 0.5 * Math.sin(ts * 0.0016));
    ctx.translate(cx, cy);
    if (!rm) ctx.rotate((ts * 0.0002) % TAU);
    ctx.drawImage(rim, -ext, -ext, ext * 2, ext * 2);
    ctx.restore();

    ctx.save(); ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = rm ? 0.5 : 0.42 + 0.16 * Math.sin(ts * 0.002);
    ctx.strokeStyle = c; ctx.lineWidth = Math.max(1.5, gR * 0.028);
    ctx.beginPath(); ctx.arc(cx, cy, gR * 1.01, 0, TAU); ctx.stroke(); ctx.restore();
  }
  function closeVoid(ctx, cx, cy, gR, c, ts, rm) {
    const B = newBuckets(NB), R = gR * 1.15, STEP = 4, t = rm ? 0 : ts * 0.0009;
    const glitch = [];
    ctx.save();
    const dg = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
    dg.addColorStop(0, "rgba(13,5,30,0.72)"); dg.addColorStop(0.75, "rgba(13,5,30,0.44)"); dg.addColorStop(1, "rgba(13,5,30,0)");
    ctx.fillStyle = dg; ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.fill();
    ctx.restore();
    for (let gy = -R; gy <= R; gy += STEP) {
      for (let gx = -R; gx <= R; gx += STEP) {
        const nx = gx / R, ny = gy / R, d = Math.hypot(nx, ny);
        if (d > 1.04) continue;
        const a = Math.atan2(ny, nx), edge = 1 - Math.pow(Math.min(1, d), 2.0);
        let n = 0.5 + 0.5 * Math.sin(gx * 0.14 + t * 3.2 + a) * Math.cos(gy * 0.13 - t * 2.6);
        n += 0.4 * (0.5 + 0.5 * Math.sin((gx - gy) * 0.26 - t * 4.2));
        let b = edge * (0.3 + 0.55 * n);
        if (!rm && Math.sin(h1((gx * 0.5) | 0) * 30 + ts * 0.012) < -0.4) b *= 0.3;
        b = b < 0 ? 0 : b > 1 ? 1 : b;
        addDot(B, NB, cx + gx, cy + gy, b, b > 0.62 ? 1.9 : 1.4);
        if (!rm && b > 0.84) glitch.push(cx + gx, cy + gy, b);
      }
    }
    ctx.save(); ctx.globalCompositeOperation = "lighter";
    paintBuckets(ctx, B, NB, (k) => ({ c: k > 0.9 ? "#e6d2ff" : k > 0.68 ? "#b96cff" : k > 0.42 ? "#8a3ff0" : "#5421a8", a: 0.16 + 0.5 * k }));
    for (let i = 0; i < glitch.length; i += 3) {
      ctx.globalAlpha = 0.14 * glitch[i + 2]; ctx.fillStyle = GR; ctx.beginPath(); ctx.arc(glitch[i] - 2.2, glitch[i + 1], 1.6, 0, TAU); ctx.fill();
      ctx.fillStyle = GC; ctx.beginPath(); ctx.arc(glitch[i] + 2.2, glitch[i + 1], 1.6, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }
  // EMISSIVE Illuminate EXOSTORM (matches the HD2 look: a deep-purple hue radiating streaks outward, a
  // spinning vortex, a deep-purple hologram rim, and a few faint blue particles) — smooth/glowing, NOT
  // the old dotted voxel field. Used for both the 'void' and 'vortex' purple anomalies in the inspect.
  function closeExostorm(ctx, cx, cy, gR, c, ts, rm) {
    const col = c || "#b06bff", t = rm ? 0 : ts * 0.001;
    const lighten = (hex, f) => { const a = hexRGBarr(hex), m = (v) => (v + (255 - v) * f) | 0; return "#" + ((1 << 24) + (m(a[0]) << 16) + (m(a[1]) << 8) + m(a[2])).toString(16).slice(1); };
    const pulse = rm ? 1 : 0.85 + 0.15 * Math.sin(t * 2), rot = rm ? 0 : t * 0.45;
    ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.lineCap = "round"; ctx.lineJoin = "round";

    // deep-purple glow radiating outward from the globe
    const g = ctx.createRadialGradient(cx, cy, gR * 0.55, cx, cy, gR * 1.5);
    g.addColorStop(0, hexA(col, 0)); g.addColorStop(0.5, hexA(col, 0.18 * pulse));
    g.addColorStop(0.72, hexA(col, 0.11 * pulse)); g.addColorStop(1, hexA(col, 0));
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, gR * 1.5, 0, TAU); ctx.fill();

    // radiating purple streaks — IRREGULAR (varied length, jittered angle, gaps) so it reads as a storm,
    // not a uniform sun/urchin; wispy and thin, drifting slowly
    const N = 28;
    for (let i = 0; i < N; i++) {
      const h = h1(i * 7.3), h2 = h1(i * 3.1 + 5);
      if (h < 0.18) continue;                                   // gaps
      const a = rot * 0.6 + i * TAU / N + (h2 - 0.5) * 0.28;
      const len = gR * (0.18 + 0.75 * h * (0.7 + 0.3 * Math.sin(t * 1.8 + i)));
      const r0 = gR * 0.97, r1 = r0 + len, x0 = cx + Math.cos(a) * r0, y0 = cy + Math.sin(a) * r0, x1 = cx + Math.cos(a) * r1, y1 = cy + Math.sin(a) * r1;
      const lg = ctx.createLinearGradient(x0, y0, x1, y1);
      lg.addColorStop(0, hexA(col, 0.5)); lg.addColorStop(1, hexA(col, 0));
      ctx.strokeStyle = lg; ctx.lineWidth = 0.6 + h2 * 1.2; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    }

    // spinning vortex + glowing pockets, clipped to the disc
    ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, gR * 1.02, 0, TAU); ctx.clip();
    // two prominent bright spiral arms (the spinning vortex), tapering from the core
    for (let s = 0; s < 2; s++) {
      const base = rot * 1.7 + s * Math.PI;
      ctx.strokeStyle = hexA(lighten(col, 0.5), 0.5 * pulse); ctx.beginPath();
      for (let k = 0; k <= 48; k++) { const u = k / 48, rr = gR * 0.06 + gR * 0.96 * u, aa = base + u * 5.6, xx = cx + Math.cos(aa) * rr, yy = cy + Math.sin(aa) * rr; k ? ctx.lineTo(xx, yy) : ctx.moveTo(xx, yy); }
      ctx.lineWidth = 2.4; ctx.stroke();
      ctx.strokeStyle = hexA(lighten(col, 0.2), 0.22 * pulse); ctx.lineWidth = 5; ctx.stroke();   // soft underglow
    }
    // bright core of the vortex
    const cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, gR * 0.4);
    cg.addColorStop(0, hexA(lighten(col, 0.7), 0.55 * pulse)); cg.addColorStop(1, hexA(col, 0));
    ctx.fillStyle = cg; ctx.beginPath(); ctx.arc(cx, cy, gR * 0.4, 0, TAU); ctx.fill();
    // a few solid glowing energy pockets on the surface
    for (let i = 0; i < 4; i++) {
      const a = i * 1.9 + t * 0.5, rr = gR * (0.35 + 0.45 * h1(i * 9.1)), x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr, pr = (2.2 + 1.1 * Math.sin(t * 3 + i)) * 2.6;
      const pg = ctx.createRadialGradient(x, y, 0, x, y, pr);
      pg.addColorStop(0, "rgba(255,246,255,0.9)"); pg.addColorStop(0.35, hexA(lighten(col, 0.5), 0.6)); pg.addColorStop(1, hexA(col, 0));
      ctx.fillStyle = pg; ctx.beginPath(); ctx.arc(x, y, pr, 0, TAU); ctx.fill();
    }
    ctx.restore();

    // faint blue particles drifting in orbit
    for (let i = 0; i < 10; i++) {
      const a = i * 2.4 - t * 0.8, rr = gR * (1.0 + 0.4 * ((i * 0.29 + t * 0.05) % 1)), x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
      ctx.globalAlpha = 0.5 * (0.5 + 0.5 * Math.sin(t * 2 + i)); ctx.fillStyle = "#9fd6ff"; ctx.beginPath(); ctx.arc(x, y, 1.1, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;

    // deep-purple hologram rim
    ctx.strokeStyle = hexA(lighten(col, 0.3), 0.55 * pulse); ctx.lineWidth = 2.2;
    ctx.beginPath(); ctx.arc(cx, cy, gR, 0, TAU); ctx.stroke();
    ctx.restore();
  }

  function drawClose(ctx, fxList, cx, cy, gR, ts, rm) {
    for (let i = 0; i < fxList.length; i++) {
      const t = fxList[i].t, c = fxList[i].c;
      if (t === "gloom") closeGloom(ctx, cx, cy, gR, ts, rm);
      else if (t === "vortex" || t === "void") closeExostorm(ctx, cx, cy, gR, c, ts, rm);   // emissive exostorm
      else if (t === "black_hole") closeBH(ctx, cx, cy, gR, c, ts, rm);
    }
  }

  // EMISSIVE magma/lava globe (WarForge look): the lava texture's own bright veins ARE the emissive
  // source, so once per globe we bake them into a transparent glow sprite (threshold the hot pixels,
  // tint incandescent), then additively blit it over the globe each frame with a slow molten pulse.
  // No new art asset, no dotted voxel field. Cached by image URL so the per-pixel bake runs once.
  const _magma = {};
  function bakeMagma(img, S) {
    const cn = document.createElement("canvas"); cn.width = cn.height = S;
    const g = cn.getContext("2d"); g.drawImage(img, 0, 0, S, S);
    let d; try { d = g.getImageData(0, 0, S, S); } catch (e) { return null; }   // cross-origin would taint; local assets are fine
    const px = d.data;
    for (let i = 0; i < px.length; i += 4) {
      const r = px[i], gg = px[i + 1], b = px[i + 2];
      let m = (0.5 * r + 0.45 * gg - 0.4 * b - 95) / 130;   // hot = high red/green, low blue
      m = m < 0 ? 0 : m > 1 ? 1 : m; m *= m;                 // curve so only the molten veins glow
      px[i] = 255; px[i + 1] = (150 + 105 * m) | 0; px[i + 2] = (40 + 70 * m) | 0; px[i + 3] = (255 * m) | 0;
    }
    g.putImageData(d, 0, 0); return cn;
  }
  function closeMagma(ctx, cx, cy, gR, img, ts, rm) {
    if (!img || !img.complete || !img.naturalWidth) return;   // wait for the globe image to load
    const key = img.src; let spr = _magma[key];
    if (spr === undefined) spr = _magma[key] = bakeMagma(img, Math.max(64, Math.round(gR * 2)));
    if (!spr) return;
    const D = gR * 2, x = cx - gR, y = cy - gR, pulse = rm ? 0.85 : 0.72 + 0.24 * Math.sin(ts * 0.0013);
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, gR, 0, TAU); ctx.clip();   // confine the glow to the globe disc
    ctx.globalCompositeOperation = "lighter"; ctx.imageSmoothingEnabled = true;
    ctx.globalAlpha = 0.5 * pulse; ctx.drawImage(spr, x, y, D, D);                                     // crisp molten veins
    ctx.globalAlpha = 0.26 * pulse; ctx.drawImage(spr, x - D * 0.05, y - D * 0.05, D * 1.1, D * 1.1);  // soft bloom
    ctx.restore();
  }
  function drawMagma(ctx, cx, cy, gR, img, ts, rm) { closeMagma(ctx, cx, cy, gR, img, ts, rm); }

  return { draw, drawClose, gloomBlob, voidFieldRect, drawMagma };
})();
