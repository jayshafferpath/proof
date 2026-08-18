#!/usr/bin/env node
/**
 * Renders decision-spine walkthrough data into a self-contained index.html.
 * Static output — the only client JS is the theme toggle — so the artifact is
 * viewable anywhere (CI artifact, committed file) and CSP-safe.
 *
 * Usage: node generate.js <data.json> [out.html]
 */
const fs = require("fs");
const path = require("path");

// Set once per render() so the deep renderers can build citation links without
// threading `pr` through every call.
let PR = {};

// A GitHub permalink for a code anchor. Pins to a commit SHA (never a branch —
// a branch ref rots and the line numbers drift). context:true anchors point at
// unchanged base-branch code, so they use baseSha. Returns null when no SHA is
// available (back-compat: fictional/unpinned data renders plain text).
function ghUrl(code) {
  if (!code || !code.file || !PR.repo) return null;
  const sha = code.context ? PR.baseSha || PR.headSha : PR.headSha;
  if (!sha) return null;
  const base = `https://github.com/${PR.repo}/blob/${sha}/${code.file}`;
  const m = String(code.lines || "").match(/(\d+)\s*-\s*(\d+)/);
  if (m) return `${base}#L${m[1]}-L${m[2]}`;
  const single = String(code.lines || "").match(/^\s*(\d+)\s*$/);
  if (single) return `${base}#L${single[1]}`;
  return base; // non-numeric ref (e.g. "~137") — link the file, no line anchor
}

function ghFileUrl(file) {
  if (!file || !PR.repo || !PR.headSha) return null;
  return `https://github.com/${PR.repo}/blob/${PR.headSha}/${file}`;
}

const esc = (s) =>
  String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

// `chose`/`why`/`rejected`/`claim` carry author-authored inline <code> spans;
// keep those, escape everything else. Balanced-tag allowlist, code only.
const richText = (s) =>
  esc(s).replace(/&lt;code&gt;/g, "<code>").replace(/&lt;\/code&gt;/g, "</code>");

// `step` may carry a <span class='kw'>…</span>. Same targeted un-escape.
const stepText = (s) =>
  esc(s)
    .replace(/&lt;span class='kw'&gt;/g, "<span class='kw'>")
    .replace(/&lt;span class=\\?"kw\\?"&gt;/g, "<span class='kw'>")
    .replace(/&lt;\/span&gt;/g, "</span>");

function renderCode(code) {
  if (!code) return "";
  const rows = (code.rows || [])
    .map(([n, t, add]) => {
      const hl =
        code.hl && code.hl.length && +n >= code.hl[0] && +n <= code.hl[1] ? " hl" : "";
      return `<div class="cl${add ? " add" : ""}${hl}"><span class="ln">${esc(n)}</span><span class="ct">${esc(t)}</span></div>`;
    })
    .join("");
  const url = ghUrl(code);
  const fileLabel = `<span class="fp">${esc(code.file)}</span><span>${esc(code.lines)}</span>`;
  const header = url
    ? `<a class="ev-file-link" href="${esc(url)}" target="_blank" rel="noopener">${fileLabel}<span class="gh-glyph" title="View on GitHub">↗</span></a>`
    : fileLabel;
  return `<div class="code-wrap"><div class="ev-block">
      <div class="ev-file">${header}${
        code.context ? '<span class="ctx-badge">context · not under review</span>' : ""
      }</div>
      <pre class="code">${rows}</pre></div></div>`;
}

function renderStep(s, i) {
  const cls = ["step"];
  if (s.bad) cls.push("bad");
  if (s.good) cls.push("good");
  const glyph = s.good ? "✓" : s.bad ? "!" : i + 1;
  return `<div class="${cls.join(" ")}">
      <span class="srail"><span class="sdot">${glyph}</span><span class="sline"></span></span>
      <span class="sbody"><span class="smain">${stepText(s.step)}</span>${
        s.note ? `<span class="snote">${esc(s.note)}</span>` : ""
      }</span></div>`;
}

