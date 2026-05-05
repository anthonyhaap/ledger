/* =====================================================================
   Ledger — Weekly Sales (app.js, Firebase)
   ===================================================================== */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getFirestore, collection, doc, setDoc, updateDoc, deleteDoc,
  onSnapshot, serverTimestamp, Timestamp, query, orderBy
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const CFG_KEY = "ledger.firebaseConfig.v1";

// Hardcoded Firebase config
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyDeBvodJezjkmOaoMFDYb8koVmp25G9FvI",
  authDomain: "reselling-project-18900.firebaseapp.com",
  projectId: "reselling-project-18900",
  storageBucket: "reselling-project-18900.firebasestorage.app",
  messagingSenderId: "233811267101",
  appId: "1:233811267101:web:e55ce8af3d43266dee00f4",
  measurementId: "G-EFB9PBGHJB"
};
const COLLECTION = "weeks";
const PLATFORMS = ["poshmark", "ebay", "facebook", "other"];
const PLATFORM_LABELS = { poshmark: "Poshmark", ebay: "eBay", facebook: "Facebook", other: "Other" };
const PLATFORM_COLORS = { poshmark: "#8A2A2A", ebay: "#2F4A2D", facebook: "#294A6E", other: "#B7651F" };

const $ = sel => document.querySelector(sel);
const $$ = sel => document.querySelectorAll(sel);

const state = {
  weeks: [],
  view: "weekly",
  filterYear: "",
  editingKey: null,
  unsub: null,
  db: null,
  chart: null
};

/* ---------- boot ---------- */
(function boot(){
  startApp(FIREBASE_CONFIG);
})();

function showSetup(){
  $("#setup-screen").classList.remove("hidden");
  $("#setup-save").addEventListener("click", saveSetup);
}

function saveSetup(){
  const raw = $("#setup-input").value;
  const errEl = $("#setup-error");
  errEl.textContent = "";
  let cfg;
  try { cfg = parseFirebaseConfig(raw); }
  catch (e){ errEl.textContent = e.message; return; }
  if (!cfg.apiKey || !cfg.projectId){
    errEl.textContent = "Missing apiKey or projectId. Double-check the pasted config.";
    return;
  }
  localStorage.setItem(CFG_KEY, JSON.stringify(cfg));
  $("#setup-screen").classList.add("hidden");
  startApp(cfg);
}

function loadConfig(){
  try { return JSON.parse(localStorage.getItem(CFG_KEY)); }
  catch { return null; }
}

