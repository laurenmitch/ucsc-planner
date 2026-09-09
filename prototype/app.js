/* Slug Planner — local wireframe.
 * Reads ../data/*.json produced by scraper/scrape.py. State lives in localStorage.
 * Model:
 *   course  = subject + catalog_nbr (e.g. "PSYC 1")           -> one tray row, one color
 *   section = a `classes` row (lecture section 01, 02, ...)   -> one draggable card
 *   dis     = a `sections` row (DIS/LAB tied to a lecture)     -> chosen after the lecture is placed
 *   plan    = { id, name, term, picks: { [class_nbr]: dis_section_nbr | null } }
 */

const DATA = "../data/";
const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const DAY_LABELS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const PALETTE = ["#f26b3a", "#4a7be0", "#b33fb2", "#2aa78a", "#e0a72a", "#d63a2f", "#6b5be0", "#1f9ec9", "#c9558f", "#7a9a2b"];
const HOUR_PX = 52, DAY_START = 7, DAY_END = 22;

let terms = [], classes = [], sections = [];
let byNbr = new Map(), disByParent = new Map(), disByNbr = new Map();

const state = load() || {
  term: null,
  courses: [],          // [{ key: "PSYC 1", color }]
  plans: [],            // [{ id, name, term, picks: {} }]
  current: 0,
};

// ----------------------------------------------------------------------- persistence
function load() {
  try { return JSON.parse(localStorage.getItem("slugplanner")); } catch { return null; }
}
function save() {
  try { localStorage.setItem("slugplanner", JSON.stringify(state)); } catch {}
}

// ----------------------------------------------------------------------- helpers
const $ = (s) => document.querySelector(s);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const courseKey = (c) => `${c.subject} ${c.catalog_nbr}`;
const mins = (t) => { if (!t) return null; const [h, m] = t.split(":").map(Number); return h * 60 + m; };
const fmt = (t) => { if (!t) return "TBA"; let [h, m] = t.split(":").map(Number); const ap = h >= 12 ? "p" : "a"; h = h % 12 || 12; return `${h}:${String(m).padStart(2, "0")}${ap}`; };
const dayStr = (r) => r.days || "";
const timeStr = (r) => r.time_tba ? "Time TBA" : `${dayStr(r)} ${fmt(r.start_time)}–${fmt(r.end_time)}`;
const plan = () => state.plans[state.current];
const colorOf = (key) => (state.courses.find((c) => c.key === key) || {}).color || "#999";
function lighten(hex, amt = 0.22) {
  const n = parseInt(hex.slice(1), 16); let r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  r = Math.round(r + (255 - r) * amt); g = Math.round(g + (255 - g) * amt); b = Math.round(b + (255 - b) * amt);
  return `rgb(${r},${g},${b})`;
}
function nextPlanLetter() {
  const used = new Set(state.plans.map((p) => (p.name.match(/^PLAN\s+([A-Z])\b/i) || [])[1]).filter(Boolean).map((x) => x.toUpperCase()));
  for (let i = 0; i < 26; i++) { const L = String.fromCharCode(65 + i); if (!used.has(L)) return L; }
  return String(state.plans.length + 1);
}
// 1 = full color, fades toward gray as plans go right
function planSaturation(idx) { return Math.max(0.12, 1 - idx * 0.28); }
function planCountFor(classNbr) { return state.plans.filter((p) => p.picks && classNbr in p.picks).length; }

// meetings for a placed lecture (+ its extra meetings) and chosen dis
function meetingsFor(classNbr, disNbr) {
  const c = byNbr.get(classNbr); if (!c) return [];
  const out = [];
  const push = (row, kind, label) => {
    if (row.time_tba || !row.start_time) return;
    DAYS.forEach((d, i) => { if (row[d]) out.push({ day: i, start: mins(row.start_time), end: mins(row.end_time), kind, label, classNbr, disNbr, room: row.room }); });
  };
  push(c, "lec", `${c.component || "LEC"} ${c.section}`);
  if (c.extra_meetings) { try { JSON.parse(c.extra_meetings).forEach((m) => { const row = { ...m, time_tba: false }; DAYS.forEach((d) => { row[d] = false; }); expandDays(m.days).forEach((d) => { row[d] = true; }); push(row, "lec", `${c.component || "LEC"} ${c.section}`); }); } catch {}
  }
  if (disNbr) { const s = disByNbr.get(disNbr); if (s) push(s, "dis", s.section_code); }
  return out;
}
function expandDays(str) { const out = []; const re = /(Tu|Th|Sa|Su|M|W|F)/g; let m; const map = { M: "mon", Tu: "tue", W: "wed", Th: "thu", F: "fri", Sa: "sat", Su: "sun" }; while ((m = re.exec(str || ""))) out.push(map[m[1]]); return out; }
function overlaps(a, b) { return a.day === b.day && a.start < b.end && b.start < a.end; }