function renderDivergence(frag) {
  const split = frag.divergeAt != null ? frag.divergeAt : 0;
  const trunk = (frag.after || []).slice(0, split);
  const beforeFork = (frag.before || []).slice(split);
  const afterFork = (frag.after || []).slice(split);

  const trunkHtml = trunk.length
    ? `<div class="trunk">${trunk.map((s, i) => renderStep(s, i)).join("")}</div>`
    : "";
  const forkBar = `<div class="fork">
      <span class="fork-y">⋔</span>
      <span class="fork-l">paths diverge${split ? ` after step ${split}` : ""}</span>
      ${frag.divergeNote ? `<code>${esc(frag.divergeNote)}</code>` : ""}</div>`;
  const tick =
    frag.provenance === "author"
      ? `<span class="prov-tick" title="${esc((frag.provNote || "") + " — " + (frag.provSrc || ""))}">✎ author</span>`
      : "";

  return `${trunkHtml}${forkBar}<div class="cmp two">
      <div class="cmp-side was"><div class="cmp-head was">before <span class="tail">on main</span>${tick}</div>
        ${beforeFork.map((s, i) => renderStep(s, split + i)).join("")}</div>
      <div class="cmp-side"><div class="cmp-head now">after <span class="tail">this PR</span></div>
        ${afterFork.map((s, i) => renderStep(s, split + i)).join("")}</div></div>
      ${renderCode(frag.code)}`;
}

function renderTrace(frag) {
  const head = frag.regression
    ? `<div class="cmp-head now">unchanged <span class="tail">regression check</span></div>`
    : "";
  return `${head}<div class="cmp"><div class="cmp-side">${(frag.trace || [])
    .map((s, i) => renderStep(s, i))
    .join("")}</div></div>${renderCode(frag.code)}`;
}

function renderAnchor(frag) {
  const claim = frag.claim
    ? `<div class="claim"><span class="ci">▸</span><span>${richText(frag.claim)}</span></div>`
    : "";
  return `${claim}${renderCode(frag.code)}`;
}

function renderFragment(frag) {
  const body =
    frag.kind === "divergence"
      ? renderDivergence(frag)
      : frag.kind === "trace"
        ? renderTrace(frag)
        : renderAnchor(frag);
  return `<div class="frag">${body}</div>`;
}

function renderProvenance(d) {
  if (d.source === "author") {
    return `<div class="qbox">“${richText(d.quote)}”<span class="qs">— ${esc(d.quoteSrc)}</span></div>`;
  }
  return `<div class="ibox">${richText(d.inferNote)}<span class="qs">${esc(d.inferSrc)}</span></div>`;
}

function renderDecision(d, i, opts) {
  const withId = !(opts && opts.noId);
  const chip =
    d.source === "author"
      ? `<span class="schip author">✎ author-stated</span>`
      : `<span class="schip infer">⚙ AI-inferred</span>`;
  const note = d.note ? `<div class="nbox">${esc(d.note)}</div>` : "";
  const evidence = (d.evidence || []).length
    ? `<div class="evidence"><div class="ev-lbl">Behaviour it shapes</div>${(d.evidence || [])
        .map(renderFragment)
        .join("")}</div>`
    : "";
  return `<section class="dcard"${withId ? ` id="${esc(d.id)}"` : ""}>
      <div class="dcard-head"><span class="dnum">${i + 1}</span>${chip}</div>
      <h2 class="dd-title">${esc(d.title)}</h2>
      <p class="dd-chose">${richText(d.chose)}</p>
      ${d.rejected ? `<div class="contrast"><span class="ck">instead of</span><span class="cv"><span class="strike">${richText(d.rejected)}</span></span></div>` : ""}
      <div class="lbl">Why it matters</div><p class="why">${richText(d.why)}</p>
      ${renderProvenance(d)}${note}
      ${evidence}
    </section>`;
}

function renderCoverage(cov, decisions) {
  if (!cov) return "";
  const numOf = new Map(decisions.map((d, i) => [d.id, i + 1]));
  const group = (key, label, rows) => {
    if (!rows || !rows.length) return "";
    return `<div class="cov-group">
      <div class="cov-h ${key}">${label} <span class="n">${rows.length}</span></div>
      ${rows.join("")}</div>`;
  };

  const explained = (cov.explained || []).map((e) => {
    const refs = (e.byDecisions || [])
      .map((id) => `<a class="cov-ref" href="#${esc(id)}" title="decision ${numOf.get(id) || "?"}">${numOf.get(id) || esc(id)}</a>`)
      .join("");
    return `<div class="cov-row"><span class="cov-file">${esc(e.file)}</span><span class="cov-refs">${refs}</span></div>`;
  });
  const withWhy = (rows, field) =>
    (rows || []).map(
      (e) => `<div class="cov-row"><span class="cov-file">${esc(e.file)}</span><span class="cov-why">${esc(e[field] || "")}</span></div>`,
    );

  const total =
    (cov.explained || []).length +
    (cov.mechanical || []).length +
    (cov.tests || []).length +
    (cov.unexplained || []).length;

  return `<section class="coverage">
    <h2 class="cov-title">Change coverage · ${total} files</h2>
    <p class="cov-sub">How each changed file is accounted for. The spine above explains behaviour; this maps the rest of the surface so nothing is silently omitted.</p>
    ${group("explained", "Explained by a decision", explained)}
    ${group("tests", "Tests", withWhy(cov.tests, "covers"))}
    ${group("mechanical", "Mechanical / wiring", withWhy(cov.mechanical, "why"))}
    ${group("unexplained", "Not yet explained", withWhy(cov.unexplained, "why"))}
  </section>`;
}

