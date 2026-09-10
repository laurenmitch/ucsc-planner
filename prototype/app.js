/* Slug Planner — local wireframe.
 * Reads ../data/*.json produced by scraper/scrape.py. State lives in localStorage.
 * Model:
 *   course  = subject + catalog_nbr (e.g. "PSYC 1")           -> one class-bank row, one color
 *   section = a `classes` row (lecture section 01, 02, ...)   -> one draggable card
 *   dis     = a `sections` row (DIS/LAB tied to a lecture)     -> chosen after the lecture is placed
 *   plan    = { id, name, term, picks: { [class_nbr]: dis_section_nbr | null } }
 * Plans render as slides in a horizontal snap-scrolling track; the centered slide is "current".
 */

const DATA = "../data/";
const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const DAY_LABELS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
// course colors chosen to sit on the lime ground
const PALETTE = ["#cfd026", "#2b4bd6", "#e5352b", "#ff7a1a", "#9b3fd6", "#0f8f7a", "#e83e8c", "#171a12", "#157a3a", "#6b4c1e"];
const PALETTE_VERSION = 2;
const HOUR_PX = 32, DAY_START = 7, DAY_END = 22;

let terms = [], classes = [], sections = [];
let byNbr = new Map(), disByParent = new Map(), disByNbr = new Map();

const state = load() || { term: null, courses: [], plans: [], current: 0 };

// ----------------------------------------------------------------------- persistence
function load() { try { return JSON.parse(localStorage.getItem("slugplanner")); } catch { return null; } }
function save() { try { localStorage.setItem("slugplanner", JSON.stringify(state)); } catch {} }

