// Kratos — Norwegian strength-program CSV parser & translator.
// One CSV = one week. Inside the week: "Dag N" headers split day sections.
// Each row inside a day is one prescribed set group for an exercise.

const STORAGE_KEY = "kratos.uploads.v2";
const TOTAL_WEEKS = 9;
const PRELOAD_TEMPLATE = (n) =>
  `./preload/${encodeURIComponent(`Kopi av 3-dagers oppkjøringsprogram UF - Uke ${n}.csv`)}`;

const dom = {
  empty: document.getElementById("empty"),
  program: document.getElementById("program"),
  weekNav: document.getElementById("week-nav"),
  weekTitle: document.getElementById("week-title"),
  weekSubtitle: document.getElementById("week-subtitle"),
  dayTabs: document.getElementById("day-tabs"),
  dayBody: document.getElementById("day-body"),
  fileInput: document.getElementById("file-input"),
  btnReset: document.getElementById("btn-reset"),
  year: document.getElementById("year"),
};

// state.weeks is an array indexed 0..TOTAL_WEEKS-1, slot = week N+1.
// Each slot is { name, days: [...], source: "preload" | "upload" } or null if not loaded.
const state = {
  weeks: new Array(TOTAL_WEEKS).fill(null),
  uploads: {},          // { "Uke 3": <week obj> } from localStorage
  activeWeek: 0,
  activeDay: 0,
  glossary: { entries: {}, categories: {}, modifiers: {} },
  workoutAssignments: {}, // filename -> { uke, dag }
  workoutSets: new Map(), // "uke-dag-normName" -> [{kg, reps, rpe, sett, date}]
  exerciseIds: new Map(),  // normalizedName -> "01", "02", ...
  exerciseById: new Map(), // "01" -> normalizedName
};

dom.year.textContent = new Date().getFullYear();

init();

async function init() {
  bindUI();
  state.glossary = await loadGlossary();
  restoreUploads();
  renderWeekNav();
  await preloadAll();
  assignExerciseIds();
  await loadWorkouts();
  applyUploads();
  pickInitialWeek();
  render();
}

// ---------- exercise IDs ----------

function assignExerciseIds() {
  let counter = 1;
  for (const week of state.weeks) {
    if (!week) continue;
    for (const day of week.days) {
      for (const ex of day.exercises) {
        const key = normalizeName(ex.name);
        if (!state.exerciseIds.has(key)) {
          const id = String(counter).padStart(2, "0");
          state.exerciseIds.set(key, id);
          state.exerciseById.set(id, key);
          counter++;
        }
      }
    }
  }
}

// ---------- glossary ----------

async function loadGlossary() {
  try {
    const res = await fetch("./data/glossary.json", { cache: "no-cache" });
    if (!res.ok) throw new Error(res.statusText);
    const data = await res.json();
    return {
      entries: data.entries || {},
      categories: data.categories || {},
      modifiers: data.modifiers || {},
    };
  } catch (err) {
    console.warn("glossary load failed", err);
    return { entries: {}, categories: {}, modifiers: {} };
  }
}

function normalizeName(raw) {
  return (raw || "")
    .toLowerCase()
    .replace(/[,.;:!?()/\\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function lookupExercise(rawName) {
  const key = normalizeName(rawName);
  if (!key) return null;
  if (state.glossary.entries[key]) return state.glossary.entries[key];
  for (const k of Object.keys(state.glossary.entries)) {
    if (key.startsWith(k) || k.startsWith(key)) return state.glossary.entries[k];
  }
  return null;
}

function lookupCategory(rawCategory) {
  if (!rawCategory) return null;
  const key = rawCategory
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[/\\,.;:!?()]/g, "");
  return state.glossary.categories[key] || rawCategory;
}

// ---------- CSV parsing (RFC-4180-ish, handles quoted commas & newlines) ----------

function parseCSV(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') { inQuotes = false; }
      else { cell += ch; }
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ",") { row.push(cell); cell = ""; }
      else if (ch === "\r") { /* skip */ }
      else if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
      else { cell += ch; }
    }
  }
  if (cell.length > 0 || row.length > 0) { row.push(cell); rows.push(row); }
  return rows;
}