function parseFirebaseConfig(raw){
  if (!raw || !raw.trim()) throw new Error("Paste your Firebase config first.");
  let s = raw.trim()
    .replace(/^const\s+\w+\s*=\s*/, "")
    .replace(/^var\s+\w+\s*=\s*/, "")
    .replace(/^let\s+\w+\s*=\s*/, "")
    .replace(/^firebaseConfig\s*=\s*/, "")
    .replace(/;?\s*$/, "");
  try { return JSON.parse(s); } catch {}
  const obj = {};
  const re = /(["']?)(\w+)\1\s*:\s*(["'])([^"'`]*)\3/g;
  let m;
  while ((m = re.exec(s)) !== null){ obj[m[2]] = m[4]; }
  if (Object.keys(obj).length === 0){
    throw new Error("Couldn't parse the config. Make sure you pasted the full object.");
  }
  return obj;
}

/* ---------- app start ---------- */
async function startApp(cfg){
  $("#loading").classList.remove("hidden");
  try{
    const app = initializeApp(cfg);
    state.db = getFirestore(app);
  } catch (e){
    $("#loading").classList.add("hidden");
    alert("Firebase failed to initialize. Check your config and reset if needed.\n\n" + e.message);
    return;
  }
  bindUI();
  subscribeWeeks();
}

function bindUI(){
  $$(".tab").forEach(btn => btn.addEventListener("click", () => switchView(btn.dataset.view)));
  $("#filter-year").addEventListener("change", e => { state.filterYear = e.target.value; render(); });
  $("#btn-add-week").addEventListener("click", openAddWeek);
  $("#form-add").addEventListener("submit", handleAddWeek);
  $("#open-settings").addEventListener("click", () => openModal("modal-settings"));
  $("#btn-export").addEventListener("click", exportCSV);
  $("#chart-range").addEventListener("change", () => renderTotals());
  $$(".modal").forEach(m => {
    m.addEventListener("click", e => {
      if (e.target === m || e.target.matches("[data-close]") || e.target.closest("[data-close]")){
        closeAllModals();
      }
    });
  });
  document.addEventListener("keydown", e => { if (e.key === "Escape") closeAllModals(); });
}

function switchView(view){
  state.view = view;
  $$(".tab").forEach(t => t.classList.toggle("is-active", t.dataset.view === view));
  $$(".view").forEach(v => v.classList.toggle("hidden", v.dataset.view !== view));
  if (view === "totals") renderTotals();
}

/* ---------- Firestore subscription ---------- */
function subscribeWeeks(){
  const q = query(collection(state.db, COLLECTION), orderBy("weekStart", "desc"));
  state.unsub = onSnapshot(q, snap => {
    state.weeks = snap.docs.map(d => {
      const data = d.data();
      const ws = data.weekStart instanceof Timestamp ? data.weekStart.toDate() : new Date(data.weekStart);
      return {
        id: d.id,
        weekStart: ws,
        poshmark: num(data.poshmark),
        ebay: num(data.ebay),
        facebook: num(data.facebook),
        other: num(data.other),
        overhead: num(data.overhead)
      };
    });
    $("#loading").classList.add("hidden");
    $("#app").classList.remove("hidden");
    render();
  }, err => {
    console.error("Snapshot error:", err);
    setSyncState("error");
    $("#loading").classList.add("hidden");
    alert("Firestore error. Check your Firebase config and security rules.\n\n" + err.message);
  });
}

/* ---------- render ---------- */
function render(){
  renderYearFilter();
  renderHero();
  renderRows();
  if (state.view === "totals") renderTotals();
}

function getFilteredWeeks(){
  if (!state.filterYear) return state.weeks;
  const y = parseInt(state.filterYear, 10);
  return state.weeks.filter(w => w.weekStart.getFullYear() === y);
}

function renderYearFilter(){
  const years = [...new Set(state.weeks.map(w => w.weekStart.getFullYear()))].sort((a,b)=>b-a);
  const sel = $("#filter-year");
  const cur = sel.value;
  sel.innerHTML = `<option value="">All years</option>` +
    years.map(y => `<option value="${y}">${y}</option>`).join("");
  if (years.includes(parseInt(cur, 10))) sel.value = cur;
}

function renderHero(){
  const now = new Date();
  const thisMonday = mondayOf(now);
  const thisMonth = now.getMonth();
  const thisYear = now.getFullYear();

  const weekRow = state.weeks.find(w => sameDay(w.weekStart, thisMonday));
  let monthNet = 0, ytdNet = 0, allNet = 0;
  state.weeks.forEach(w => {
    const net = computeNet(w);
    allNet += net;
    if (w.weekStart.getFullYear() === thisYear){
      ytdNet += net;
      if (w.weekStart.getMonth() === thisMonth) monthNet += net;
    }
  });

  if (weekRow){
    const sales = sumSales(weekRow);
    const net = sales - weekRow.overhead;
    setStatValue($("#hero-week-net"), net);
    $("#hero-week-meta").textContent = `${money(sales)} sales · ${money(weekRow.overhead)} spent`;
  } else {
    setStatValue($("#hero-week-net"), 0);
    $("#hero-week-meta").textContent = "No entry yet — click Add week";
  }
  setStatValue($("#hero-month-net"), monthNet);
  setStatValue($("#hero-ytd-net"), ytdNet);
  setStatValue($("#hero-all-net"), allNet);
}

function setStatValue(el, n){
  el.textContent = money(n);
  el.classList.remove("value-pos", "value-neg");
  if (el.closest(".stat-lg")) return;
  if (n > 0) el.classList.add("value-pos");
  else if (n < 0) el.classList.add("value-neg");
}

function renderRows(){
  const rows = getFilteredWeeks();
  const list = $("#rows");
  const empty = $("#empty");
  const wrap = $(".ledger-table");

  if (rows.length === 0){
    list.innerHTML = "";
    wrap.classList.add("hidden");
    empty.classList.remove("hidden");
    return;
  }
  wrap.classList.remove("hidden");
  empty.classList.add("hidden");

  const thisMonday = mondayOf(new Date());

  list.innerHTML = rows.map(w => {
    const sales = sumSales(w);
    const net = sales - w.overhead;
    const isCurrent = sameDay(w.weekStart, thisMonday);
    const range = formatWeekRange(w.weekStart);
    const label = formatWeekLabel(w.weekStart);

    const cellNum = (field, val, extra = "") => {
      const isEditing = state.editingKey === `${w.id}:${field}`;
      const zero = !val ? "is-zero" : "";
      const inner = isEditing
        ? `<input type="number" step="0.01" inputmode="decimal" value="${val || ""}" data-id="${w.id}" data-field="${field}" />`
        : money(val || 0);
      return `<div class="cell-num ${zero} ${extra}" data-label="${labelFor(field)}" data-id="${w.id}" data-field="${field}">${inner}</div>`;
    };

    const netClass = net > 0 ? "value-pos" : net < 0 ? "value-neg" : "";

    return `
      <div class="row ${isCurrent ? "row-current" : ""}" data-id="${w.id}">
        <div class="cell-week">
          <span class="week-range">${range}</span>
          <span class="week-label">${label}</span>
        </div>
        ${cellNum("poshmark", w.poshmark)}
        ${cellNum("ebay", w.ebay)}
        ${cellNum("facebook", w.facebook)}
        ${cellNum("other", w.other)}
        <div class="cell-num is-sep" data-label="Sales">${money(sales)}</div>
        ${cellNum("overhead", w.overhead)}
        <div class="cell-num is-net ${netClass}" data-label="Net">${money(net)}</div>
        <div class="cell-actions">
          <button class="row-del" data-id="${w.id}" title="Delete week" aria-label="Delete week">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
              <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
            </svg>
          </button>
        </div>
      </div>`;
  }).join("");

  list.querySelectorAll(".cell-num[data-field]").forEach(cell => {
    cell.addEventListener("click", onCellClick);
    const input = cell.querySelector("input");
    if (input){
      input.focus();
      input.select();
      input.addEventListener("blur", onCellSave);
      input.addEventListener("keydown", onCellKeydown);
    }
  });
  list.querySelectorAll(".row-del").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      confirmDelete(btn.dataset.id);
    });
  });

  renderFooterTotals(rows);
}

function labelFor(field){
  return ({
    poshmark: "Poshmark",
    ebay: "eBay",
    facebook: "Facebook",
    other: "Other",
    overhead: "Overhead"
  })[field] || field;
}

function renderFooterTotals(rows){
  const tot = { poshmark: 0, ebay: 0, facebook: 0, other: 0, sales: 0, overhead: 0, net: 0 };
  rows.forEach(w => {
    PLATFORMS.forEach(p => tot[p] += w[p]);
    const sales = sumSales(w);
    tot.sales += sales;
    tot.overhead += w.overhead;
    tot.net += sales - w.overhead;
  });
  $$("#footer-totals [data-tot]").forEach(el => {
    const k = el.dataset.tot;
    el.textContent = money(tot[k]);
  });
}

/* ---------- inline editing ---------- */
function onCellClick(e){
  const cell = e.currentTarget;
  if (cell.querySelector("input")) return;
  const { id, field } = cell.dataset;
  state.editingKey = `${id}:${field}`;
  renderRows();
}

function onCellKeydown(e){
  if (e.key === "Enter"){ e.preventDefault(); e.target.blur(); }
  else if (e.key === "Escape"){
    state.editingKey = null;
    renderRows();
  }
}

async function onCellSave(e){
  const input = e.target;
  const { id, field } = input.dataset;
  const value = parseDecimal(input.value);
  state.editingKey = null;

  const week = state.weeks.find(w => w.id === id);
  if (week && week[field] === value){
    renderRows();
    return;
  }

  setSyncState("syncing");
  try{
    await updateDoc(doc(state.db, COLLECTION, id), {
      [field]: value,
      updatedAt: serverTimestamp()
    });
    setSyncState("synced");
    flashToast("Saved");
  } catch (err){
    console.error(err);
    setSyncState("error");
    flashToast("Save failed");
    renderRows();
  }
}

/* ---------- add / delete ---------- */
function openAddWeek(){
  const form = $("#form-add");
  form.reset();
  const m = mondayOf(new Date());
  form.elements.weekStart.value = isoDate(m);
  openModal("modal-add");
  setTimeout(() => form.elements.weekStart.focus(), 50);
}

async function handleAddWeek(e){
  e.preventDefault();
  const form = e.currentTarget;
  const fd = new FormData(form);
  const dateStr = fd.get("weekStart");
  if (!dateStr){ flashToast("Pick a date"); return; }
  const monday = mondayOf(parseISODate(dateStr));
  const id = isoDate(monday);

  if (state.weeks.find(w => w.id === id)){
    flashToast("That week already exists");
    closeAllModals();
    state.filterYear = String(monday.getFullYear());
    $("#filter-year").value = state.filterYear;
    render();
    setTimeout(() => flashRow(id), 100);
    return;
  }

  const data = {
    weekStart: Timestamp.fromDate(monday),
    poshmark: parseDecimal(fd.get("poshmark")),
    ebay: parseDecimal(fd.get("ebay")),
    facebook: parseDecimal(fd.get("facebook")),
    other: parseDecimal(fd.get("other")),
    overhead: parseDecimal(fd.get("overhead")),
    updatedAt: serverTimestamp()
  };

  setSyncState("syncing");
  try{
    await setDoc(doc(state.db, COLLECTION, id), data);
    setSyncState("synced");
    flashToast("Week added");
    closeAllModals();
    setTimeout(() => flashRow(id), 200);
  } catch (err){
    console.error(err);
    setSyncState("error");
    flashToast("Add failed");
  }
}

function flashRow(id){
  const row = document.querySelector(`.row[data-id="${id}"]`);
  if (!row) return;
  row.scrollIntoView({ behavior: "smooth", block: "center" });
  row.style.transition = "background-color .4s";
  const orig = row.style.backgroundColor;
  row.style.backgroundColor = "rgba(183, 101, 31, 0.18)";
  setTimeout(() => { row.style.backgroundColor = orig; }, 800);
}

function confirmDelete(id){
  const week = state.weeks.find(w => w.id === id);
  if (!week) return;
  $("#confirm-title").textContent = "Delete this week?";
  $("#confirm-body").textContent = `${formatWeekRange(week.weekStart)} — ${money(sumSales(week))} in sales. This can't be undone.`;
  const ok = $("#confirm-ok");
  ok.textContent = "Delete";
  ok.onclick = async () => {
    closeAllModals();
    setSyncState("syncing");
    try{
      await deleteDoc(doc(state.db, COLLECTION, id));
      setSyncState("synced");
      flashToast("Week deleted");
    } catch (err){
      setSyncState("error");
      flashToast("Delete failed");
    }
  };
  openModal("modal-confirm");
}

/* ---------- totals view ---------- */
function renderTotals(){
  let gross = 0, overhead = 0;
  const byPlatform = { poshmark: 0, ebay: 0, facebook: 0, other: 0 };
  state.weeks.forEach(w => {
    PLATFORMS.forEach(p => { byPlatform[p] += w[p]; gross += w[p]; });
    overhead += w.overhead;
  });
  const net = gross - overhead;
  const margin = gross > 0 ? (net / gross) * 100 : 0;

  $("#t-gross").textContent = money(gross);
  $("#t-overhead").textContent = money(overhead);
  $("#t-net").textContent = money(net);
  $("#t-margin").textContent = `${margin.toFixed(1)}% margin`;
  $("#t-weeks-meta").textContent = `${state.weeks.length} week${state.weeks.length === 1 ? "" : "s"} tracked`;

  const max = Math.max(...Object.values(byPlatform), 1);
  $("#platform-bars").innerHTML = PLATFORMS.map(p => {
    const v = byPlatform[p];
    const pct = (v / max) * 100;
    return `
      <div class="bar-row">
        <div class="bar-name">${PLATFORM_LABELS[p]}</div>
        <div class="bar-track"><div class="bar-fill" style="width:${pct}%; background:${PLATFORM_COLORS[p]}"></div></div>
        <div class="bar-amount">${money(v)}</div>
      </div>`;
  }).join("");

  renderChart();
  renderYearTable();
}

function renderChart(){
  const range = parseInt($("#chart-range").value, 10) || 0;
  const chrono = [...state.weeks].sort((a,b) => a.weekStart - b.weekStart);
  const data = range > 0 ? chrono.slice(-range) : chrono;

  const labels = data.map(w => formatWeekRange(w.weekStart, true));
  const datasets = PLATFORMS.map(p => ({
    label: PLATFORM_LABELS[p],
    data: data.map(w => w[p]),
    backgroundColor: PLATFORM_COLORS[p],
    stack: "sales",
    borderRadius: 3,
    borderSkipped: false
  }));
  datasets.push({
    type: "line",
    label: "Overhead",
    data: data.map(w => w.overhead),
    borderColor: "#15171C",
    backgroundColor: "rgba(21,23,28,0.06)",
    pointRadius: 2,
    pointBackgroundColor: "#15171C",
    borderWidth: 1.5,
    tension: 0.25,
    fill: false
  });

  const ctx = $("#weekly-chart").getContext("2d");
  if (state.chart) state.chart.destroy();
  state.chart = new Chart(ctx, {
    type: "bar",
    data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: {
          position: "bottom",
          labels: { font: { family: "Geist", size: 12 }, color: "#3A3D44", boxWidth: 12, boxHeight: 12, padding: 14 }
        },
        tooltip: {
          backgroundColor: "#15171C",
          titleFont: { family: "Fraunces", size: 13, weight: "500" },
          bodyFont: { family: "Geist Mono", size: 12 },
          padding: 12,
          callbacks: { label: c => `${c.dataset.label}: ${money(c.parsed.y)}` }
        }
      },
      scales: {
        x: {
          stacked: true,
          grid: { display: false },
          ticks: { font: { family: "Geist Mono", size: 10 }, color: "#6B6A62", maxRotation: 0, autoSkip: true }
        },
        y: {
          stacked: true,
          grid: { color: "rgba(199,188,160,0.4)" },
          ticks: {
            font: { family: "Geist Mono", size: 11 }, color: "#6B6A62",
            callback: v => "$" + v.toLocaleString()
          }
        }
      }
    }
  });
}