// ---- Decisions tab (master/detail) ----
function mdListItem(d, i) {
  const flag =
    d.source === "author"
      ? `<span class="di-flag author" title="author-stated"></span>`
      : `<span class="di-flag infer" title="AI-inferred">inferred</span>`;
  return `<button class="di" data-idx="${i}">
    <span class="di-num">${i + 1}</span>
    <span class="di-body"><span class="di-title">${esc(d.title)}</span>${flag}</span>
  </button>`;
}

function renderDecisionsTab(decisions, coverage) {
  const authored = decisions.filter((d) => d.source === "author").length;
  const list = decisions.map(mdListItem).join("\n");
  const panes = decisions
    .map((d, i) => `<div class="dpane${i === 0 ? " on" : ""}" data-idx="${i}">${renderDecision(d, i)}</div>`)
    .join("\n");
  const cov = coverage ? `<div class="md-cov">${renderCoverage(coverage, decisions)}</div>` : "";
  return `<div class="tabview md on" id="view-decisions">
    <aside class="md-list">
      <div class="md-list-h">${decisions.length} decisions · ${authored} author-stated, ${decisions.length - authored} inferred</div>
      ${list}
      ${cov}
    </aside>
    <section class="md-detail"><div class="detail-pane">${panes}</div></section>
  </div>`;
}

// ---- Diff tab ----
function renderDiffLine(ln) {
  const cls = ["dl"];
  if (ln.sign === "+") cls.push("add");
  else if (ln.sign === "-") cls.push("del");
  if (ln.decision) cls.push("attr");
  const attr = ln.decision ? ` data-decision="${esc(ln.decision)}"` : "";
  return `<div class="${cls.join(" ")}"${attr}><span class="gut"><span class="o">${ln.old == null ? "" : ln.old}</span><span class="n">${ln.new == null ? "" : ln.new}</span></span><span class="sign">${ln.sign === " " ? "" : ln.sign}</span><span class="txt">${esc(ln.text)}</span></div>`;
}

function renderDiffFile(f, coverage) {
  const bucket = f.bucket || "unexplained";
  const isCode = bucket === "explained";
  const collapsed = !isCode ? " collapsed" : "";
  // summary text for non-explained files pulled from the coverage map
  let summary = "";
  if (coverage && bucket !== "explained") {
    const key = bucket === "tests" ? "covers" : "why";
    const rec = (coverage[bucket] || []).find((e) => e.file === f.file);
    if (rec) summary = rec[key] || "";
  }
  const body = f.hunks
    .map(
      (h) =>
        `<div class="diff-hunk-head">${esc(h.header)}</div><pre class="diff-code">${h.lines
          .map(renderDiffLine)
          .join("")}</pre>`,
    )
    .join("");
  return `<div class="diff-file${collapsed}" data-file="${esc(f.file)}">
    <div class="diff-fhead"><span class="chev">▶</span><span class="bchip ${bucket}">${bucket}</span><span class="fp">${esc(f.file)}</span>${summary ? `<span class="fsummary">${esc(summary)}</span>` : ""}</div>
    <div class="diff-body">${body}</div>
  </div>`;
}

function renderDiffTab(diff, decisions, coverage) {
  if (!diff || !diff.length) return "";
  const files = diff.map((f) => renderDiffFile(f, coverage)).join("\n");
  // reasoning drawer holds one hidden card per decision; JS reveals the clicked one
  const cards = decisions
    .map((d, i) => `<div class="why-card" data-decision="${esc(d.id)}" hidden>${renderDecision(d, i, { noId: true })}</div>`)
    .join("\n");
  return `<div class="tabview diff" id="view-diff">
    <section class="diff-files">${files}</section>
    <aside class="diff-why" id="diff-why">
      <div class="diff-why-hint">Reasoning</div>
      <div class="diff-why-empty" id="diff-why-empty">Click a highlighted line to see the decision behind it.</div>
      ${cards}
    </aside>
  </div>`;
}