// ---------- format-specific week parser ----------
//
// Column layout in the source sheet:
//  0: (empty)        1: 1RM        2: Øvelseskategori    3: Dag N / exercise name
//  4: Sett           5: Reps       6: RPE low            7: "-" separator
//  8: RPE high       9: %         10: Vekt              11: "-"   12: 0   13: Kommentar

const COL = {
  ONE_RM: 1, CATEGORY: 2, NAME: 3,
  SETS: 4, REPS: 5,
  RPE_LOW: 6, RPE_HIGH: 8,
  PERCENT: 9, WEIGHT: 10, NOTE: 13,
};

function parseWeek(text, weekName) {
  const matrix = parseCSV(text);
  const week = { name: weekName, days: [] };
  let day = null;
  let exercise = null;

  for (const row of matrix) {
    const get = (i) => (row[i] || "").trim();
    const name = get(COL.NAME);

    if (/^dag\s*\d+/i.test(name)) {
      day = { name: name, exercises: [] };
      week.days.push(day);
      exercise = null;
      continue;
    }
    if (!day) continue;

    const sets = get(COL.SETS);
    const reps = get(COL.REPS);
    if (!sets || !reps) continue;
    if (!/^\d/.test(sets) || !/^\d/.test(reps)) continue;

    const category = get(COL.CATEGORY);
    const oneRM = get(COL.ONE_RM);
    if (name) {
      if (!exercise || normalizeName(exercise.name) !== normalizeName(name)) {
        exercise = { name, category, oneRM, sets: [] };
        day.exercises.push(exercise);
      }
    } else if (!exercise) {
      exercise = { name: category || "?", category, oneRM, sets: [] };
      day.exercises.push(exercise);
    }

    const rpeLow = get(COL.RPE_LOW);
    const rpeHigh = get(COL.RPE_HIGH);
    let rpe = rpeLow;
    if (rpeLow && rpeHigh) rpe = `${rpeLow}–${rpeHigh}`;

    exercise.sets.push({
      sets, reps, rpe,
      percent: get(COL.PERCENT),
      weight: get(COL.WEIGHT),
      note: get(COL.NOTE),
    });
  }

  week.days = week.days.filter((d) => d.exercises.length > 0);

  const actuals = scanActuals(matrix);
  for (const d of week.days) {
    for (const ex of d.exercises) {
      const key = normalizeName(ex.name);
      const a = actuals.get(key);
      if (a) ex.actuals = a;
    }
  }

  return week;
}