function renderYearTable(){
  const byYear = {};
  state.weeks.forEach(w => {
    const y = w.weekStart.getFullYear();
    if (!byYear[y]) byYear[y] = { weeks: 0, poshmark: 0, ebay: 0, facebook: 0, other: 0, overhead: 0 };
    byYear[y].weeks++;
    PLATFORMS.forEach(p => byYear[y][p] += w[p]);
    byYear[y].overhead += w.overhead;
  });
  const years = Object.keys(byYear).sort((a,b) => b - a);

  let html = `<div class="year-row year-head">
    <div class="yc-year">Year</div>
    <div class="yc-num">Weeks</div>
    <div class="yc-num">Gross</div>
    <div class="yc-num">Overhead</div>
    <div class="yc-num is-net">Net</div>
    <div class="yc-num">Top platform</div>
    <div class="yc-num">Avg / week</div>
  </div>`;

  if (years.length === 0){
    html += `<div class="year-row"><div class="yc-year" style="grid-column:1/-1; color: var(--ink-faint);">No data yet.</div></div>`;
  }

  years.forEach(y => {
    const d = byYear[y];
    const gross = d.poshmark + d.ebay + d.facebook + d.other;
    const net = gross - d.overhead;
    const top = PLATFORMS.reduce((a,p) => d[p] > d[a] ? p : a, "poshmark");
    const avg = d.weeks > 0 ? net / d.weeks : 0;
    const netClass = net > 0 ? "value-pos" : net < 0 ? "value-neg" : "";
    html += `<div class="year-row">
      <div class="yc-year">${y}</div>
      <div class="yc-num" data-label="Weeks">${d.weeks}</div>
      <div class="yc-num" data-label="Gross">${money(gross)}</div>
      <div class="yc-num" data-label="Overhead">${money(d.overhead)}</div>
      <div class="yc-num is-net ${netClass}" data-label="Net">${money(net)}</div>
      <div class="yc-num" data-label="Top">${PLATFORM_LABELS[top]}</div>
      <div class="yc-num" data-label="Avg/wk">${money(avg)}</div>
    </div>`;
  });

  $("#year-table").innerHTML = html;
}