// ----------------------------------------------------------------------- boot
async function boot() {
  const [t, c, s] = await Promise.all([DATA + "terms.json", DATA + "classes.json", DATA + "sections.json"].map((u) => fetch(u).then((r) => r.json())));
  terms = t; classes = c; sections = s;
  classes.forEach((r) => byNbr.set(r.class_nbr, r));
  sections.forEach((r) => { disByNbr.set(r.section_nbr, r); if (!disByParent.has(r.parent_class_nbr)) disByParent.set(r.parent_class_nbr, []); disByParent.get(r.parent_class_nbr).push(r); });

  if (!state.term || !terms.some((x) => x.term_code === state.term)) state.term = (terms.find((x) => x.is_current) || terms[0]).term_code;
  if (!state.plans.length) state.plans.push({ id: Date.now(), name: "PLAN A", term: state.term, picks: {} });

  const ts = $("#termSelect"); ts.innerHTML = "";
  terms.forEach((x) => { const o = el("option", null, x.term_name); o.value = x.term_code; if (x.term_code === state.term) o.selected = true; ts.appendChild(o); });
  ts.onchange = () => { state.term = Number(ts.value); save(); renderAll(); };

  buildCalendarShell();
  wireDrawer();
  wirePlans();
  renderAll();
}

// ----------------------------------------------------------------------- calendar shell
function buildCalendarShell() {
  const days = $("#calDays"), grid = $("#calGrid"), gutter = $("#calGutter");
  days.innerHTML = ""; grid.innerHTML = ""; gutter.innerHTML = "";
  DAY_LABELS.forEach((d, i) => {
    const t = i / 6; // 0..1 magenta -> blue
    const col = `color-mix(in srgb, #b33fb2 ${Math.round((1 - t) * 100)}%, #4a7be0)`;
    const h = el("div", "day", d); h.style.setProperty("--col-color", col); h.style.color = col; days.appendChild(h);
    const c = el("div", "cal-col"); c.dataset.day = i; c.style.setProperty("--col-color", col); c.style.height = (DAY_END - DAY_START) * HOUR_PX + "px";
    c.addEventListener("dragover", (e) => { e.preventDefault(); c.classList.add("drop-hot"); });
    c.addEventListener("dragleave", () => c.classList.remove("drop-hot"));
    c.addEventListener("drop", onDrop);
    grid.appendChild(c);
  });
  gutter.style.height = (DAY_END - DAY_START) * HOUR_PX + "px";
  for (let h = DAY_START; h <= DAY_END; h++) { const l = el("div", "hour", fmt(`${String(h).padStart(2, "0")}:00`).replace(":00", "")); l.style.top = (h - DAY_START) * HOUR_PX + "px"; gutter.appendChild(l); }
}

// ----------------------------------------------------------------------- render
function renderAll() { renderPlan(); renderTray(); renderDrawerList(); }

