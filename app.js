(function () {
  "use strict";

  // ---------- plan constants ----------
  const START = new Date(2026, 10, 2); // Mon Nov 2, 2026
  const PLAN_WEEKS = 24, START_KG = 95, GOAL_KG = 85, GOAL_DAY = 140, AGENT_TARGET_WK = 7.5;
  const STATUSES = ["Applied", "Screen", "Technical", "Final round", "Offer", "Rejected", "Withdrawn"];

  // ---------- helpers ----------
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const ymd = d => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  const parse = s => { const [y, m, d] = String(s).slice(0, 10).split("-").map(Number); return new Date(y, m - 1, d); };
  const dayIdx = s => Math.round((parse(s) - START) / 86400000);
  const weekOf = s => Math.floor(dayIdx(s) / 7) + 1;
  const today = () => ymd(new Date());
  const num = v => { if (v === "" || v == null) return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
  const fmt = (v, d = 1) => v == null ? "–" : Number(v).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
  const appTarget = w => w < 8 ? 0 : w < 15 ? 10 : 15;
  const isSession = t => t && t !== "Rest day" && t !== "Skipped";
  const short = s => parse(s).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const uid = () => (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);

  const store_ = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }
  };
  const CFG_KEY = "bt-config", LOCAL_KEY = "bt-local-data", CACHE_KEY = "bt-cache";

  // ---------- field mapping (app camelCase <-> database snake_case) ----------
  const DAY_MAP = { date: "date", weight: "weight", kcal: "kcal", protein: "protein", steps: "steps", sleep: "sleep", training: "training", pain: "pain", agent: "agent_hours", learn: "learn_hours", apps: "apps_sent", rehabAm: "rehab_am", rehabPm: "rehab_pm", swelling: "swelling", notes: "notes", updatedAt: "updated_at" };
  const APP_MAP = { id: "id", company: "company", role: "role", date: "applied_on", status: "status", note: "note", createdAt: "created_at" };
  const TEST_MAP = { date: "date", ktwOp: "ktw_op", ktwOk: "ktw_ok", crOp: "cr_op", crOk: "cr_ok", squat: "squat" };
  const NUMERIC = new Set(["weight", "kcal", "protein", "steps", "sleep", "pain", "agent", "learn", "apps", "ktwOp", "ktwOk", "crOp", "crOk"]);
  const toRow = (o, m) => { const r = {}; for (const k in m) if (o[k] !== undefined && k !== "id") r[m[k]] = o[k]; return r; };
  const fromRow = (r, m) => { const o = {}; for (const k in m) if (r[m[k]] !== undefined) o[k] = NUMERIC.has(k) ? num(r[m[k]]) : r[m[k]]; if (o.date) o.date = String(o.date).slice(0, 10); return o; };

  // ---------- stores ----------
  function LocalStore() {
    const read = () => store_.get(LOCAL_KEY) || { days: {}, apps: [], tests: {} };
    const write = d => { if (!store_.set(LOCAL_KEY, d)) throw new Error("This browser blocked saving. Turn off private browsing and try again."); };
    return {
      kind: "local",
      async load() { const d = read(); return { days: d.days, apps: d.apps, tests: Object.values(d.tests) }; },
      async saveDay(o) { const d = read(); d.days[o.date] = o; write(d); },
      async saveTest(o) { const d = read(); d.tests[o.date] = o; write(d); },
      async addApp(o) { const d = read(); const a = { ...o, id: uid() }; d.apps.push(a); write(d); return a; },
      async updateApp(id, patch) { const d = read(); const a = d.apps.find(x => x.id === id); if (a) Object.assign(a, patch); write(d); },
      async deleteApp(id) { const d = read(); d.apps = d.apps.filter(x => x.id !== id); write(d); }
    };
  }

  function CloudStore(client, userId) {
    const chk = ({ data, error }) => { if (error) throw error; return data; };
    return {
      kind: "cloud",
      async load() {
        const [d, a, t] = await Promise.all([
          client.from("days").select("*").order("date"),
          client.from("applications").select("*").order("applied_on"),
          client.from("ankle_tests").select("*").order("date")
        ]);
        const days = {};
        chk(d).forEach(r => { const o = fromRow(r, DAY_MAP); days[o.date] = o; });
        return { days, apps: chk(a).map(r => fromRow(r, APP_MAP)), tests: chk(t).map(r => fromRow(r, TEST_MAP)) };
      },
      async saveDay(o) { chk(await client.from("days").upsert({ ...toRow(o, DAY_MAP), user_id: userId }, { onConflict: "user_id,date" })); },
      async saveTest(o) { chk(await client.from("ankle_tests").upsert({ ...toRow(o, TEST_MAP), user_id: userId }, { onConflict: "user_id,date" })); },
      async addApp(o) { const r = chk(await client.from("applications").insert({ ...toRow(o, APP_MAP), user_id: userId }).select().single()); return fromRow(r, APP_MAP); },
      async updateApp(id, patch) { chk(await client.from("applications").update(toRow(patch, APP_MAP)).eq("id", id)); },
      async deleteApp(id) { chk(await client.from("applications").delete().eq("id", id)); }
    };
  }

  // ---------- state ----------
  let days = {}, apps = [], tests = [];
  let store = null, client = null, user = null;
  const cached = store_.get(CACHE_KEY);

  // ---------- views ----------
  const TAB_VIEWS = ["today", "progress", "jobs", "ankle", "settings"];
  const ALL_VIEWS = TAB_VIEWS.concat(["setup", "signin"]);
  let current = "today";
  function show(v) {
    if (!ALL_VIEWS.includes(v)) v = "today";
    current = v;
    ALL_VIEWS.forEach(x => { $("view-" + x).hidden = x !== v; });
    const inApp = TAB_VIEWS.includes(v);
    $("tabs").hidden = !inApp;
    TAB_VIEWS.forEach(x => $("tab-" + x).setAttribute("aria-selected", x === v ? "true" : "false"));
    if (inApp) { try { history.replaceState(null, "", "#" + v); } catch (e) { /* ignore */ } }
    if (v === "settings") renderSettings();
  }
  document.querySelectorAll("nav.tabs button").forEach(b => b.addEventListener("click", () => show(b.dataset.view)));

  function setSync(msg, bad) { const el = $("syncline"); el.textContent = msg; el.className = "sync" + (bad ? " err" : ""); }

  // ---------- derived ----------
  function sortedDays() { return Object.values(days).filter(d => d.date).sort((a, b) => a.date < b.date ? -1 : 1); }
  function avg7(endDate) {
    const e = dayIdx(endDate);
    const ws = sortedDays().filter(d => d.weight != null && dayIdx(d.date) <= e && dayIdx(d.date) > e - 7);
    return ws.length ? ws.reduce((s, d) => s + d.weight, 0) / ws.length : null;
  }
  function planKg(i) { return i <= 0 ? START_KG : i >= GOAL_DAY ? GOAL_KG : START_KG - (START_KG - GOAL_KG) * i / GOAL_DAY; }
  function weekStats(w) {
    const ds = sortedDays().filter(d => weekOf(d.date) === w);
    const mean = k => { const v = ds.map(d => d[k]).filter(x => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
    const sum = k => ds.reduce((s, d) => s + (d[k] || 0), 0);
    const appsW = apps.filter(a => a.date && weekOf(a.date) === w).length;
    return {
      w, n: ds.length, weight: mean("weight"), kcal: mean("kcal"), protein: mean("protein"), steps: mean("steps"), sleep: mean("sleep"),
      sessions: ds.filter(d => isSession(d.training)).length, rehab: ds.reduce((s, d) => s + (d.rehabAm ? 1 : 0) + (d.rehabPm ? 1 : 0), 0),
      apps: Math.max(appsW, sum("apps")), agent: sum("agent"), learn: sum("learn")
    };
  }
  function currentWeek() { return Math.min(PLAN_WEEKS, Math.max(1, weekOf(today()))); }

  // ---------- render ----------
  function tile(label, numHtml, note, pct, cls) {
    return `<div class="tile"><span class="label">${label}</span><span class="num">${numHtml}</span>` +
      (pct != null ? `<div class="bar ${cls || ""}"><i style="width:${Math.max(0, Math.min(100, pct))}%"></i></div>` : "") +
      `<span class="note">${note}</span></div>`;
  }
  function renderHeader() {
    const i = dayIdx(today());
    $("weekline").innerHTML = i < 0 ? `Plan starts <b>Mon Nov 2</b> · ${-i} day${-i === 1 ? "" : "s"} to go`
      : i >= PLAN_WEEKS * 7 ? "Plan complete · 24 weeks" : `Week <b>${Math.floor(i / 7) + 1}</b> of 24 · day ${i + 1}`;
  }
  function renderToday() {
    const w = currentWeek(), s = weekStats(w), a = avg7(today());
    const lost = a != null ? START_KG - a : null;
    const appsTile = appTarget(w)
      ? tile("Applications this week", `${s.apps} <small>/ ${appTarget(w)}</small>`, "Plan target for week " + w, s.apps / appTarget(w) * 100)
      : tile("Learning this week", `${fmt(s.agent + s.learn, 1)} <small>h</small>`, "Weeks 1–7 are for learning; applying starts week 8", null);
    $("todayTiles").innerHTML =
      tile("7-day avg weight", a != null ? `${fmt(a)} <small>kg</small>` : "–", a != null ? `${fmt(lost)} kg of 10 lost · plan says ${fmt(planKg(dayIdx(today())))} kg today` : "Log a morning weight to start the average", lost != null ? lost * 10 : 0, "w") +
      tile("Agent track this week", `${fmt(s.agent, 1)} <small>/ ${AGENT_TARGET_WK} h</small>`, "90 minutes each weekday", s.agent / AGENT_TARGET_WK * 100) +
      tile("Training this week", `${s.sessions} <small>/ 6</small>`, `Ankle routine: ${s.rehab} of 14 sessions`, s.sessions / 6 * 100) +
      tile("Protein this week", s.protein != null ? `${fmt(s.protein, 0)} <small>g/day</small>` : "–", s.kcal != null ? `Calories ${fmt(s.kcal, 0)} kcal/day avg` : "Targets 160–180 g, 1,900–2,100 kcal", s.protein != null ? s.protein / 170 * 100 : 0) +
      appsTile;
  }
  function renderChart() {
    const svg = $("wChart"); const W = Math.max(300, Math.round(svg.clientWidth || 640)), H = W < 520 ? 240 : 270, L = 34, R = 10, T = 14, B = 28, span = PLAN_WEEKS * 7;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    const pts = sortedDays().filter(d => d.weight != null && dayIdx(d.date) >= -14);
    const vals = pts.map(d => d.weight).concat([START_KG, GOAL_KG]);
    const ymin = Math.floor(Math.min(...vals) - 1), ymax = Math.ceil(Math.max(...vals) + 1);
    const xmin = Math.min(0, ...pts.map(d => dayIdx(d.date)));
    const x = i => L + (i - xmin) / (span - xmin) * (W - L - R), y = v => T + (ymax - v) / (ymax - ymin) * (H - T - B);
    let g = "";
    const stepY = (ymax - ymin) > 12 ? 4 : 2;
    for (let v = Math.ceil(ymin / stepY) * stepY; v <= ymax; v += stepY) {
      g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)" stroke-width="1"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${v}</text>`;
    }
    for (let m = 0; m < 7; m++) {
      const d = new Date(2026, 10 + m, 1), i = Math.round((d - START) / 86400000);
      if (i < xmin || i > span) continue;
      g += `<line x1="${x(i)}" x2="${x(i)}" y1="${T}" y2="${H - B}" stroke="var(--line)" stroke-width="1" stroke-dasharray="2 4"/><text x="${x(i)}" y="${H - 10}" text-anchor="middle">${d.toLocaleDateString(undefined, { month: "short" })}</text>`;
    }
    g += `<polyline fill="none" stroke="var(--accent)" stroke-width="2" stroke-dasharray="6 5" points="${x(0)},${y(START_KG)} ${x(GOAL_DAY)},${y(GOAL_KG)} ${x(span)},${y(GOAL_KG)}"/>`;
    g += `<text x="${x(GOAL_DAY)}" y="${y(GOAL_KG) - 8}" text-anchor="middle" style="fill:var(--accent)">85 kg goal</text>`;
    pts.forEach(d => { g += `<circle cx="${x(dayIdx(d.date))}" cy="${y(d.weight)}" r="2.6" fill="var(--muted)" opacity=".55"/>`; });
    const av = pts.map(d => [dayIdx(d.date), avg7(d.date)]).filter(p => p[1] != null);
    if (av.length > 1) g += `<polyline fill="none" stroke="var(--weight)" stroke-width="2.6" stroke-linejoin="round" points="${av.map(p => x(p[0]) + "," + y(p[1])).join(" ")}"/>`;
    if (av.length) { const p = av[av.length - 1]; g += `<circle cx="${x(p[0])}" cy="${y(p[1])}" r="4.5" fill="var(--weight)"/><text x="${Math.min(x(p[0]) + 8, W - R - 34)}" y="${y(p[1]) - 8}" style="fill:var(--weight);font-weight:600">${fmt(p[1])}</text>`; }
    if (!pts.length) g += `<text x="${(L + W - R) / 2}" y="${H / 2 + 30}" text-anchor="middle">Your weigh-ins will plot here</text>`;
    svg.innerHTML = g;
  }
  let rT; window.addEventListener("resize", () => { clearTimeout(rT); rT = setTimeout(renderChart, 150); });
  function renderProgress() {
    const a = avg7(today()), first = sortedDays().find(d => d.weight != null);
    const ws = []; for (let w = 1; w <= currentWeek(); w++) ws.push(weekStats(w));
    const agent = ws.reduce((s, x) => s + x.agent, 0), learn = ws.reduce((s, x) => s + x.learn, 0);
    $("progTiles").innerHTML =
      tile("Weight lost", a != null ? `${fmt(START_KG - a)} <small>kg</small>` : "–", first ? `First weigh-in ${fmt(first.weight)} kg on ${short(first.date)}` : "Start 95 kg · goal 85 kg", a != null ? (START_KG - a) * 10 : 0, "w") +
      tile("Agent track", `${fmt(agent, 1)} <small>h</small>`, "All weeks so far", null) +
      tile("Other learning", `${fmt(learn, 1)} <small>h</small>`, "SQL, stats, Power BI, projects", null) +
      tile("Applications", `${apps.length}`, "Total in the Jobs pipeline", null);
    renderChart();
    const rows = ws.filter(s => s.n || s.apps).reverse();
    $("weekTable").innerHTML = rows.length ? `<table><thead><tr><th>Week</th><th class="n">Avg kg</th><th class="n">kcal</th><th class="n">Protein g</th><th class="n">Steps</th><th class="n">Sessions</th><th class="n">Agent h</th><th class="n">Other h</th><th class="n">Apps</th></tr></thead><tbody>` +
      rows.map(s => `<tr><td>Wk ${s.w}</td><td class="n">${fmt(s.weight)}</td><td class="n">${fmt(s.kcal, 0)}</td><td class="n">${fmt(s.protein, 0)}</td><td class="n">${fmt(s.steps, 0)}</td><td class="n">${s.sessions}/6</td><td class="n">${fmt(s.agent, 1)}</td><td class="n">${fmt(s.learn, 1)}</td><td class="n">${s.apps}${appTarget(s.w) ? " / " + appTarget(s.w) : ""}</td></tr>`).join("") + `</tbody></table>`
      : `<div class="empty">Weekly averages appear here after your first logged day.</div>`;
    const recent = sortedDays().slice(-14).reverse();
    $("dayTable").innerHTML = recent.length ? `<table><thead><tr><th>Date</th><th class="n">kg</th><th class="n">kcal</th><th class="n">Protein</th><th class="n">Steps</th><th class="n">Sleep</th><th>Training</th></tr></thead><tbody>` +
      recent.map(d => `<tr><td><button class="ghost small" data-edit="${esc(d.date)}" type="button">${short(d.date)}</button></td><td class="n">${fmt(d.weight)}</td><td class="n">${fmt(d.kcal, 0)}</td><td class="n">${fmt(d.protein, 0)}</td><td class="n">${fmt(d.steps, 0)}</td><td class="n">${fmt(d.sleep, 1)}</td><td>${esc(d.training || "–")}</td></tr>`).join("") + `</tbody></table>`
      : `<div class="empty">Your last 14 days appear here. Tap a date to edit that day.</div>`;
  }
  function renderJobs() {
    const w = currentWeek(), s = weekStats(w);
    const active = apps.filter(a => !["Rejected", "Withdrawn", "Offer"].includes(a.status)).length;
    const inter = apps.filter(a => ["Technical", "Final round", "Offer"].includes(a.status)).length;
    $("jobTiles").innerHTML =
      tile("This week", `${s.apps} <small>/ ${appTarget(w)}</small>`, appTarget(w) ? "Applications vs. plan target" : "Learning phase; applying starts week 8", appTarget(w) ? s.apps / appTarget(w) * 100 : 0) +
      tile("Active", `${active}`, "Applied, screening or interviewing", null) +
      tile("Reached interviews", `${inter}`, apps.length ? `${fmt(inter / apps.length * 100, 0)}% of applications` : "Technical round or later", null);
    $("appCounts").innerHTML = STATUSES.map(st => { const n = apps.filter(a => a.status === st).length; return n ? `<span class="chip">${st} · ${n}</span>` : ""; }).join("");
    const list = apps.slice().sort((a, b) => (b.date || "") < (a.date || "") ? -1 : 1);
    $("appTable").innerHTML = list.length ? `<table><thead><tr><th>Applied</th><th>Company</th><th>Role</th><th>Status</th><th>Next step</th><th></th></tr></thead><tbody>` +
      list.map(a => `<tr><td>${a.date ? short(a.date) : "–"}</td><td>${esc(a.company)}</td><td>${esc(a.role)}</td><td><select data-app="${esc(a.id)}" aria-label="Status for ${esc(a.company)}">${STATUSES.map(st => `<option${st === a.status ? " selected" : ""}>${st}</option>`).join("")}</select></td><td>${esc(a.note)}</td><td><button class="ghost small" type="button" data-del="${esc(a.id)}">Delete</button></td></tr>`).join("") + `</tbody></table>`
      : `<div class="empty">No applications yet. Add your first one above; the pipeline counts and weekly target fill in automatically.</div>`;
  }
  function renderAnkle() {
    const pct = (a, b) => a != null && b ? `${fmt(a / b * 100, 0)}%` : "–";
    const list = tests.slice().sort((a, b) => a.date < b.date ? 1 : -1);
    $("testTable").innerHTML = list.length ? `<table><thead><tr><th>Date</th><th class="n">Knee-to-wall op / other</th><th class="n">Ratio</th><th class="n">Calf raises op / other</th><th class="n">Ratio</th><th>Squat</th></tr></thead><tbody>` +
      list.map(t => `<tr><td>${short(t.date)}</td><td class="n">${fmt(t.ktwOp)} / ${fmt(t.ktwOk)} cm</td><td class="n">${pct(t.ktwOp, t.ktwOk)}</td><td class="n">${fmt(t.crOp, 0)} / ${fmt(t.crOk, 0)}</td><td class="n">${pct(t.crOp, t.crOk)}</td><td>${esc(t.squat || "–")}</td></tr>`).join("") + `</tbody></table>`
      : `<div class="empty">Record your first benchmark in week 1 as a baseline, then repeat it monthly.</div>`;
    const cut = dayIdx(today()) - 28;
    const ds = sortedDays().filter(d => dayIdx(d.date) > cut && (d.training || d.pain != null || d.rehabAm || d.rehabPm || d.swelling)).reverse();
    $("ankleDays").innerHTML = ds.length ? `<table><thead><tr><th>Date</th><th>Session</th><th class="n">Pain</th><th>Routine</th><th>Flag</th></tr></thead><tbody>` +
      ds.map(d => `<tr><td>${short(d.date)}</td><td>${esc(d.training || "–")}</td><td class="n">${d.pain == null ? "–" : d.pain}</td><td>${((d.rehabAm ? "AM " : "") + (d.rehabPm ? "PM" : "")) || "–"}</td><td>${d.swelling || (d.pain != null && d.pain > 3) ? '<span class="chip miss">Tell your physio</span>' : ""}</td></tr>`).join("") + `</tbody></table>`
      : `<div class="empty">Training sessions and pain scores from your daily log show here. Pain above 3 or worse swelling gets flagged.</div>`;
  }
  function renderSettings() {
    const cfg = store_.get(CFG_KEY) || {};
    const localData = store_.get(LOCAL_KEY);
    const hasLocal = !!(localData && (Object.keys(localData.days || {}).length || (localData.apps || []).length || Object.keys(localData.tests || {}).length));
    let info = "";
    if (cfg.mode === "cloud") {
      info = `<dt>Mode</dt><dd>Synced with Supabase</dd><dt>Project</dt><dd>${esc(cfg.url)}</dd><dt>Account</dt><dd>${esc(user ? user.email : "Not signed in")}</dd>`;
    } else {
      info = `<dt>Mode</dt><dd>This device only (no sync)</dd><dt>Note</dt><dd>Entries live in this browser. Clearing site data deletes them; export a CSV now and then as a backup.</dd>`;
    }
    $("setInfo").innerHTML = info;
    $("x-signout").hidden = !(cfg.mode === "cloud" && user);
    $("x-copy").hidden = !(cfg.mode === "cloud" && user && hasLocal);
  }
  function renderAll() { renderHeader(); renderToday(); renderProgress(); renderJobs(); renderAnkle(); if (current === "settings") renderSettings(); }

  // ---------- data loading ----------
  function applyData(d) {
    days = d.days || {}; apps = d.apps || []; tests = d.tests || [];
    renderAll();
    if (!document.activeElement || !document.activeElement.closest || !document.activeElement.closest("#dayForm")) loadDay($("d-date").value || today());
  }
  async function refresh() {
    if (!store) return;
    try {
      const d = await store.load();
      applyData(d);
      if (store.kind === "cloud") { store_.set(CACHE_KEY, d); setSync("Synced " + new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })); }
      else setSync("Saved on this device only");
    } catch (err) {
      setSync("Couldn't sync. Showing the last saved copy; check your connection.", true);
    }
  }
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") refresh(); });

  // ---------- forms ----------
  const F = ["weight", "kcal", "protein", "steps", "sleep", "pain", "agent", "learn", "apps"];
  function loadDay(date) {
    const d = days[date] || {};
    F.forEach(k => { $("d-" + k).value = d[k] == null ? "" : d[k]; });
    $("d-train").value = d.training || "";
    $("d-rehabAm").checked = !!d.rehabAm; $("d-rehabPm").checked = !!d.rehabPm; $("d-swelling").checked = !!d.swelling;
    $("d-notes").value = d.notes || "";
    $("d-status").textContent = days[date] ? "Editing saved entry" : ""; $("d-status").className = "status";
  }
  function errMsg(err) {
    const m = (err && (err.message || err.msg)) || "";
    if (/fetch|network|Failed to fetch|load failed/i.test(m)) return "Couldn't reach the database. Check your connection and save again.";
    if (/JWT|auth|permission|row-level/i.test(m)) return "Your sign-in expired. Open Settings, sign out, and sign in again.";
    return m ? "Couldn't save: " + m : "Couldn't save. Try again.";
  }
  function flash(id, msg, bad) { const el = $(id); el.textContent = msg; el.className = "status " + (bad ? "err" : "ok"); }

  $("d-date").value = today(); $("a-date").value = today(); $("t-date").value = today();
  $("a-status").innerHTML = STATUSES.map(s => `<option>${s}</option>`).join("");
  $("d-date").addEventListener("change", () => loadDay($("d-date").value));

  document.addEventListener("click", async e => {
    const ed = e.target.closest("[data-edit]");
    if (ed) { show("today"); $("d-date").value = ed.dataset.edit; loadDay(ed.dataset.edit); $("d-weight").focus(); return; }
    const del = e.target.closest("[data-del]");
    if (del) {
      if (del.dataset.armed !== "1") {
        del.dataset.armed = "1"; del.textContent = "Confirm delete"; del.classList.add("danger");
        setTimeout(() => { if (del.isConnected) { del.dataset.armed = ""; del.textContent = "Delete"; del.classList.remove("danger"); } }, 4000);
      } else {
        try { await store.deleteApp(del.dataset.del); apps = apps.filter(a => a.id !== del.dataset.del); renderAll(); flash("a-status-msg", "Deleted"); }
        catch (err) { flash("a-status-msg", errMsg(err), true); }
      }
      return;
    }
    const ex = e.target.closest("[data-export]");
    if (ex) exportCsv(ex.dataset.export);
  });
  document.addEventListener("change", async e => {
    const s = e.target.closest("select[data-app]");
    if (!s) return;
    try { await store.updateApp(s.dataset.app, { status: s.value }); const a = apps.find(x => x.id === s.dataset.app); if (a) a.status = s.value; renderAll(); flash("a-status-msg", "Status updated"); }
    catch (err) { flash("a-status-msg", errMsg(err), true); }
  });

  $("dayForm").addEventListener("submit", async e => {
    e.preventDefault();
    const date = $("d-date").value; if (!date) { flash("d-status", "Pick a date first.", true); return; }
    const body = { date, training: $("d-train").value || null, rehabAm: $("d-rehabAm").checked, rehabPm: $("d-rehabPm").checked, swelling: $("d-swelling").checked, notes: $("d-notes").value.trim(), updatedAt: new Date().toISOString() };
    F.forEach(k => { body[k] = num($("d-" + k).value); });
    $("d-save").disabled = true;
    try { await store.saveDay(body); days[date] = body; renderAll(); flash("d-status", "Saved " + short(date)); }
    catch (err) { flash("d-status", errMsg(err), true); }
    finally { $("d-save").disabled = false; }
  });
  $("appForm").addEventListener("submit", async e => {
    e.preventDefault();
    const company = $("a-company").value.trim(); if (!company) { flash("a-status-msg", "Enter a company name.", true); $("a-company").focus(); return; }
    $("a-save").disabled = true;
    try {
      const a = await store.addApp({ company, role: $("a-role").value.trim(), date: $("a-date").value || today(), status: $("a-status").value, note: $("a-note").value.trim(), createdAt: new Date().toISOString() });
      apps.push(a); renderAll();
      flash("a-status-msg", "Added " + company); $("a-company").value = ""; $("a-role").value = ""; $("a-note").value = "";
    } catch (err) { flash("a-status-msg", errMsg(err), true); }
    finally { $("a-save").disabled = false; }
  });
  $("testForm").addEventListener("submit", async e => {
    e.preventDefault();
    const date = $("t-date").value || today();
    const body = { date, ktwOp: num($("t-ktwOp").value), ktwOk: num($("t-ktwOk").value), crOp: num($("t-crOp").value), crOk: num($("t-crOk").value), squat: $("t-squat").value || null };
    $("t-save").disabled = true;
    try { await store.saveTest(body); tests = tests.filter(t => t.date !== date).concat([body]); renderAll(); flash("t-status", "Saved test for " + short(date)); }
    catch (err) { flash("t-status", errMsg(err), true); }
    finally { $("t-save").disabled = false; }
  });

  // ---------- CSV export ----------
  function exportCsv(kind) {
    let cols, rows;
    if (kind === "days") { cols = ["date", "weight", "kcal", "protein", "steps", "sleep", "training", "pain", "agent", "learn", "apps", "rehabAm", "rehabPm", "swelling", "notes"]; rows = sortedDays(); }
    else if (kind === "apps") { cols = ["date", "company", "role", "status", "note"]; rows = apps.slice().sort((a, b) => (a.date || "") < (b.date || "") ? -1 : 1); }
    else { cols = ["date", "ktwOp", "ktwOk", "crOp", "crOk", "squat"]; rows = tests.slice().sort((a, b) => a.date < b.date ? -1 : 1); }
    const cell = v => { if (v == null) return ""; const s = String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const csv = [cols.join(",")].concat(rows.map(r => cols.map(c => cell(r[c])).join(","))).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `tracker-${kind}-${today()}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  // ---------- setup and sign-in ----------
  function cleanUrl(raw) {
    let u = raw.trim().replace(/\s+/g, "");
    const dash = u.match(/supabase\.com\/dashboard\/project\/([a-z0-9]+)/i); // dashboard link pasted by mistake
    if (dash) return "https://" + dash[1].toLowerCase() + ".supabase.co";
    if (/^[a-z0-9]{15,}$/i.test(u)) return "https://" + u.toLowerCase() + ".supabase.co"; // project ref only
    if (!/^https?:\/\//i.test(u)) u = "https://" + u;
    try { const p = new URL(u); return "https://" + p.host.toLowerCase(); } catch (e) { return ""; }
  }
  $("setupForm").addEventListener("submit", async e => {
    e.preventDefault();
    const url = cleanUrl($("s-url").value), key = $("s-key").value.replace(/\s+/g, "");
    if (!url) { flash("s-status", "Enter the project URL, like https://abcdefgh.supabase.co", true); return; }
    if (key.length < 20) { flash("s-status", "Paste the full public key.", true); return; }
    if (/service_role|sb_secret_/.test(key) || /"role"\s*:\s*"service_role"/.test(atobSafe(key.split(".")[1] || ""))) { flash("s-status", "That's the secret key. Use the public (anon or publishable) key instead.", true); return; }
    $("s-url").value = url;
    flash("s-status", "Checking the connection…");
    let res;
    try { res = await fetch(url + "/auth/v1/settings", { headers: { apikey: key } }); }
    catch (err) {
      flash("s-status", `Can't reach ${url}. Check that the URL matches Project Settings → API exactly, that the project isn't paused, and try with ad blockers or VPN turned off.`, true);
      return;
    }
    if (res.status === 401 || res.status === 403) { flash("s-status", "The URL works, but the key was rejected. Copy the anon (or publishable) key again.", true); return; }
    if (!res.ok) { flash("s-status", `The project answered with an error (${res.status}). If it was just created, wait a minute and try again.`, true); return; }
    store_.set(CFG_KEY, { mode: "cloud", url, key });
    client = null;
    boot();
  });
  function atobSafe(s) { try { return atob(s.replace(/-/g, "+").replace(/_/g, "/")); } catch (e) { return ""; } }
  $("s-local").addEventListener("click", () => { store_.set(CFG_KEY, { mode: "local" }); boot(); });

  async function auth(kind) {
    const email = $("i-email").value.trim(), password = $("i-pass").value;
    if (!email || password.length < 6) { flash("i-status", "Enter your email and a password of at least 6 characters.", true); return; }
    $("i-signin").disabled = true; $("i-signup").disabled = true;
    try {
      const res = kind === "up" ? await client.auth.signUp({ email, password }) : await client.auth.signInWithPassword({ email, password });
      if (res.error) throw res.error;
      if (!res.data.session) { flash("i-status", "Account created. Confirm it from the email Supabase sent, then sign in.", false); return; }
      user = res.data.session.user;
      startCloud();
    } catch (err) {
      const m = (err && err.message) || "";
      flash("i-status", /fetch|network|load failed/i.test(m)
        ? "Can't reach your Supabase project. Choose \"Change database settings\" below and re-enter the URL and key; the app will test them."
        : (m || "Couldn't sign in."), true);
    } finally { $("i-signin").disabled = false; $("i-signup").disabled = false; }
  }
  $("signinForm").addEventListener("submit", e => { e.preventDefault(); auth("in"); });
  $("i-signup").addEventListener("click", () => auth("up"));
  $("i-reset").addEventListener("click", () => { store_.del(CFG_KEY); boot(); });

  // ---------- settings actions ----------
  $("x-refresh").addEventListener("click", async () => { await refresh(); flash("x-status", "Refreshed"); });
  $("x-signout").addEventListener("click", async () => {
    try { await client.auth.signOut(); } catch (e) { /* ignore */ }
    user = null; store = null; store_.del(CACHE_KEY); applyData({ days: {}, apps: [], tests: [] }); boot();
  });
  $("x-reset").addEventListener("click", () => {
    const b = $("x-reset");
    if (b.dataset.armed !== "1") {
      b.dataset.armed = "1"; b.textContent = "Tap again to confirm";
      setTimeout(() => { b.dataset.armed = ""; b.textContent = "Change sync setup"; }, 4000);
      return;
    }
    b.dataset.armed = ""; b.textContent = "Change sync setup";
    store_.del(CFG_KEY); store_.del(CACHE_KEY);
    if (client) { client.auth.signOut().catch(() => { }); }
    client = null; user = null; store = null; applyData({ days: {}, apps: [], tests: [] }); boot();
  });
  $("x-copy").addEventListener("click", async () => {
    const local = store_.get(LOCAL_KEY); if (!local || !store || store.kind !== "cloud") return;
    flash("x-status", "Copying…");
    let n = 0;
    try {
      for (const d of Object.values(local.days || {})) { await store.saveDay(d); n++; }
      for (const t of Object.values(local.tests || {})) { await store.saveTest(t); n++; }
      for (const a of (local.apps || [])) { await store.addApp(a); n++; }
      store_.del(LOCAL_KEY);
      await refresh();
      flash("x-status", `Copied ${n} entries to the cloud.`);
    } catch (err) { flash("x-status", `Copied ${n} entries, then stopped: ${errMsg(err)}`, true); }
  });

  // Load the Supabase library; fall back to an older build if the main one didn't load.
  function loadScript(src) {
    return new Promise(res => { const t = document.createElement("script"); t.src = src; t.onload = res; t.onerror = res; document.head.appendChild(t); });
  }
  async function ensureLib() {
    if (window.supabase && window.supabase.createClient) return;
    await loadScript("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js");
  }

  // ---------- boot ----------
  function startCloud() {
    store = CloudStore(client, user.id);
    const h = (location.hash || "").replace("#", "");
    show(TAB_VIEWS.includes(h) ? h : "today");
    refresh();
  }
  async function boot() {
    const cfg = store_.get(CFG_KEY);
    if (!cfg) { setSync(""); show("setup"); return; }
    if (cfg.mode === "local") {
      store = LocalStore();
      const h = (location.hash || "").replace("#", "");
      show(TAB_VIEWS.includes(h) ? h : "today");
      refresh();
      return;
    }
    await ensureLib();
    if (!window.supabase || !window.supabase.createClient) {
      if (cached) applyData(cached);
      setSync("Offline: the sync library couldn't load. Showing the last saved copy.", true);
      show("today");
      return;
    }
    try {
      client = client || window.supabase.createClient(cfg.url, cfg.key, { auth: { persistSession: true, autoRefreshToken: true } });
      const { data } = await client.auth.getSession();
      if (data && data.session) { user = data.session.user; startCloud(); }
      else { setSync("Sign in to sync"); show("signin"); }
    } catch (err) {
      setSync("Couldn't connect to Supabase. Check the URL and key in Settings.", true);
      show("signin");
    }
  }

  if (cached) applyData(cached); else renderAll();
  loadDay(today());
  if (document.readyState === "complete") boot(); else window.addEventListener("load", boot);

  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    window.addEventListener("load", () => { navigator.serviceWorker.register("sw.js").catch(() => { }); });
  }
})();