/* ---------- settings actions ---------- */

function exportCSV(){
  if (state.weeks.length === 0){ flashToast("Nothing to export"); return; }
  const headers = ["Week starting", "Poshmark", "eBay", "Facebook", "Other", "Total sales", "Overhead", "Net"];
  const rows = [...state.weeks].sort((a,b) => a.weekStart - b.weekStart).map(w => {
    const sales = sumSales(w);
    return [
      isoDate(w.weekStart),
      w.poshmark.toFixed(2),
      w.ebay.toFixed(2),
      w.facebook.toFixed(2),
      w.other.toFixed(2),
      sales.toFixed(2),
      w.overhead.toFixed(2),
      (sales - w.overhead).toFixed(2)
    ];
  });
  const csv = [headers, ...rows].map(r => r.join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `ledger-${isoDate(new Date())}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  closeAllModals();
  flashToast("CSV downloaded");
}

/* ---------- modal & UI helpers ---------- */
function openModal(id){ closeAllModals(); $("#" + id).classList.remove("hidden"); }
function closeAllModals(){ $$(".modal").forEach(m => m.classList.add("hidden")); }

let toastTimer;
function flashToast(msg){
  const t = $("#toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add("hidden"), 1800);
}

function setSyncState(s){
  const el = $("#sync");
  el.classList.remove("syncing", "error");
  if (s === "syncing") el.classList.add("syncing");
  else if (s === "error") el.classList.add("error");
  el.title = s === "syncing" ? "Saving…" : s === "error" ? "Sync error" : "Synced";
}

/* ---------- helpers ---------- */
function num(v){ return typeof v === "number" ? v : parseFloat(v) || 0; }
function parseDecimal(v){ if (v === "" || v == null) return 0; const n = parseFloat(v); return isFinite(n) ? Math.round(n * 100) / 100 : 0; }

function money(n){
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  const hasFraction = Math.round(abs * 100) % 100 !== 0;
  return sign + "$" + abs.toLocaleString("en-US", {
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: hasFraction ? 2 : 0
  });
}

function sumSales(w){ return w.poshmark + w.ebay + w.facebook + w.other; }
function computeNet(w){ return sumSales(w) - w.overhead; }

function mondayOf(date){
  const d = new Date(date);
  d.setHours(0,0,0,0);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

function sameDay(a, b){
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function isoDate(d){
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseISODate(s){
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function formatWeekRange(monday, compact = false){
  const sunday = new Date(monday);
  sunday.setDate(sunday.getDate() + 6);
  const sameMonth = monday.getMonth() === sunday.getMonth();
  if (compact) return `${MONTHS[monday.getMonth()]} ${monday.getDate()}`;
  if (sameMonth) return `${MONTHS[monday.getMonth()]} ${monday.getDate()} – ${sunday.getDate()}`;
  return `${MONTHS[monday.getMonth()]} ${monday.getDate()} – ${MONTHS[sunday.getMonth()]} ${sunday.getDate()}`;
}

function formatWeekLabel(monday){
  const now = new Date();
  const thisMon = mondayOf(now);
  const diffWeeks = Math.round((thisMon - monday) / (1000 * 60 * 60 * 24 * 7));
  if (diffWeeks === 0) return `This week · ${monday.getFullYear()}`;
  if (diffWeeks === 1) return `Last week · ${monday.getFullYear()}`;
  if (diffWeeks > 0)   return `${diffWeeks} weeks ago · ${monday.getFullYear()}`;
  return `${Math.abs(diffWeeks)} weeks ahead · ${monday.getFullYear()}`;
}