// Scan the matrix for per-set actuals tracking grids. Each block is 4 rows:
//   row 0: [<exercise name>, "Sett", 1..8, ...]
//   row 1: ["E1RM", "KG", <kg1..kg8>, ...]
//   row 2: ["",     "Reps", <r1..r8>, ...]
//   row 3: ["",     "RPE",  <rpe1..rpe8>, ...]
// Blocks repeat at multiple column offsets and multiple row positions per exercise.
// Returns Map<normalizedName, Array<{kg, reps, rpe}>> aggregated by set index.
function scanActuals(matrix) {
  const result = new Map();
  for (let r = 0; r + 3 < matrix.length; r++) {
    const row = matrix[r];
    for (let c = 0; c + 9 < row.length; c++) {
      const name = (row[c] || "").trim();
      if (!name || name === "Sett" || name === "E1RM" || /^\d/.test(name)) continue;
      if ((row[c + 1] || "").trim() !== "Sett") continue;
      const kgRow = matrix[r + 1] || [];
      const repsRow = matrix[r + 2] || [];
      const rpeRow = matrix[r + 3] || [];
      if ((kgRow[c + 1] || "").trim() !== "KG") continue;
      if ((repsRow[c + 1] || "").trim() !== "Reps") continue;
      if ((rpeRow[c + 1] || "").trim() !== "RPE") continue;

      const key = normalizeName(name);
      let arr = result.get(key);
      if (!arr) { arr = []; result.set(key, arr); }
      for (let s = 0; s < 8; s++) {
        const kg = (kgRow[c + 2 + s] || "").trim();
        const reps = (repsRow[c + 2 + s] || "").trim();
        const rpe = (rpeRow[c + 2 + s] || "").trim();
        if (!kg && !reps && !rpe) continue;
        if (!arr[s]) arr[s] = { kg: "", reps: "", rpe: "" };
        if (kg && !arr[s].kg) arr[s].kg = kg;
        if (reps && !arr[s].reps) arr[s].reps = reps;
        if (rpe && !arr[s].rpe) arr[s].rpe = rpe;
      }
    }
  }
  for (const [k, arr] of result) {
    const compact = arr.filter(Boolean);
    if (compact.length === 0) result.delete(k);
    else result.set(k, compact);
  }
  return result;
}

// ---------- workout log files ----------

async function loadWorkouts() {
  try {
    const ar = await fetch("./preload/workout-assignments.json", { cache: "no-cache" });
    if (ar.ok) state.workoutAssignments = await ar.json();
  } catch { /* no assignments yet */ }

  let index;
  try {
    const res = await fetch("./preload/workout-index.json", { cache: "no-cache" });
    if (!res.ok) return;
    index = await res.json();
  } catch { return; }
  for (const filename of index) {
    const assignment = state.workoutAssignments[filename];
    if (!assignment) continue; // skip unassigned workouts
    try {
      const res = await fetch(`./preload/${encodeURIComponent(filename)}`, { cache: "no-cache" });
      if (!res.ok) continue;
      const text = await res.text();
      parseWorkoutFile(text, filename, assignment.uke, assignment.dag);
    } catch (err) {
      console.warn(`workout load failed: ${filename}`, err);
    }
  }
}

function parseWorkoutFile(text, filename, ukeNum, dagNum) {
  const dateMatch = filename.match(/workout-(\d{4}-\d{2}-\d{2})\.csv/);
  const date = dateMatch ? dateMatch[1] : filename;
  const matrix = parseCSV(text);
  for (const row of matrix) {
    const get = (i) => (row[i] || "").trim();
    // COL.NAME is col 3. Older logger versions wrote the exercise ID to col 2
    // (COL.CATEGORY) instead. Fall back to col 2 when col 3 is empty.
    const name = get(COL.NAME) || get(COL.CATEGORY);
    if (!name || /^dag\s*\d+/i.test(name)) continue;
    const reps = get(COL.REPS);
    const weight = get(COL.WEIGHT);
    if (!reps && !weight) continue;
    // Resolve bare numeric ID (e.g. "03" or "3") to normalized exercise name
    let normKey;
    if (/^\d{1,3}$/.test(name)) {
      const paddedId = name.padStart(2, "0");
      normKey = state.exerciseById.get(paddedId) ?? state.exerciseById.get(name);
    }
    if (!normKey) normKey = normalizeName(name);
    const key = `${ukeNum}-${dagNum}-${normKey}`;
    if (!state.workoutSets.has(key)) state.workoutSets.set(key, []);
    const rpeLow = get(COL.RPE_LOW);
    const rpeHigh = get(COL.RPE_HIGH);
    let rpe = rpeLow;
    if (rpeLow && rpeHigh && rpeLow !== rpeHigh) rpe = `${rpeLow}–${rpeHigh}`;
    state.workoutSets.get(key).push({ kg: weight, reps, rpe, sett: get(COL.SETS), date });
  }
}

