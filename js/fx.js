
(function () {
  "use strict";
  const RM = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const $ = (s, r) => (r || document).querySelector(s);

  const SFX = { play() {}, isOn() { return false; }, ensure() {}, set() {}, init() {} };
  window.SFX = SFX;

  (function starfield() {
    const wrap = $(".galaxy-wrap"); if (!wrap) return;
    const sf = document.createElement("div");
    sf.className = "starfield"; sf.setAttribute("aria-hidden", "true");
    sf.innerHTML = '<span class="sf sf1"></span><span class="sf sf2"></span><span class="sf sf3"></span>';
    wrap.insertBefore(sf, wrap.firstChild);
  })();

  (function livePoll() {
    let stop = false;
    function syncPulse(n) {
      const tag = document.getElementById("dispatch-count");
      if (tag) { tag.classList.remove("synced"); void tag.offsetWidth; tag.classList.add("synced"); }
      if (n > 0) SFX.play("incoming"); else SFX.play("sync");
    }
    function poll() {
      const refresh = window.__refreshMap || window.__refreshDispatch;
      if (stop || typeof refresh !== "function") return Promise.resolve(0);
      if (document.hidden) return Promise.resolve(0);
      return Promise.resolve(refresh()).then((n) => { if (typeof n === "number") syncPulse(n); return n; }).catch(() => 0);
    }
    // No auto-polling: the war map is a snapshot loaded once. Refreshing live data is now manual via the
    // on-map refresh button (window.__forcePoll), so an idle map never re-fetches or rebuilds on its own.
    window.__forcePoll = poll;
  })();

  (function stratagems() {
    const A = { ArrowUp: "U", ArrowDown: "D", ArrowLeft: "L", ArrowRight: "R" };
    const GLYPH = { U: "↑", D: "↓", L: "←", R: "→" };

    const CODES = {
      "UDRLUD": "REINFORCE",
      "UUDDLRLR": "KONAMI",
      "DDRUR": "RESUPPLY",
    };
    const MAXLEN = 8;
    let seq = "", hud = null, hideT = null;
    function ensureHud() {
      if (hud) return hud;
      hud = document.createElement("div"); hud.className = "strat-hud"; hud.setAttribute("aria-hidden", "true");
      document.body.appendChild(hud); return hud;
    }
    function renderHud() {
      const h = ensureHud();
      h.innerHTML = seq.split("").map((c) => `<i>${GLYPH[c]}</i>`).join("");
      h.classList.add("show");
      clearTimeout(hideT); hideT = setTimeout(() => h.classList.remove("show"), 1400);
    }
    function fire(kind) {
      seq = "";
      if (hud) hud.classList.remove("show");
      if (kind === "REINFORCE") banner("REINFORCEMENTS INBOUND", "Hellpods deployed. Spread Democracy.", "rein");
      else if (kind === "RESUPPLY") banner("RESUPPLY DEPLOYED", "Ammunition, stims, and grenades incoming.", "resup");
      else if (kind === "KONAMI") banner("EXO-SUIT UNLOCKED", "By order of the Ministry of Defense. (Not really.)", "konami");
      SFX.play("stratOk");
    }
    function banner(title, sub, cls) {
      const b = document.createElement("div");
      b.className = "strat-banner " + cls;
      b.innerHTML = `<div class="sb-streak"></div><div class="sb-card"><b>${title}</b><span>${sub}</span></div>`;
      document.body.appendChild(b);
      requestAnimationFrame(() => b.classList.add("in"));
      setTimeout(() => { b.classList.remove("in"); setTimeout(() => b.remove(), 600); }, 2600);
    }
    window.addEventListener("keydown", (e) => {
      const t = e.target;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      const k = A[e.key]; if (!k) return;
      seq = (seq + k).slice(-MAXLEN);
      SFX.play("strat");
      renderHud();
      for (const code in CODES) { if (seq.endsWith(code)) { fire(CODES[code]); return; } }
    });
  })();
})();