// ---- Behaviour tab (matrix of behaviour changes & bug fixes) ----
// Derived from the divergence/trace fragments the decisions already own — never
// separately authored, so it cannot desync from the spine. Anchor fragments
// (scope/wiring claims) carry no runtime behaviour and are excluded.
function behaviourScenarios(decisions) {
  const rows = [];
  decisions.forEach((d, di) => {
    (d.evidence || []).forEach((frag) => {
      if (frag.kind === "divergence") {
        rows.push({ kind: "changed", decision: d, decisionNo: di + 1, frag });
      } else if (frag.kind === "trace") {
        rows.push({
          kind: frag.regression ? "unchanged" : "new",
          decision: d,
          decisionNo: di + 1,
          frag,
        });
      }
    });
  });
  return rows;
}

function renderStateCell(steps, side, split) {
  if (!steps || !steps.length) {
    return `<td class="bm-cell ${side} empty"><span class="bm-empty">—</span></td>`;
  }
  const html = steps.map((s, i) => renderStep(s, (split || 0) + i)).join("");
  return `<td class="bm-cell ${side}">${html}</td>`;
}

// Compact reasoning for the inline strip — chose / instead-of / why / provenance,
// without the full decision-card chrome.
function renderReasoningInline(d) {
  const chip =
    d.source === "author"
      ? `<span class="schip author">✎ author-stated</span>`
      : `<span class="schip infer">⚙ AI-inferred</span>`;
  const prov =
    d.source === "author"
      ? `<div class="qbox">“${richText(d.quote)}”<span class="qs">— ${esc(d.quoteSrc)}</span></div>`
      : `<div class="ibox">${richText(d.inferNote)}<span class="qs">${esc(d.inferSrc)}</span></div>`;
  const note = d.note ? `<div class="nbox">${esc(d.note)}</div>` : "";
  const rejected = d.rejected
    ? `<div class="contrast"><span class="ck">instead of</span><span class="cv"><span class="strike">${richText(d.rejected)}</span></span></div>`
    : "";
  return `<div class="bm-reason-inner">
    <div class="bm-reason-head">${chip}<span class="bm-reason-why">the decision behind this behaviour</span></div>
    <p class="dd-chose">${richText(d.chose)}</p>
    ${rejected}
    <div class="lbl">Why it matters</div><p class="why">${richText(d.why)}</p>
    ${prov}${note}
  </div>`;
}

function renderBehaviourRow(row) {
  const KIND_LABEL = { changed: "CHANGED", new: "NEW", unchanged: "UNCHANGED" };
  const { kind, frag, decision, decisionNo } = row;
  const scenarioTitle = decision.title;

  let beforeCell, afterCell, forkNote = "";
  if (kind === "changed") {
    const split = frag.divergeAt != null ? frag.divergeAt : 0;
    // full before path, and after = trunk (shared prefix) + after-fork
    beforeCell = renderStateCell(frag.before, "was", 0);
    afterCell = renderStateCell(frag.after, "now", 0);
    if (frag.divergeNote) forkNote = `<div class="bm-fork"><span class="fork-y">⋔</span><code>${esc(frag.divergeNote)}</code></div>`;
  } else if (kind === "new") {
    beforeCell = `<td class="bm-cell was empty"><span class="bm-empty">did not exist</span></td>`;
    afterCell = renderStateCell(frag.trace, "now", 0);
  } else {
    // unchanged / regression: same behaviour both sides — show once, spanning
    afterCell = `<td class="bm-cell now span" colspan="2">${(frag.trace || []).map((s, i) => renderStep(s, i)).join("")}</td>`;
    beforeCell = "";
  }

  const tests = frag.tests || [];
  let testCell;
  if (tests.length) {
    const files = [...new Set(tests.map((t) => t.file))];
    const cases = tests
      .map((t) => `<li class="bm-test"><span class="bm-test-tick">✓</span>${esc(t.name)}</li>`)
      .join("");
    const fileLinks = files
      .map((f) => {
        const label = esc(f.split("/").pop());
        const url = ghFileUrl(f);
        return url
          ? `<a class="bm-test-file-link" href="${esc(url)}" target="_blank" rel="noopener" title="${esc(f)}">${label}<span class="gh-glyph">↗</span></a>`
          : `<span title="${esc(f)}">${label}</span>`;
      })
      .join(", ");
    testCell = `<td class="bm-cell tests">
      <ul class="bm-test-list">${cases}</ul>
      <div class="bm-test-file">${fileLinks}</div>
    </td>`;
  } else {
    testCell = `<td class="bm-cell tests empty"><span class="bm-empty">—</span></td>`;
  }

  return `<tr class="bm-row k-${kind}" data-decision="${esc(decision.id)}">
    <td class="bm-scenario">
      <span class="bm-kind k-${kind}">${KIND_LABEL[kind]}</span>
      <span class="bm-title">${esc(scenarioTitle)}</span>
      ${forkNote}
      <button class="bm-why" data-decision="${esc(decision.id)}" aria-expanded="false">why<span class="bm-why-chev">▶</span></button>
    </td>
    ${beforeCell}${afterCell}${testCell}
  </tr>
  <tr class="bm-reason" data-decision="${esc(decision.id)}" hidden><td colspan="4">${renderReasoningInline(decision)}</td></tr>`;
}