function findWorkoutSets(exName, ukeNum, dagNum) {
  const prefix = `${ukeNum}-${dagNum}-`;
  const key = prefix + normalizeName(exName);
  if (state.workoutSets.has(key)) return state.workoutSets.get(key);
  // Fallback: resolve via glossary English name (program uses Norwegian, workout uses English)
  const entry = lookupExercise(exName);
  if (entry?.name) {
    const englishKey = prefix + normalizeName(entry.name);
    if (state.workoutSets.has(englishKey)) return state.workoutSets.get(englishKey);
  }
  return null;
}

function weekNumberFromName(name) {
  const m = (name || "").match(/(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

function weekNameFromFile(file) {
  const base = file.name.replace(/\.[^.]+$/, "");
  const match = base.match(/Uke\s*(\d+)/i);
  if (match) return `Uke ${match[1]}`;
  return base;
}

// ---------- preload ----------

async function preloadAll() {
  const jobs = [];
  for (let n = 1; n <= TOTAL_WEEKS; n++) {
    jobs.push(fetch(PRELOAD_TEMPLATE(n))
      .then((r) => r.ok ? r.text() : null)
      .then((text) => {
        if (!text) return;
        const week = parseWeek(text, `Uke ${n}`);
        if (week.days.length > 0) {
          week.source = "preload";
          state.weeks[n - 1] = week;
        }
      })
      .catch((err) => console.warn(`preload Uke ${n} failed`, err)));
  }
  await Promise.all(jobs);
}

function applyUploads() {
  for (const [name, week] of Object.entries(state.uploads)) {
    const n = weekNumberFromName(name);
    if (n && n >= 1 && n <= TOTAL_WEEKS) {
      state.weeks[n - 1] = { ...week, source: "upload" };
    }
  }
}

function pickInitialWeek() {
  const firstLoaded = state.weeks.findIndex((w) => w !== null);
  state.activeWeek = firstLoaded >= 0 ? firstLoaded : 0;
  state.activeDay = 0;
}

// ---------- ingest ----------

async function ingestFiles(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return;
  let lastSlot = -1;
  for (const file of files) {
    try {
      const text = await file.text();
      const name = weekNameFromFile(file);
      const week = parseWeek(text, name);
      if (week.days.length === 0) {
        console.warn("No day sections found in", file.name);
        continue;
      }
      state.uploads[name] = week;
      const n = weekNumberFromName(name);
      if (n && n >= 1 && n <= TOTAL_WEEKS) {
        state.weeks[n - 1] = { ...week, source: "upload" };
        lastSlot = n - 1;
      }
    } catch (err) {
      console.error("Failed to parse", file.name, err);
    }
  }
  persistUploads();
  if (lastSlot >= 0) {
    state.activeWeek = lastSlot;
    state.activeDay = 0;
  }
  render();
}

// ---------- persistence (uploads only) ----------

function persistUploads() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.uploads));
  } catch (err) {
    console.warn("persist failed", err);
  }
}

function restoreUploads() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (data && typeof data === "object") state.uploads = data;
  } catch (err) {
    console.warn("restore failed", err);
  }
}

// ---------- UI ----------

function bindUI() {
  dom.fileInput.addEventListener("change", (e) => {
    ingestFiles(e.target.files);
    e.target.value = "";
  });
  dom.btnReset.addEventListener("click", async () => {
    if (Object.keys(state.uploads).length === 0) {
      alert("No uploaded weeks to clear.");
      return;
    }
    if (!confirm("Remove all uploaded weeks and restore the default 9-week program?")) return;
    state.uploads = {};
    persistUploads();
    state.weeks = new Array(TOTAL_WEEKS).fill(null);
    await preloadAll();
    pickInitialWeek();
    render();
  });
}

