
(function () {
  var VIEWS = ["home", "war"];
  var DEFAULT = "home";
  var sections = {};
  VIEWS.forEach(function (v) { sections[v] = document.querySelector('.view[data-view="' + v + '"]'); });
  var links = [].slice.call(document.querySelectorAll('.topbar a[data-view]'));

  function activateMap() {

    if (window.__mapEnter) window.__mapEnter();
    requestAnimationFrame(function () {
      if (window.__mapResize) window.__mapResize();
      else if (window.__mapRender) window.__mapRender();
    });
  }

  function show(name) {
    if (!sections[name]) name = DEFAULT;
    VIEWS.forEach(function (v) { if (sections[v]) sections[v].classList.toggle("is-active", v === name); });
    links.forEach(function (a) { a.classList.toggle("active", a.dataset.view === name); });
    document.body.classList.toggle("on-home", name === "home");
    document.body.classList.toggle("on-war", name === "war");
    window.scrollTo(0, 0);
    if (name === "war") activateMap();
  }

  function route() {
    var raw = (location.hash || "").replace(/^#/, "");
    var q = raw.indexOf("?");
    var name = q >= 0 ? raw.slice(0, q) : raw;
    var query = q >= 0 ? raw.slice(q + 1) : "";
    show(VIEWS.indexOf(name) >= 0 ? name : DEFAULT);

    if (name === "dispatch" && query) {
      var m = /(?:^|&)post=([^&]+)/.exec(query);
      if (m && window.__openDispatchPost) requestAnimationFrame(function () { window.__openDispatchPost(decodeURIComponent(m[1])); });
    }
  }

  window.addEventListener("hashchange", route);

  var navToggle = document.getElementById("nav-toggle");
  if (navToggle) navToggle.addEventListener("click", function () { document.querySelector(".topbar nav").classList.toggle("open"); });
  links.forEach(function (a) { a.addEventListener("click", function () { document.querySelector(".topbar nav").classList.remove("open"); }); });

  route();
  window.__route = route;
})();
