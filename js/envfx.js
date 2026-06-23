
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
    const T = gloomTiers(), B = newBuckets(NB), STEP = 4, t = rm ? 0 : ts * 0.0006;
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
        addDot(B, NB, sx + gx, sy + gy, b, b > 0.62 ? 1.8 : 1.35);
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

  function fieldVoid(ctx, sx, sy, R, c, ts, rm, simple) {
    const STEP = 4;
    ctx.save(); ctx.globalCompositeOperation = "lighter";
    for (let gx = -R; gx <= R; gx += STEP) {
      const col = (gx * 0.5) | 0, drag = h1(col), torn = h1(col + 40);
      const streak = rm ? 1 : 1 + drag * 8;
      const flick = (!rm && Math.sin(col * 7 + ts / 150) < -0.3) ? 0.22 : 1;
      const xoff = torn > 0.86 ? (h1(col + 7) - 0.5) * 9 : 0;
      for (let gy = -R; gy <= R; gy += STEP) {
        const nx = gx / R, ny = gy / R, d = Math.hypot(nx, ny);
        if (d > 1.04) continue;
        const band = 0.5 + 0.5 * Math.sin(gy * 0.3 + col);
        let b = (0.3 + 0.7 * band) * (1 - d * 0.55) * flick; b = b < 0 ? 0 : b > 1 ? 1 : b;
        if (b < 0.08) continue;
        ctx.globalAlpha = 0.2 + 0.6 * b; ctx.fillStyle = b > 0.82 ? "#fff" : c;
        ctx.fillRect(sx + gx + xoff - 0.9, sy + gy, 1.8, 1.5 + streak * b);
      }
    }
    if (!rm) {
      const ty = sy - R + ((ts * 0.12) % (2 * R));
      ctx.globalAlpha = 0.28; ctx.fillStyle = GR; ctx.fillRect(sx - R, ty, 2 * R, 1.6);
      ctx.fillStyle = GC; ctx.fillRect(sx - R, ty + 2.5, 2 * R * (0.4 + 0.5 * h1((ts / 200) | 0)), 1.2);
    }
    ctx.restore();
  }

  // Cyberpunk 2077 "Blackwall" look: vertical data-streak columns with chromatic (red/cyan) RGB
  // split on the bright cores. phaseX/phaseY anchor the pattern to the map so it stops "swimming"
  // against the region edge when you pan, and the per-column dim is a slow shimmer rather than the
  // old hard strobe (which read as wonky in motion).
  function voidFieldRect(ctx, x0, y0, x1, y1, c, ts, rm, simple, phaseX, phaseY) {
    phaseX = phaseX || 0; phaseY = phaseY || 0;
    const STEP = simple ? 6 : 4;
    ctx.save(); ctx.globalCompositeOperation = "lighter";
    for (let gx = x0; gx <= x1; gx += STEP) {
      const col = ((gx - phaseX) * 0.5) | 0, drag = h1(col), torn = h1(col + 40);
      const streak = rm ? 1 : 1 + drag * 7;
      const dimCol = rm ? 1 : 0.5 + 0.5 * (0.5 + 0.5 * Math.sin(col * 1.7 + ts / 900));
      const xoff = (!rm && torn > 0.9) ? (h1(col + 7) - 0.5) * 7 : 0;
      for (let gy = y0; gy <= y1; gy += STEP) {
        const band = 0.5 + 0.5 * Math.sin((gy - phaseY) * 0.28 + col);
        let b = (0.3 + 0.7 * band) * dimCol; b = b < 0 ? 0 : b > 1 ? 1 : b;
        if (b < 0.1) continue;
        const hgt = 1.5 + streak * b, bx = gx + xoff;
        if (!rm && b > 0.62) {
          ctx.globalAlpha = 0.16 * b; ctx.fillStyle = GR; ctx.fillRect(bx - 2.2, gy, 1.6, hgt);
          ctx.globalAlpha = 0.16 * b; ctx.fillStyle = GC; ctx.fillRect(bx + 1.0, gy, 1.6, hgt);
        }
        ctx.globalAlpha = 0.18 + 0.55 * b; ctx.fillStyle = b > 0.85 ? "#fff" : c;
        ctx.fillRect(bx - 0.9, gy, 1.8, hgt);
      }
    }
    if (!rm) {
      const hh = Math.max(1, y1 - y0), ty = y0 + ((ts * 0.12) % hh);
      ctx.globalAlpha = 0.22; ctx.fillStyle = GR; ctx.fillRect(x0, ty, x1 - x0, 1.6);
      ctx.fillStyle = GC; ctx.fillRect(x0, ty + 2.5, (x1 - x0) * (0.4 + 0.5 * h1((ts / 200) | 0)), 1.2);
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
    const B = newBuckets(NB), R = gR * 1.15, STEP = 4, t = rm ? 0 : ts * 0.05;
    for (let gy = -R; gy <= R; gy += STEP) {
      for (let gx = -R; gx <= R; gx += STEP) {
        const nx = gx / R, ny = gy / R, d = Math.hypot(nx, ny);
        if (d > 1.04) continue;
        const col = (gx * 0.5) | 0, drag = h1(col), dy = rm ? 0 : (drag * R * 0.5 + t * (0.5 + drag)) % (R * 0.6);
        const band = 0.5 + 0.5 * Math.sin(gy * 0.3 + col);
        let b = (0.3 + 0.7 * band) * (1 - d * 0.6);
        if (!rm && Math.sin(col * 7.0 + ts / 150) < -0.3) b *= 0.25;
        b = b < 0 ? 0 : b > 1 ? 1 : b;
        addDot(B, NB, cx + gx, cy + gy - dy * 0.3, b, 1.5);
      }
    }
    ctx.save(); ctx.globalCompositeOperation = "lighter";
    paintBuckets(ctx, B, NB, (k) => ({ c: k > 0.8 ? "#fff" : c, a: 0.2 + 0.62 * k }));
    ctx.restore();
  }
  function drawClose(ctx, fxList, cx, cy, gR, ts, rm) {
    for (let i = 0; i < fxList.length; i++) {
      const t = fxList[i].t, c = fxList[i].c;
      if (t === "gloom") closeGloom(ctx, cx, cy, gR, ts, rm);
      else if (t === "vortex") closeVortex(ctx, cx, cy, gR, c, ts, rm);
      else if (t === "black_hole") closeBH(ctx, cx, cy, gR, c, ts, rm);
      else if (t === "void") closeVoid(ctx, cx, cy, gR, c, ts, rm);
    }
  }

  return { draw, drawClose, gloomBlob, voidFieldRect };
})();