function render() {
  renderWeekNav();
  const week = state.weeks[state.activeWeek];
  if (!week) {
    dom.empty.hidden = false;
    dom.program.hidden = true;
    return;
  }
  dom.empty.hidden = true;
  dom.program.hidden = false;
  if (state.activeDay >= week.days.length) state.activeDay = 0;

  dom.weekTitle.textContent = week.name;
  dom.weekSubtitle.textContent =
    `${week.days.length} day${week.days.length === 1 ? "" : "s"} · ` +
    (week.source === "upload" ? "your upload" : "default program");
  renderDayTabs(week);
  renderDay(week.days[state.activeDay], state.activeWeek + 1, state.activeDay + 1);
}

function renderWeekNav() {
  dom.weekNav.innerHTML = "";
  for (let i = 0; i < TOTAL_WEEKS; i++) {
    const slot = state.weeks[i];
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "week-pill";
    btn.role = "tab";
    btn.textContent = `W${i + 1}`;
    btn.title = `Uke ${i + 1}`;
    btn.setAttribute("aria-selected", i === state.activeWeek ? "true" : "false");
    if (slot?.source === "upload") btn.dataset.uploaded = "true";
    if (!slot) btn.dataset.empty = "true";
    btn.addEventListener("click", () => {
      if (!slot) {
        alert(`Uke ${i + 1} hasn't loaded. Upload its CSV to fill this slot.`);
        return;
      }
      state.activeWeek = i;
      state.activeDay = 0;
      render();
    });
    dom.weekNav.appendChild(btn);
  }
}

function renderDayTabs(week) {
  dom.dayTabs.innerHTML = "";
  week.days.forEach((day, idx) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "day-tab";
    btn.role = "tab";
    btn.textContent = day.name;
    btn.setAttribute("aria-selected", idx === state.activeDay ? "true" : "false");
    btn.addEventListener("click", () => {
      state.activeDay = idx;
      render();
    });
    dom.dayTabs.appendChild(btn);
  });
}

function renderDay(day, ukeNum, dagNum) {
  dom.dayBody.innerHTML = "";
  if (!day || !day.exercises.length) {
    const empty = document.createElement("div");
    empty.className = "empty-day";
    empty.textContent = "No exercises for this day.";
    dom.dayBody.appendChild(empty);
    return;
  }
  for (const ex of day.exercises) {
    dom.dayBody.appendChild(renderExercise(ex, ukeNum, dagNum));
  }
}

