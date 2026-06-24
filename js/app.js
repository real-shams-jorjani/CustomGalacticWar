
function animateCounters() {
  document.querySelectorAll(".v[data-count]").forEach(el => {
    const target = parseFloat(el.dataset.count);
    const suffix = el.dataset.suffix || "";
    const decimals = (el.dataset.count.split(".")[1] || "").length;
    const fmt = (v) => (decimals ? v.toFixed(decimals) : Math.round(v).toLocaleString("en-US")) + suffix;
    const start = performance.now();
    const dur = 1300;
    let done = false;
    function step(now) {
      if (done) return;
      const t = Math.min(1, (now - start) / dur);
      el.textContent = fmt(target * (1 - Math.pow(1 - t, 3)));
      if (t < 1) requestAnimationFrame(step); else done = true;
    }
    requestAnimationFrame(step);

    setTimeout(() => { if (!done) { done = true; el.textContent = fmt(target); } }, dur + 120);
  });
}

const statObserver = new IntersectionObserver((entries) => {
  entries.forEach(e => {
    if (e.isIntersecting) { animateCounters(); statObserver.disconnect(); }
  });
}, { threshold: 0.4 });
statObserver.observe(document.getElementById("status"));

window.__animateCounters = animateCounters;

const fallbackDeadline = Date.now() + (2 * 24 * 3600 + 7 * 3600 + 42 * 60) * 1000;
const cdEl = document.getElementById("countdown");
function tickCountdown() {
  const deadline = window.__MO_DEADLINE || fallbackDeadline;
  let s = Math.max(0, Math.floor((deadline - Date.now()) / 1000));
  const d = Math.floor(s / 86400); s -= d * 86400;
  const h = Math.floor(s / 3600);  s -= h * 3600;
  const m = Math.floor(s / 60);    s -= m * 60;
  const pad = n => String(n).padStart(2, "0");
  cdEl.textContent = `${d}D ${pad(h)}:${pad(m)}:${pad(s)}`;
}
tickCountdown();
setInterval(tickCountdown, 1000);

const HEADLINES = [
  "MAJOR ORDER ACTIVE: <b>LIBERATE THE SEVERIN SECTOR</b> - 6/9 WORLDS SECURED",
  "TERMINID SPORE TIDE REPELLED AT <b>ESTANU</b> - LIBERATION HOLDING AT 63%",
  "<b>DSS AEGIS OF LIBERTY</b> ENTERS FTL TRANSIT TO THE FRONT LINE",
  "ILLUMINATE ANOMALY DETECTED NEAR <b>MERIDIA</b> - DEEP-SCAN ONGOING",
  "STRATAGEM UPTIME DEGRADED AT <b>DRAUPNIR</b> - DESTROY JAMMER TOWERS",
  "RECRUITMENT UP 12% - SUPER EARTH THANKS YOU FOR YOUR SERVICE",
];
const track = document.getElementById("ticker-track");
const line = HEADLINES.map(h => `<span>&#9656; ${h}</span>`).join("");

track.innerHTML = matchMedia("(prefers-reduced-motion: reduce)").matches ? line : line + line;

let revealIOAlive = false;
const revealIO = new IntersectionObserver((entries) => {
  revealIOAlive = true;
  entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); revealIO.unobserve(e.target); } });
}, { threshold: 0.12, rootMargin: "0px 0px -7% 0px" });

setTimeout(() => { if (!revealIOAlive) document.querySelectorAll(".reveal:not(.in)").forEach((el) => { el.style.transition = "none"; el.classList.add("in"); }); }, 1500);
function armGroup(nodes) {
  [...nodes].filter(Boolean).forEach((el, i) => {
    if (el.dataset.armed) return;
    el.dataset.armed = "1";
    el.classList.add("reveal");
    el.style.setProperty("--ri", i % 8);
    revealIO.observe(el);
  });
}

function scanReveal() {
  const home = document.querySelector('.view[data-view="home"]'); if (!home) return;
  armGroup([home.querySelector(".home-hero")]);
  home.querySelectorAll(".section-head").forEach((el) => armGroup([el]));
  armGroup(home.querySelectorAll(".stat"));
  armGroup([home.querySelector(".home-two")]);
  armGroup([home.querySelector(".dest-grid")]);
}
scanReveal();

const cdBox = document.querySelector(".countdown");
function markUrgency() {
  const deadline = window.__MO_DEADLINE || fallbackDeadline;
  if (cdBox) cdBox.classList.toggle("low", deadline - Date.now() < 3600 * 1000);
}
markUrgency();
setInterval(markUrgency, 1000);