function renderBehaviourTab(decisions) {
  const rows = behaviourScenarios(decisions);
  if (!rows.length) return "";
  const counts = rows.reduce((a, r) => ((a[r.kind] = (a[r.kind] || 0) + 1), a), {});
  const body = rows.map(renderBehaviourRow).join("\n");
  const legend = ["changed", "new", "unchanged"]
    .filter((k) => counts[k])
    .map((k) => `<span class="bm-legend k-${k}">${k} <b>${counts[k]}</b></span>`)
    .join("");
  return `<div class="tabview beh" id="view-behaviour">
    <section class="bm-wrap">
      <div class="bm-head"><span class="bm-head-t">Behaviour matrix</span><span class="bm-legendbar">${legend}</span></div>
      <p class="bm-sub">Each runtime scenario this change touches, before (on main) vs after (this PR). Bug fixes surface as <b>CHANGED</b> rows where the two columns diverge.</p>
      <table class="bm">
        <thead><tr><th class="bm-th-s">Scenario</th><th class="bm-th">Before · on main</th><th class="bm-th">After · this PR</th><th class="bm-th">Tested by</th></tr></thead>
        <tbody>${body}</tbody>
      </table>
    </section>
  </div>`;
}

function render(data, css) {
  const { pr = {}, decisions = [], coverage, diff } = data;
  PR = pr;
  const hasDiff = Array.isArray(diff) && diff.length > 0;
  const changedFiles = hasDiff ? diff.length : 0;
  const behaviourRows = behaviourScenarios(decisions);
  const hasBehaviour = behaviourRows.length > 0;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>PR #${esc(pr.number)} — walkthrough</title>
<style>
${css}
</style>
</head>
<body>
<div class="app">
  <header class="topbar">
    <span class="brand-num">#${esc(pr.number)}</span>
    <span class="brand-title">${esc(pr.title)}</span>
    <span class="brand-repo">${esc(pr.repo)}</span>
    <span class="spacer"></span>
    <button class="theme-toggle" id="theme-toggle">◐ Theme</button>
  </header>
  <nav class="tabbar">
    <button class="tab on" data-tab="decisions">Decisions <span class="cnt">${decisions.length}</span></button>
    ${hasBehaviour ? `<button class="tab" data-tab="behaviour">Behaviour <span class="cnt">${behaviourRows.length}</span></button>` : ""}
    ${hasDiff ? `<button class="tab" data-tab="diff">Diff <span class="cnt">${changedFiles}</span></button>` : ""}
  </nav>
  ${renderDecisionsTab(decisions, coverage)}
  ${hasBehaviour ? renderBehaviourTab(decisions) : ""}
  ${hasDiff ? renderDiffTab(diff, decisions, coverage) : ""}
</div>
<script>
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
</script>
</body>
</html>
`;
}

function main() {
  const src = process.argv[2];
  const out = process.argv[3] || path.join(path.dirname(src || "."), "index.html");
  if (!src) {
    console.error("usage: node generate.js <data.json> [out.html]");
    process.exit(2);
  }
  const data = JSON.parse(fs.readFileSync(src, "utf8"));
  const css = fs.readFileSync(path.join(__dirname, "generator", "style.css"), "utf8");
  fs.writeFileSync(out, render(data, css));
  console.log(`wrote ${out} · ${(data.decisions || []).length} decisions`);
}

if (require.main === module) main();
module.exports = { render, renderDecision, renderCoverage, esc };