function renderExercise(ex, ukeNum, dagNum) {
  const entry = lookupExercise(ex.name);
  const englishName = entry?.name || ex.name;
  const categoryEnglish = lookupCategory(ex.category);

  const card = document.createElement("article");
  card.className = "exercise";

  const head = document.createElement("header");
  head.className = "exercise-head";

  const h = document.createElement("h2");
  h.className = "exercise-name";
  h.textContent = englishName;
  if (englishName.toLowerCase() !== ex.name.toLowerCase()) {
    const raw = document.createElement("span");
    raw.className = "raw";
    raw.textContent = ex.name;
    h.appendChild(raw);
  }
  head.appendChild(h);

  const meta = document.createElement("div");
  meta.className = "exercise-meta";
  const exerciseId = state.exerciseIds.get(normalizeName(ex.name));
  if (exerciseId) {
    const idSpan = document.createElement("span");
    idSpan.className = "exercise-id";
    idSpan.textContent = `#${exerciseId}`;
    meta.appendChild(idSpan);
  }
  if (categoryEnglish) meta.appendChild(metaChip("Category", categoryEnglish));
  if (entry?.muscles) meta.appendChild(metaChip("Trains", entry.muscles));
  if (ex.oneRM && ex.oneRM !== "0") meta.appendChild(metaChip("1RM", `${ex.oneRM} kg`, true));
  if (meta.children.length) head.appendChild(meta);

  card.appendChild(head);

  if (entry?.how) {
    const how = document.createElement("p");
    how.className = "exercise-how";
    how.textContent = entry.how;
    card.appendChild(how);
  }

  const sets = document.createElement("div");
  sets.className = "sets";
  ex.sets.forEach((s) => sets.appendChild(renderSet(s)));
  card.appendChild(sets);

  const actualsData = findWorkoutSets(ex.name, ukeNum, dagNum) || ex.actuals;
  if (actualsData && actualsData.length) {
    const actualsBlock = document.createElement("div");
    actualsBlock.className = "actuals";
    const label = document.createElement("div");
    label.className = "actuals-label";
    label.textContent = "Logged";
    actualsBlock.appendChild(label);
    actualsData.forEach((a, idx) => {
      const row = document.createElement("div");
      row.className = "set-row actual-row";
      const tag = document.createElement("span");
      tag.className = "set-prescription";
      tag.textContent = `Sett ${a.sett || idx + 1}`;
      row.appendChild(tag);
      const detail = document.createElement("span");
      detail.className = "set-detail";
      if (a.rpe) detail.appendChild(pill("RPE", a.rpe));
      if (a.reps) detail.appendChild(pill("Reps", a.reps));
      row.appendChild(detail);
      const weight = document.createElement("span");
      weight.className = "set-weight";
      weight.textContent = a.kg ? `${a.kg} kg` : "—";
      row.appendChild(weight);
      actualsBlock.appendChild(row);
    });
    card.appendChild(actualsBlock);
  }

  const noteText = ex.sets.map((s) => s.note).filter(Boolean).join(" • ");
  if (noteText) {
    const note = document.createElement("p");
    note.className = "exercise-note";
    note.appendChild(annotateModifiers(noteText));
    card.appendChild(note);
  }

  if (entry?.video) {
    const link = document.createElement("a");
    link.className = "exercise-video";
    link.href = entry.video;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = "Watch form video →";
    card.appendChild(link);
  }

  return card;
}

function metaChip(label, value, accent = false) {
  const span = document.createElement("span");
  if (accent) span.className = "accent";
  span.textContent = `${label}: ${value}`;
  return span;
}

function renderSet(s) {
  const row = document.createElement("div");
  row.className = "set-row";

  const presc = document.createElement("span");
  presc.className = "set-prescription";
  presc.textContent = `${s.sets} × ${s.reps}`;
  row.appendChild(presc);

  const detail = document.createElement("span");
  detail.className = "set-detail";
  if (s.rpe) detail.appendChild(pill("RPE", s.rpe));
  if (s.percent && s.percent !== "0") detail.appendChild(pill("%", s.percent));
  row.appendChild(detail);

  const weight = document.createElement("span");
  weight.className = "set-weight";
  weight.textContent = s.weight && s.weight !== "0" ? `${s.weight} kg` : "—";
  row.appendChild(weight);

  return row;
}

function pill(label, value) {
  const span = document.createElement("span");
  span.className = "pill";
  span.innerHTML = `${label} <strong></strong>`;
  span.querySelector("strong").textContent = value;
  return span;
}

function annotateModifiers(text) {
  const frag = document.createDocumentFragment();
  const mods = Object.entries(state.glossary.modifiers || {})
    .sort((a, b) => b[0].length - a[0].length);
  let remaining = text;
  outer: while (remaining.length) {
    for (const [term, explanation] of mods) {
      const idx = remaining.toLowerCase().indexOf(term.toLowerCase());
      if (idx === 0) {
        const span = document.createElement("span");
        span.className = "term";
        span.title = explanation;
        span.textContent = remaining.slice(0, term.length);
        frag.appendChild(span);
        remaining = remaining.slice(term.length);
        continue outer;
      }
    }
    let nextIdx = remaining.length;
    for (const [term] of mods) {
      const i = remaining.toLowerCase().indexOf(term.toLowerCase());
      if (i > 0 && i < nextIdx) nextIdx = i;
    }
    frag.appendChild(document.createTextNode(remaining.slice(0, nextIdx)));
    remaining = remaining.slice(nextIdx);
  }
  return frag;
}
