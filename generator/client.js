(function () {
  // theme
  document.getElementById("theme-toggle").addEventListener("click", function () {
    var r = document.documentElement, c = r.getAttribute("data-theme");
    var dark = c ? c === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
    r.setAttribute("data-theme", dark ? "light" : "dark");
  });

  // tabs
  var tabs = Array.prototype.slice.call(document.querySelectorAll(".tab"));
  var views = { decisions: document.getElementById("view-decisions"), behaviour: document.getElementById("view-behaviour"), diff: document.getElementById("view-diff") };
  tabs.forEach(function (t) {
    t.addEventListener("click", function () {
      tabs.forEach(function (x) { x.classList.toggle("on", x === t); });
      Object.keys(views).forEach(function (k) {
        if (views[k]) views[k].classList.toggle("on", k === t.dataset.tab);
      });
    });
  });

  // decisions master/detail
  var items = Array.prototype.slice.call(document.querySelectorAll(".di"));
  var panes = Array.prototype.slice.call(document.querySelectorAll(".dpane"));
  items.forEach(function (b) {
    b.addEventListener("click", function () {
      items.forEach(function (x) { x.classList.toggle("on", x === b); });
      panes.forEach(function (p) { p.classList.toggle("on", p.dataset.idx === b.dataset.idx); });
      var d = document.querySelector(".md-detail"); if (d) d.scrollTop = 0;
    });
  });
  if (items[0]) items[0].classList.add("on");

  // diff line -> reasoning drawer
  var whyCards = Array.prototype.slice.call(document.querySelectorAll(".why-card"));
  var whyEmpty = document.getElementById("diff-why-empty");
  var attrLines = Array.prototype.slice.call(document.querySelectorAll(".dl.attr"));
  attrLines.forEach(function (line) {
    line.addEventListener("click", function () {
      var id = line.dataset.decision;
      attrLines.forEach(function (l) { l.classList.toggle("sel", l.dataset.decision === id && l === line); });
      if (whyEmpty) whyEmpty.hidden = true;
      whyCards.forEach(function (c) { c.hidden = c.dataset.decision !== id; });
      var w = document.getElementById("diff-why"); if (w) w.scrollTop = 0;
    });
  });

  // collapse/expand diff files
  Array.prototype.slice.call(document.querySelectorAll(".diff-fhead")).forEach(function (h) {
    h.addEventListener("click", function () { h.parentNode.classList.toggle("collapsed"); });
  });

  // diff sort: reorder .diff-file nodes in place by change type or file path
  var sortBtns = Array.prototype.slice.call(document.querySelectorAll(".diff-sort-btn"));
  var rank = __BUCKET_RANK__;
  sortBtns.forEach(function (btn) {
    btn.addEventListener("click", function () {
      sortBtns.forEach(function (b) { b.classList.toggle("on", b === btn); });
      var container = document.querySelector(".diff-files");
      if (!container) return;
      var files = Array.prototype.slice.call(container.querySelectorAll(".diff-file"));
      var byPath = btn.dataset.sort === "path";
      files.sort(function (a, b) {
        var fa = a.dataset.file || "", fb = b.dataset.file || "";
        if (byPath) return fa.localeCompare(fb);
        var ra = rank[a.dataset.bucket] == null ? 9 : rank[a.dataset.bucket];
        var rb = rank[b.dataset.bucket] == null ? 9 : rank[b.dataset.bucket];
        return ra - rb || fa.localeCompare(fb);
      });
      files.forEach(function (f) { container.appendChild(f); });
    });
  });

  // behaviour matrix "why" -> expand the inline reasoning row in place
  Array.prototype.slice.call(document.querySelectorAll(".bm-why")).forEach(function (a) {
    a.addEventListener("click", function () {
      var row = a.closest("tr");
      var reason = row && row.nextElementSibling;
      if (!reason || !reason.classList.contains("bm-reason")) return;
      var open = reason.hasAttribute("hidden");
      if (open) reason.removeAttribute("hidden");
      else reason.setAttribute("hidden", "");
      a.setAttribute("aria-expanded", open ? "true" : "false");
      row.classList.toggle("expanded", open);
    });
  });
})();