// ----------------------------------------------------------------------- helpers
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const courseKey = (c) => `${c.subject} ${c.catalog_nbr}`;
const secLabel = (c) => `${c.component || "LEC"} ${String(c.section).padStart(2, "0")}`;
const mins = (t) => { if (!t) return null; const [h, m] = t.split(":").map(Number); return h * 60 + m; };
const minsToT = (mn) => `${String(Math.floor(mn / 60)).padStart(2, "0")}:${String(mn % 60).padStart(2, "0")}`;
const fmt = (t) => { if (!t) return "TBA"; let [h, m] = t.split(":").map(Number); const ap = h >= 12 ? "p" : "a"; h = h % 12 || 12; return `${h}:${String(m).padStart(2, "0")}${ap}`; };
const timeStr = (r) => r.time_tba ? "Time TBA" : `${r.days || ""} ${fmt(r.start_time)}–${fmt(r.end_time)}`;
const plan = () => state.plans[state.current];
const colorOf = (key) => (state.courses.find((c) => c.key === key) || {}).color || "#999";
function textOn(hex) { // black or off-white text depending on background luminance
  const n = parseInt(hex.slice(1), 16); const r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) > 150 ? "#171a12" : "#f5f6ea";
}
function lighten(hex, amt = 0.35) {
  const n = parseInt(hex.slice(1), 16); let r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  r = Math.round(r + (255 - r) * amt); g = Math.round(g + (255 - g) * amt); b = Math.round(b + (255 - b) * amt);
  return "#" + [r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("");
}
function nextPlanLetter() {
  const used = new Set(state.plans.map((p) => (p.name.match(/^PLAN\s+([A-Z])\b/i) || [])[1]).filter(Boolean).map((x) => x.toUpperCase()));
  for (let i = 0; i < 26; i++) { const L = String.fromCharCode(65 + i); if (!used.has(L)) return L; }
  return String(state.plans.length + 1);
}
function planSaturation(idx) { return Math.max(0.1, 1 - idx * 0.3); } // 1 = full color, fades to gray rightward
function planCountFor(classNbr) { return state.plans.filter((p) => p.picks && classNbr in p.picks).length; }
function expandDays(str) { const out = []; const re = /(Tu|Th|Sa|Su|M|W|F)/g; let m; const map = { M: "mon", Tu: "tue", W: "wed", Th: "thu", F: "fri", Sa: "sat", Su: "sun" }; while ((m = re.exec(str || ""))) out.push(map[m[1]]); return out; }
function overlaps(a, b) { return a.day === b.day && a.start < b.end && b.start < a.end; }

// meetings for a placed lecture (+ extra meeting patterns) and its chosen discussion
function meetingsFor(classNbr, disNbr) {
  const c = byNbr.get(classNbr); if (!c) return [];
  const out = [];
  const push = (row, kind, label) => {
    if (row.time_tba || !row.start_time) return;
    DAYS.forEach((d, i) => { if (row[d]) out.push({ day: i, start: mins(row.start_time), end: mins(row.end_time), kind, label, classNbr, disNbr, room: row.room }); });
  };
  push(c, "lec", secLabel(c));
  if (c.extra_meetings) {
    try { JSON.parse(c.extra_meetings).forEach((m) => { const row = { ...m, time_tba: false }; DAYS.forEach((d) => { row[d] = false; }); expandDays(m.days).forEach((d) => { row[d] = true; }); push(row, "lec", secLabel(c)); }); } catch {}
  }
  if (disNbr) { const s = disByNbr.get(disNbr); if (s) push(s, "dis", s.section_code); }
  return out;
}

// ----------------------------------------------------------------------- boot
async function boot() {
  const [t, c, s] = await Promise.all([DATA + "terms.json", DATA + "classes.json", DATA + "sections.json"].map((u) => fetch(u).then((r) => r.json())));
  terms = t; classes = c; sections = s;
  classes.forEach((r) => byNbr.set(r.class_nbr, r));
  sections.forEach((r) => { disByNbr.set(r.section_nbr, r); if (!disByParent.has(r.parent_class_nbr)) disByParent.set(r.parent_class_nbr, []); disByParent.get(r.parent_class_nbr).push(r); });

  if (!state.term || !terms.some((x) => x.term_code === state.term)) state.term = (terms.find((x) => x.is_current) || terms[0]).term_code;
  if (!state.plans.length) state.plans.push({ id: Date.now(), name: "PLAN A", term: state.term, picks: {} });
  state.current = Math.min(state.current, state.plans.length - 1);
  // migrate colors from the old palette so existing courses read on lime
  if ((state.paletteVersion || 1) < PALETTE_VERSION) { state.courses.forEach((c, i) => { c.color = PALETTE[i % PALETTE.length]; }); state.paletteVersion = PALETTE_VERSION; save(); }
  state.courses.forEach((c, i) => { if (!PALETTE.includes(c.color)) c.color = PALETTE[i % PALETTE.length]; });

  const ts = $("#termSelect"); ts.innerHTML = "";
  terms.forEach((x) => { const o = el("option", null, x.term_name); o.value = x.term_code; if (x.term_code === state.term) o.selected = true; ts.appendChild(o); });
  ts.onchange = () => { state.term = Number(ts.value); save(); renderAll(); };

  wireDrawer();
  wirePlans();
  $("#slug").addEventListener("click", pokeSlug);
  renderAll();
  requestAnimationFrame(() => scrollToPlan(state.current, false));
}

// ----------------------------------------------------------------------- slides (one per plan)
function buildSlide(p, idx) {
  const node = $("#slideTpl").content.firstElementChild.cloneNode(true);
  node.dataset.idx = idx;
  node.style.setProperty("--sat", Math.round(planSaturation(idx) * 100) + "%");
  const days = $(".cal-days", node), grid = $(".cal-grid", node), gutter = $(".gutter-hours", node);
  DAY_LABELS.forEach((d, i) => {
    days.appendChild(el("div", "day", d));
    const c = el("div", "cal-col"); c.dataset.day = i; c.dataset.plan = idx; c.style.height = (DAY_END - DAY_START) * HOUR_PX + "px";
    c.addEventListener("dragover", (e) => { e.preventDefault(); c.classList.add("drop-hot"); });
    c.addEventListener("dragleave", () => c.classList.remove("drop-hot"));
    c.addEventListener("drop", onDrop);
    grid.appendChild(c);
  });
  gutter.style.height = (DAY_END - DAY_START) * HOUR_PX + "px";
  for (let h = DAY_START; h <= DAY_END; h++) { const l = el("div", "hour", fmt(`${String(h).padStart(2, "0")}:00`).replace(":00", "").toUpperCase()); l.style.top = (h - DAY_START) * HOUR_PX + "px"; gutter.appendChild(l); }

  const name = $(".plan-name", node); name.value = p.name;
  name.addEventListener("input", (e) => { p.name = e.target.value; save(); updateActive(); });
  name.addEventListener("focus", () => { if (state.current !== idx) scrollToPlan(idx); });
  return node;
}

function renderAll() { renderSlides(); renderTray(); renderDrawerList(); }

function renderSlides() {
  const track = $("#track");
  const scrollLeft = track.scrollLeft;
  track.innerHTML = "";
  state.plans.forEach((p, idx) => track.appendChild(buildSlide(p, idx)));
  track.scrollLeft = scrollLeft;
  state.plans.forEach((p, idx) => renderBlocks(idx));
  updateActive();
}

function renderBlocks(idx) {
  const p = state.plans[idx]; const slide = $(`.slide[data-idx="${idx}"]`); if (!slide) return;
  $$(".block", slide).forEach((b) => b.remove());
  const all = [];
  Object.entries(p.picks).forEach(([nbr, dis]) => all.push(...meetingsFor(Number(nbr), dis)));
  let units = 0, n = 0;
  Object.keys(p.picks).forEach((nbr) => { const c = byNbr.get(Number(nbr)); if (c && c.term_code === state.term) { units += c.units || 0; n++; } });
  $(".plan-units", slide).textContent = n ? `${n} class${n > 1 ? "es" : ""} · ${units} units` : "empty";

  all.forEach((m) => {
    const c = byNbr.get(m.classNbr); if (!c || c.term_code !== state.term) return;
    const col = $(`.cal-col[data-day="${m.day}"]`, slide);
    const b = el("div", "block" + (m.kind === "dis" ? " dis" : ""));
    const color = colorOf(courseKey(c)); const bg = m.kind === "dis" ? lighten(color) : color;
    b.style.background = bg; b.style.color = textOn(bg);
    b.style.top = ((m.start - DAY_START * 60) / 60) * HOUR_PX + "px";
    b.style.height = Math.max(22, ((m.end - m.start) / 60) * HOUR_PX - 2) + "px";
    if (all.some((o) => o !== m && overlaps(o, m))) b.classList.add("conflict");
    const needsDis = m.kind === "lec" && c.has_sections && !p.picks[m.classNbr];
    if (needsDis) b.classList.add("needs-dis");
    b.innerHTML = `<span class="b-x" title="Remove from this plan">✕</span><div class="b-code">${courseKey(c)}</div><div class="b-sub">${m.label} · ${fmt(minsToT(m.start))}–${fmt(minsToT(m.end))}</div><div class="b-sub">${m.room || ""}</div>` + (needsDis ? `<span class="b-pick">pick a section ▾</span>` : "");
    $(".b-x", b).onclick = () => { delete p.picks[m.classNbr]; save(); renderBlocks(idx); renderTray(); };
    const pick = $(".b-pick", b); if (pick) pick.onclick = (e) => openDisChooser(m.classNbr, e.target, idx);
    col.appendChild(b);
  });
}

// which slide is centered -> current
function updateActive() {
  $$(".slide").forEach((s) => s.classList.toggle("active", Number(s.dataset.idx) === state.current));
  $("#planIndex").textContent = `${state.current + 1} / ${state.plans.length}`;
  $("#prevPlan").disabled = state.current === 0;
  $("#nextPlan").disabled = state.current === state.plans.length - 1;
  if (!$("#reorderPanel").hidden) renderReorderList();
  $("#newPlan").textContent = `+ Make a plan ${nextPlanLetter()}`;
  $("#delPlan").textContent = state.plans.length > 1 ? `Delete ${plan().name}` : "Clear plan";
}
function scrollToPlan(idx, smooth = true) {
  const s = $(`.slide[data-idx="${idx}"]`); if (!s) return;
  const track = $("#track");
  const target = s.offsetLeft - (track.clientWidth - s.clientWidth) / 2;
  track.scrollTo({ left: target, behavior: smooth ? "smooth" : "instant" });
  if (state.current !== idx) { state.current = idx; save(); updateActive(); renderTray(); }
}
function nearestSlide() {
  const track = $("#track"); const mid = track.scrollLeft + track.clientWidth / 2;
  let best = 0, bd = Infinity;
  $$(".slide").forEach((s) => { const c = s.offsetLeft + s.clientWidth / 2; const d = Math.abs(c - mid); if (d < bd) { bd = d; best = Number(s.dataset.idx); } });
  return best;
}

// ----------------------------------------------------------------------- class bank (tray)
function renderTray() {
  const tray = $("#tray");
  $$(".tray-row", tray).forEach((r) => r.remove());
  $("#trayEmpty").hidden = state.courses.length > 0;
  state.courses.forEach((course) => {
    const rows = classes.filter((c) => c.term_code === state.term && courseKey(c) === course.key).sort((a, b) => Number(a.section) - Number(b.section));
    const row = el("div", "tray-row");
    const head = el("div", "tray-course");
    head.innerHTML = `<div class="tc-code"><span class="swatch" style="background:${course.color}"></span>${course.key}</div>` +
      `<div class="tc-title"><span>${rows[0] ? rows[0].title : "(not offered this quarter)"}</span><button class="tray-remove" title="Remove this class from the bank and all plans">remove</button></div>`;
    $(".tray-remove", head).onclick = () => { state.courses = state.courses.filter((x) => x.key !== course.key); state.plans.forEach((p) => rows.forEach((c) => delete p.picks[c.class_nbr])); save(); renderAll(); };
    row.appendChild(head);
    const cards = el("div", "tray-cards");
    rows.forEach((c) => {
      const card = el("div", "card"); card.style.background = course.color; card.style.color = textOn(course.color);
      card.dataset.nbr = c.class_nbr;
      const dis = disByParent.get(c.class_nbr) || [];
      const timedDis = dis.some((d) => !d.time_tba && d.start_time);
      card.draggable = !c.time_tba || timedDis;
      card.innerHTML = `<div class="c-sec">${secLabel(c)}</div>` +
        (c.time_tba ? `<div class="c-tba">${timedDis ? "Drop it, then pick a time" : "Time TBA"}</div>` : `<div class="c-time">${c.days} ${fmt(c.start_time)}–${fmt(c.end_time)}</div>`) +
        (() => { const meta = `${c.instructor || ""}${dis.length ? ` · ${dis.length} ${dis[0].component === "LBS" ? "labs" : "discussions"}` : ""}`; return `<div class="c-meta" title="${meta.replace(/"/g, "&quot;")}">${meta}</div>`; })();
      const n = planCountFor(c.class_nbr);
      if (n) { const b = el("span", "badge" + (c.class_nbr in plan().picks ? " on-this" : ""), n); b.title = `On ${n} plan${n > 1 ? "s" : ""}`; card.appendChild(b); }
      card.addEventListener("dragstart", (e) => { e.dataTransfer.setData("text/plain", String(c.class_nbr)); card.classList.add("dragging"); $$(".cal-col").forEach((x) => x.classList.add("drop-ok")); });
      card.addEventListener("dragend", () => { card.classList.remove("dragging"); $$(".cal-col").forEach((x) => x.classList.remove("drop-ok", "drop-hot")); });
      card.addEventListener("dblclick", () => addToPlan(c.class_nbr, state.current));
      cards.appendChild(card);
    });
    row.appendChild(cards);
    tray.appendChild(row);
  });
}

// ----------------------------------------------------------------------- drag / drop
function onDrop(e) {
  e.preventDefault();
  const nbr = Number(e.dataTransfer.getData("text/plain"));
  const idx = Number(e.currentTarget.dataset.plan);
  $$(".cal-col").forEach((x) => x.classList.remove("drop-ok", "drop-hot"));
  if (nbr) { if (idx !== state.current) scrollToPlan(idx); addToPlan(nbr, idx); }
}
function addToPlan(nbr, idx) {
  const c = byNbr.get(nbr); if (!c) return;
  const p = state.plans[idx];
  classes.filter((x) => courseKey(x) === courseKey(c) && x.class_nbr !== nbr).forEach((x) => delete p.picks[x.class_nbr]); // one lecture per course per plan
  if (!(nbr in p.picks)) p.picks[nbr] = null;
  save(); renderBlocks(idx); renderTray();
  if (c.has_sections && !p.picks[nbr]) {
    const anchor = $(`.slide[data-idx="${idx}"] .block.needs-dis`) || $(`.slide[data-idx="${idx}"] .cal-grid`);
    openDisChooser(nbr, anchor, idx);
  }
}

function openDisChooser(classNbr, anchor, idx) {
  const pop = $("#disChooser"); const p = state.plans[idx];
  const opts = (disByParent.get(classNbr) || []).slice().sort((a, b) => a.section_code.localeCompare(b.section_code));
  const others = []; Object.entries(p.picks).forEach(([n, d]) => { if (Number(n) !== classNbr) others.push(...meetingsFor(Number(n), d)); });
  others.push(...meetingsFor(classNbr, null));
  pop.innerHTML = `<h4>Pick a ${opts[0] && opts[0].component === "LBS" ? "lab" : "discussion"} section</h4>`;
  opts.forEach((s) => {
    const o = el("div", "opt"); const mine = meetingsFor(classNbr, s.section_nbr).filter((m) => m.kind === "dis");
    if (mine.some((m) => others.some((x) => overlaps(x, m)))) o.classList.add("conflict");
    o.innerHTML = `<span class="o-code">${s.section_code}</span><span class="o-time">${timeStr(s)}</span>`;
    o.onclick = () => { p.picks[classNbr] = s.section_nbr; save(); pop.hidden = true; renderBlocks(idx); renderTray(); };
    pop.appendChild(o);
  });
  const skip = el("div", "opt skip", `<span class="o-code">Decide later</span>`); skip.onclick = () => { pop.hidden = true; }; pop.appendChild(skip);
  const r = anchor.getBoundingClientRect();
  pop.style.left = Math.max(8, Math.min(window.innerWidth - 300, r.left + window.scrollX)) + "px";
  pop.style.top = r.bottom + window.scrollY + 6 + "px";
  pop.hidden = false;
}
document.addEventListener("click", (e) => { const pop = $("#disChooser"); if (!pop.hidden && !pop.contains(e.target) && !e.target.classList.contains("b-pick")) pop.hidden = true; });

// ----------------------------------------------------------------------- sammy
const SLUG_LINES = {
  chill: ["hey man", "sup", "oh hey", "nice plan", "go slugs", "just crawlin'", "you good?", "i'm goin' as fast as i can"],
  annoyed: ["stop poking me", "dude.", "ow", "personal space, bro", "i'm workin' here", "do you mind?", "again? really?"],
  done: ["that's it. i'm leaving.", "ok i'm ignoring you now", "talk to the mantle", "...", "i have a 10am, leave me alone"],
};
let slugPokes = 0, slugTimer = null, slugLast = "";
function pokeSlug() {
  slugPokes++;
  const pool = slugPokes <= 3 ? SLUG_LINES.chill : slugPokes <= 7 ? SLUG_LINES.annoyed : SLUG_LINES.done;
  let line; do { line = pool[Math.floor(Math.random() * pool.length)]; } while (line === slugLast && pool.length > 1);
  slugLast = line;
  const say = $("#slugSay"), slug = $("#slug");
  say.textContent = line; say.hidden = false;
  slug.classList.remove("poked"); void slug.offsetWidth; slug.classList.add("poked");   // restart the flinch
  clearTimeout(slugTimer);
  slugTimer = setTimeout(() => { say.hidden = true; }, 2200);
}
setInterval(() => { slugPokes = Math.max(0, slugPokes - 1); }, 15000);   // he calms down if you leave him be

// ----------------------------------------------------------------------- plans
function renderReorderList() {
  const ul = $("#reorderList"); ul.innerHTML = "";
  state.plans.forEach((p, i) => {
    const li = el("li", "reorder-item" + (i === state.current ? " current" : ""));
    li.draggable = true; li.dataset.id = p.id;
    const n = Object.keys(p.picks || {}).length;
    li.innerHTML = `<span class="grip" aria-hidden="true">⋮⋮</span><span class="r-name">${p.name}</span><span class="r-meta">${n ? `${n} class${n > 1 ? "es" : ""}` : "empty"}</span>`;
    li.addEventListener("dragstart", (e) => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plan", String(p.id)); li.classList.add("dragging"); });
    li.addEventListener("dragend", () => { li.classList.remove("dragging"); commitReorder(); });
    li.addEventListener("dragover", (e) => {
      e.preventDefault(); e.dataTransfer.dropEffect = "move";
      const dragging = $(".reorder-item.dragging", ul); if (!dragging || dragging === li) return;
      const r = li.getBoundingClientRect(); const before = e.clientY < r.top + r.height / 2;
      ul.insertBefore(dragging, before ? li : li.nextSibling);   // live reorder while you drag
    });
    li.addEventListener("drop", (e) => e.preventDefault());
    li.addEventListener("click", () => { const idx = state.plans.findIndex((x) => x.id === p.id); if (idx >= 0) scrollToPlan(idx); });
    ul.appendChild(li);
  });
  ul.ondragover = (e) => e.preventDefault();   // dropping in the gaps between items still counts
  ul.ondrop = (e) => e.preventDefault();
}
function commitReorder() {
  const ids = $$(".reorder-item", $("#reorderList")).map((li) => Number(li.dataset.id));
  const currentId = plan().id;
  const next = ids.map((id) => state.plans.find((p) => p.id === id)).filter(Boolean);
  if (next.length !== state.plans.length || next.every((p, i) => p === state.plans[i])) { renderReorderList(); return; }
  state.plans = next; state.current = Math.max(0, state.plans.findIndex((p) => p.id === currentId));
  save(); renderSlides();
  requestAnimationFrame(() => scrollToPlan(state.current, false));
}

function wirePlans() {
  $("#prevPlan").onclick = () => scrollToPlan(Math.max(0, state.current - 1));
  $("#nextPlan").onclick = () => scrollToPlan(Math.min(state.plans.length - 1, state.current + 1));
  $("#newPlan").onclick = () => { state.plans.push({ id: Date.now(), name: "PLAN " + nextPlanLetter(), term: state.term, picks: {} }); save(); renderSlides(); requestAnimationFrame(() => scrollToPlan(state.plans.length - 1)); };
  $("#dupPlan").onclick = () => { const p = plan(); state.plans.splice(state.current + 1, 0, { id: Date.now(), name: p.name + " COPY", term: p.term, picks: { ...p.picks } }); save(); renderSlides(); requestAnimationFrame(() => scrollToPlan(state.current + 1)); };
  // reorder mode: a list of plans you drag into a new order
  const panel = $("#reorderPanel");
  $("#reorderBtn").onclick = () => { panel.hidden = !panel.hidden; $("#reorderBtn").classList.toggle("on", !panel.hidden); if (!panel.hidden) renderReorderList(); };
  $("#reorderDone").onclick = () => { panel.hidden = true; $("#reorderBtn").classList.remove("on"); };
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") { panel.hidden = true; $("#reorderBtn").classList.remove("on"); } });
  $("#delPlan").onclick = () => {
    if (state.plans.length === 1) { plan().picks = {}; save(); renderBlocks(0); renderTray(); return; }
    state.plans.splice(state.current, 1); state.current = Math.max(0, state.current - 1); save(); renderAll();
    requestAnimationFrame(() => scrollToPlan(state.current, false));
  };
  document.addEventListener("keydown", (e) => { if (["INPUT", "SELECT", "TEXTAREA"].includes(e.target.tagName)) return; if (e.key === "ArrowLeft") $("#prevPlan").click(); if (e.key === "ArrowRight") $("#nextPlan").click(); });

  // trackpad / touch scrolling: whichever slide settles in the middle becomes current
  const track = $("#track"); let timer = null;
  const settle = () => { const i = nearestSlide(); if (i !== state.current) { state.current = i; save(); updateActive(); renderTray(); } };
  track.addEventListener("scroll", () => { clearTimeout(timer); timer = setTimeout(settle, 120); }, { passive: true });
  if ("onscrollend" in window) track.addEventListener("scrollend", settle);
  window.addEventListener("resize", () => scrollToPlan(state.current, false));
}

// ----------------------------------------------------------------------- drawer / picker
function wireDrawer() {
  $("#addClassBtn").onclick = () => { $("#drawer").hidden = false; $("#courseSearch").focus(); };
  $("#closeDrawer").onclick = () => { $("#drawer").hidden = true; };
  $("#drawer").addEventListener("click", (e) => { if (e.target === $("#drawer")) $("#drawer").hidden = true; });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") $("#drawer").hidden = true; });
  $("#subjectSelect").onchange = renderDrawerList;
  $("#courseSearch").oninput = renderDrawerList;
}
function renderDrawerList() {
  const subj = $("#subjectSelect");
  const inTerm = classes.filter((c) => c.term_code === state.term);
  const subjects = [...new Map(inTerm.map((c) => [c.subject, c.subject_name])).entries()].sort();
  const cur = subj.value;
  subj.innerHTML = `<option value="">All subjects</option>` + subjects.map(([s, n]) => `<option value="${s}" ${s === cur ? "selected" : ""}>${s} — ${n}</option>`).join("");

  const q = $("#courseSearch").value.trim().toLowerCase();
  const courses = new Map();
  inTerm.forEach((c) => { if (subj.value && c.subject !== subj.value) return; const k = courseKey(c); if (!courses.has(k)) courses.set(k, { key: k, title: c.title, n: 0, subject: c.subject, cat: c.catalog_nbr }); courses.get(k).n++; });
  let list = [...courses.values()];
  if (q) list = list.filter((x) => (x.key + " " + x.title).toLowerCase().includes(q));
  list.sort((a, b) => a.subject.localeCompare(b.subject) || a.cat.localeCompare(b.cat, undefined, { numeric: true }));
  if (!subj.value && !q) list = list.slice(0, 150);

  const ul = $("#courseList"); ul.innerHTML = "";
  list.forEach((x) => {
    const added = state.courses.some((c) => c.key === x.key);
    const li = el("li", "course-item" + (added ? " added" : ""));
    li.innerHTML = `<div class="ci-main"><span class="course-code">${x.key}</span><span class="course-title">${x.title}</span></div><span class="course-sections">${added ? "added ✓" : `${x.n} section${x.n > 1 ? "s" : ""}`}</span>`;
    if (!added) li.onclick = () => { state.courses.push({ key: x.key, color: PALETTE[state.courses.length % PALETTE.length] }); save(); renderAll(); };
    ul.appendChild(li);
  });
  if (!list.length) ul.appendChild(el("li", "course-title", "No matches."));
}

boot().catch((e) => { document.body.insertAdjacentHTML("afterbegin", `<pre style="color:red;padding:20px">${e}</pre>`); });