function renderPlan() {
  const p = plan();
  $("#planName").value = p.name;
  $("#planIndex").textContent = `${state.current + 1} / ${state.plans.length}`;
  $("#prevPlan").disabled = state.current === 0;
  $("#nextPlan").disabled = state.current === state.plans.length - 1;
  $("#newPlan").textContent = `+ Make a plan ${nextPlanLetter()}`;
  const sat = planSaturation(state.current);
  document.querySelector(".plan-frame").style.setProperty("--plan-sat", Math.round(sat * 100) + "%");
  document.querySelectorAll(".cal-days .day, .cal-col").forEach((n) => {
    const base = n.dataset.baseColor || n.style.getPropertyValue("--col-color");
    n.dataset.baseColor = base;
    const mixed = `color-mix(in srgb, ${base} ${Math.round(sat * 100)}%, #8f8a91)`;
    n.style.setProperty("--col-color", mixed); if (n.classList.contains("day")) n.style.color = mixed;
  });

  document.querySelectorAll(".block").forEach((b) => b.remove());
  const all = [];
  Object.entries(p.picks).forEach(([nbr, dis]) => all.push(...meetingsFor(Number(nbr), dis)));
  let units = 0;
  Object.keys(p.picks).forEach((nbr) => { const c = byNbr.get(Number(nbr)); if (c && c.term_code === state.term) units += c.units || 0; });
  $("#planUnits").textContent = Object.keys(p.picks).length ? `${Object.keys(p.picks).length} classes · ${units} units` : "";

  all.forEach((m) => {
    const c = byNbr.get(m.classNbr); if (!c || c.term_code !== state.term) return;
    const col = document.querySelector(`.cal-col[data-day="${m.day}"]`);
    const b = el("div", "block" + (m.kind === "dis" ? " dis" : ""));
    const color = colorOf(courseKey(c)); b.style.background = m.kind === "dis" ? lighten(color) : color;
    b.style.top = ((m.start - DAY_START * 60) / 60) * HOUR_PX + "px";
    b.style.height = Math.max(22, ((m.end - m.start) / 60) * HOUR_PX - 2) + "px";
    const conflict = all.some((o) => o !== m && overlaps(o, m));
    if (conflict) b.classList.add("conflict");
    const needsDis = m.kind === "lec" && c.has_sections && !p.picks[m.classNbr];
    if (needsDis) b.classList.add("needs-dis");
    b.innerHTML = `<span class="b-x" title="Remove from this plan">✕</span><div class="b-code">${courseKey(c)}</div><div class="b-sub">${m.label} · ${fmt(minsToT(m.start))}–${fmt(minsToT(m.end))}</div><div class="b-sub">${m.room || ""}</div>` + (needsDis ? `<span class="b-pick">pick a section ▾</span>` : "");
    b.querySelector(".b-x").onclick = () => { delete p.picks[m.classNbr]; save(); renderAll(); };
    const pick = b.querySelector(".b-pick"); if (pick) pick.onclick = (e) => openDisChooser(m.classNbr, e.target);
    col.appendChild(b);
  });
}
function minsToT(mn) { return `${String(Math.floor(mn / 60)).padStart(2, "0")}:${String(mn % 60).padStart(2, "0")}`; }

function renderTray() {
  const tray = $("#tray");
  tray.querySelectorAll(".tray-row").forEach((r) => r.remove());
  $("#trayEmpty").hidden = state.courses.length > 0;
  state.courses.forEach((course) => {
    const rows = classes.filter((c) => c.term_code === state.term && courseKey(c) === course.key).sort((a, b) => a.section.localeCompare(b.section));
    const row = el("div", "tray-row");
    const head = el("div", "tray-course");
    head.innerHTML = `<div class="tc-code"><span class="swatch" style="background:${course.color}"></span>${course.key}</div><div class="tc-title">${rows[0] ? rows[0].title : "(not offered this quarter)"}</div>`;
    row.appendChild(head);
    const cards = el("div", "tray-cards");
    rows.forEach((c) => {
      const card = el("div", "card"); card.style.background = course.color; card.draggable = !c.time_tba;
      card.dataset.nbr = c.class_nbr;
      const dis = disByParent.get(c.class_nbr) || [];
      card.innerHTML = `<div class="c-sec">${c.component || "LEC"} ${c.section}</div>` +
        (c.time_tba ? `<div class="c-tba">Time TBA</div>` : `<div class="c-time">${dayStr(c)} ${fmt(c.start_time)}–${fmt(c.end_time)}</div>`) +
        `<div class="c-meta">${c.instructor || ""}${dis.length ? ` · ${dis.length} ${dis[0].component === "LBS" ? "labs" : "discussions"}` : ""}</div>`;
      const n = planCountFor(c.class_nbr);
      if (n) { const b = el("span", "badge" + (c.class_nbr in plan().picks ? " on-this" : ""), n); b.title = `On ${n} plan${n > 1 ? "s" : ""}`; card.appendChild(b); }
      card.addEventListener("dragstart", (e) => { e.dataTransfer.setData("text/plain", String(c.class_nbr)); card.classList.add("dragging"); document.querySelectorAll(".cal-col").forEach((x) => x.classList.add("drop-ok")); });
      card.addEventListener("dragend", () => { card.classList.remove("dragging"); document.querySelectorAll(".cal-col").forEach((x) => x.classList.remove("drop-ok", "drop-hot")); });
      card.addEventListener("dblclick", () => addToPlan(c.class_nbr));
      cards.appendChild(card);
    });
    row.appendChild(cards);
    const rm = el("button", "btn btn-ghost tray-remove", "remove"); rm.title = "Remove this class from the tray (and all plans)";
    rm.onclick = () => { state.courses = state.courses.filter((x) => x.key !== course.key); state.plans.forEach((p) => rows.forEach((c) => delete p.picks[c.class_nbr])); save(); renderAll(); };
    row.appendChild(rm);
    tray.appendChild(row);
  });
}

// ----------------------------------------------------------------------- drag / drop
function onDrop(e) {
  e.preventDefault();
  const nbr = Number(e.dataTransfer.getData("text/plain"));
  document.querySelectorAll(".cal-col").forEach((x) => x.classList.remove("drop-ok", "drop-hot"));
  if (nbr) addToPlan(nbr, e);
}
function addToPlan(nbr, evt) {
  const c = byNbr.get(nbr); if (!c) return;
  const p = plan();
  // one lecture section per course per plan: replace a sibling if present
  classes.filter((x) => courseKey(x) === courseKey(c) && x.class_nbr !== nbr).forEach((x) => delete p.picks[x.class_nbr]);
  if (!(nbr in p.picks)) p.picks[nbr] = null;
  save(); renderAll();
  if (c.has_sections && !p.picks[nbr]) {
    const anchor = document.querySelector(`.block.needs-dis`) || $("#calGrid");
    openDisChooser(nbr, anchor);
  }
}

function openDisChooser(classNbr, anchor) {
  const pop = $("#disChooser"); const p = plan();
  const opts = (disByParent.get(classNbr) || []).slice().sort((a, b) => a.section_code.localeCompare(b.section_code));
  const others = []; Object.entries(p.picks).forEach(([n, d]) => { if (Number(n) !== classNbr) others.push(...meetingsFor(Number(n), d)); });
  others.push(...meetingsFor(classNbr, null));
  pop.innerHTML = `<h4>Pick a ${opts[0] && opts[0].component === "LBS" ? "lab" : "discussion"} section</h4>`;
  opts.forEach((s) => {
    const o = el("div", "opt"); const mine = meetingsFor(classNbr, s.section_nbr).filter((m) => m.kind === "dis");
    if (mine.some((m) => others.some((x) => overlaps(x, m)))) o.classList.add("conflict");
    o.innerHTML = `<span class="o-code">${s.section_code}</span><span class="o-time">${timeStr(s)}</span>`;
    o.onclick = () => { p.picks[classNbr] = s.section_nbr; save(); pop.hidden = true; renderAll(); };
    pop.appendChild(o);
  });
  const skip = el("div", "opt", `<span class="o-code">Decide later</span>`); skip.onclick = () => { pop.hidden = true; }; pop.appendChild(skip);
  const r = anchor.getBoundingClientRect();
  pop.style.left = Math.min(window.innerWidth - 280, r.left + window.scrollX) + "px";
  pop.style.top = r.bottom + window.scrollY + 6 + "px";
  pop.hidden = false;
}
document.addEventListener("click", (e) => { const pop = $("#disChooser"); if (!pop.hidden && !pop.contains(e.target) && !e.target.classList.contains("b-pick")) pop.hidden = true; });

// ----------------------------------------------------------------------- plans
function wirePlans() {
  $("#prevPlan").onclick = () => { if (state.current > 0) { state.current--; save(); renderAll(); } };
  $("#nextPlan").onclick = () => { if (state.current < state.plans.length - 1) { state.current++; save(); renderAll(); } };
  $("#newPlan").onclick = () => { state.plans.push({ id: Date.now(), name: "PLAN " + nextPlanLetter(), term: state.term, picks: {} }); state.current = state.plans.length - 1; save(); renderAll(); };
  $("#dupPlan").onclick = () => { const p = plan(); state.plans.splice(state.current + 1, 0, { id: Date.now(), name: p.name + " copy", term: p.term, picks: { ...p.picks } }); state.current++; save(); renderAll(); };
  $("#delPlan").onclick = () => { if (state.plans.length === 1) { plan().picks = {}; } else { state.plans.splice(state.current, 1); state.current = Math.max(0, state.current - 1); } save(); renderAll(); };
  $("#planName").addEventListener("input", (e) => { plan().name = e.target.value; save(); });
  document.addEventListener("keydown", (e) => { if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return; if (e.key === "ArrowLeft") $("#prevPlan").click(); if (e.key === "ArrowRight") $("#nextPlan").click(); });
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
    li.innerHTML = `<div><span class="course-code">${x.key}</span> <span class="course-title">${x.title}</span></div><span class="course-sections">${added ? "added ✓" : `${x.n} section${x.n > 1 ? "s" : ""}`}</span>`;
    if (!added) li.onclick = () => { state.courses.push({ key: x.key, color: PALETTE[state.courses.length % PALETTE.length] }); save(); renderAll(); };
    ul.appendChild(li);
  });
  if (!list.length) ul.appendChild(el("li", "course-title", "No matches."));
}

boot().catch((e) => { document.body.insertAdjacentHTML("afterbegin", `<pre style="color:red;padding:20px">${e}</pre>`); });
