// ===== Mon Quotidien — logique de l'interface =====

// ---------- État ----------
function defaultState() {
  return {
    habits: [],  // { id, name, history: { 'AAAA-MM-JJ': true } }
    tasks: [],   // { id, title, done, date|null, createdAt, doneAt|null }
    journal: {}, // { 'AAAA-MM-JJ': 'texte' }
    events: [],  // { id, title, date, time|null }
    settings: {},
  };
}

let state = defaultState();
let selectedDate = new Date();             // jour affiché dans la vue "Aujourd'hui"
let calendarMonth = startOfMonth(new Date());
let weekStart = startOfWeek(new Date());     // lundi de la semaine affichée
let editingSlot = null;                      // { date, hour } : créneau en cours de saisie dans la grille semaine
let editingItem = null;                      // { type: 'habit'|'task', id } : renommage en cours
let editingSchedule = null;                  // id de l'habitude dont on édite la programmation
let editingRecur = null;                      // id de la tâche dont on édite la récurrence
let drag = null;                              // glisser-déposer en cours
let currentView = 'today';
const RECUR_LABEL = { daily: 'jour', weekly: 'sem.', monthly: 'mois' };

// ---------- Persistance ----------
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => window.api.save(state), 300); // écriture groupée
}

async function loadState() {
  const loaded = await window.api.load();
  if (loaded && typeof loaded === 'object') {
    state = Object.assign(defaultState(), loaded);
  }
}

// ---------- Helpers dates ----------
function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function startOfWeek(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); // recule jusqu'au lundi
  return x;
}
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function isSameDay(a, b) { return ymd(a) === ymd(b); }

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const WEEKDAYS = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
const DAYS_SHORT = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const WK_ORDER = [1, 2, 3, 4, 5, 6, 0];           // Lun..Dim (valeurs de getDay())
const WK_LETTER = { 0: 'D', 1: 'L', 2: 'M', 3: 'M', 4: 'J', 5: 'V', 6: 'S' };
const WK_SHORT = { 0: 'Dim', 1: 'Lun', 2: 'Mar', 3: 'Mer', 4: 'Jeu', 5: 'Ven', 6: 'Sam' };

function prettyDate(d) { return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`; }
function formatShort(dateStr) {
  const [, m, d] = dateStr.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]}`;
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- Logique ----------
// ----- Programmation des habitudes -----
function habitSchedule(h) { return h.schedule || { type: 'daily' }; }
function habitAppliesOn(h, date) {
  const s = habitSchedule(h);
  if (s.type === 'weekdays') return (s.days || []).includes(date.getDay());
  if (s.type === 'monthdays') return (s.days || []).includes(date.getDate());
  return true; // 'daily' et 'weekly' : applicable tous les jours
}
function scheduleLabel(h) {
  const s = habitSchedule(h);
  if (s.type === 'weekdays') {
    const days = (s.days || []).slice().sort((a, b) => WK_ORDER.indexOf(a) - WK_ORDER.indexOf(b));
    return days.length ? days.map((d) => WK_SHORT[d]).join('·') : 'aucun jour';
  }
  if (s.type === 'weekly') return (s.target || 1) + '×/sem';
  if (s.type === 'monthdays') return (s.days || []).length ? 'le ' + s.days.slice().sort((a, b) => a - b).join(', ') : 'aucun jour';
  return 'tous les jours';
}
function weeklyDoneCount(h, date) {
  const start = startOfWeek(date);
  let n = 0;
  for (let i = 0; i < 7; i++) if (h.history[ymd(addDays(start, i))]) n++;
  return n;
}

// Série en cours : jours PROGRAMMÉS consécutifs cochés (saute les jours non programmés).
function currentStreak(habit) {
  let d = new Date();
  if (habitAppliesOn(habit, d) && !habit.history[ymd(d)]) d = addDays(d, -1);
  let streak = 0, guard = 0;
  while (guard++ < 400) {
    if (habitAppliesOn(habit, d)) {
      if (habit.history[ymd(d)]) streak++; else break;
    }
    d = addDays(d, -1);
  }
  return streak;
}

function tasksForDay(dateStr) {
  const pending = state.tasks.filter((t) => !t.done && (!t.date || t.date <= dateStr));
  const doneToday = state.tasks.filter((t) => t.done && t.doneAt === dateStr);
  return { pending, doneToday };
}

function eventsForDay(dateStr) {
  return state.events
    .filter((e) => e.date === dateStr)
    .sort((a, b) => (a.time || '').localeCompare(b.time || ''));
}

// ---------- Rendu ----------
function render() {
  renderHeader();
  document.getElementById('view-today').classList.toggle('hidden', currentView !== 'today');
  document.getElementById('view-week').classList.toggle('hidden', currentView !== 'week');
  document.getElementById('view-calendar').classList.toggle('hidden', currentView !== 'calendar');
  document.querySelectorAll('.tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.view === currentView));

  if (currentView === 'today') renderToday();
  else if (currentView === 'week') renderWeek();
  else renderCalendar();
}

function renderHeader() {
  const isToday = isSameDay(selectedDate, new Date());
  document.getElementById('current-day').textContent = isToday ? "Aujourd'hui" : WEEKDAYS[selectedDate.getDay()];
  document.getElementById('current-sub').textContent = prettyDate(selectedDate);
}

function renderToday() {
  renderHero();
  renderHabits();
  renderTasks();
  renderTodayEvents();
  const isToday = isSameDay(selectedDate, new Date());
  document.getElementById('journal-title').textContent = isToday ? "Fait aujourd'hui" : 'Fait le ' + formatShort(ymd(selectedDate));
  document.getElementById('journal-text').value = state.journal[ymd(selectedDate)] || '';

  const ri = document.querySelector('.rename-input');
  if (ri) { ri.focus(); ri.select(); }
}

// Valide un renommage d'habitude / tâche
function commitRename(input) {
  if (!editingItem) return;
  const val = input.value.trim();
  const [type, id] = (input.dataset.rename || '').split(':');
  if (val) {
    if (type === 'habit') { const h = state.habits.find((x) => x.id === id); if (h) h.name = val; }
    else if (type === 'task') { const t = state.tasks.find((x) => x.id === id); if (t) t.title = val; }
  }
  editingItem = null;
  save(); render();
}

// Progression du jour : habitudes + tâches faites / total
function dayProgress() {
  const ds = ymd(selectedDate);
  const dayHabits = state.habits.filter((h) => habitAppliesOn(h, selectedDate));
  const habitsTotal = dayHabits.length;
  const habitsDone = dayHabits.filter((h) => h.history[ds]).length;
  const { pending, doneToday } = tasksForDay(ds);
  const tasksTotal = pending.length + doneToday.length;
  const tasksDone = doneToday.length;
  const total = habitsTotal + tasksTotal;
  const done = habitsDone + tasksDone;
  return { habitsTotal, habitsDone, tasksTotal, tasksDone, pct: total ? Math.round((done / total) * 100) : 0 };
}

function renderHero() {
  const p = dayProgress();
  document.getElementById('stat-habits').textContent = `${p.habitsDone}/${p.habitsTotal}`;
  document.getElementById('stat-tasks').textContent = `${p.tasksDone}/${p.tasksTotal}`;
  document.getElementById('hero-pct').textContent = p.pct + '%';

  const ring = document.getElementById('ring-fg');
  const C = 2 * Math.PI * 52;
  ring.style.strokeDasharray = C;
  ring.style.strokeDashoffset = C * (1 - p.pct / 100);
  document.querySelector('.hero-ring').classList.toggle('complete', p.pct === 100);

  const title = document.getElementById('hero-title');
  if (p.habitsTotal + p.tasksTotal === 0) title.textContent = 'Rien de prévu — ajoute une habitude ou une tâche';
  else if (p.pct === 100) title.textContent = 'Journée bouclée, bravo ! 🎉';
  else if (p.pct >= 50) title.textContent = 'Belle lancée, continue 💪';
  else title.textContent = 'En route pour ta journée';
}

function renderTodayEvents() {
  const list = document.getElementById('today-event-list');
  list.innerHTML = '';
  const evs = eventsForDay(ymd(selectedDate));
  if (evs.length === 0) {
    list.innerHTML = '<li class="empty">Aucun rendez-vous ce jour. Ajoute-en dans Semaine ou Calendrier.</li>';
    return;
  }
  for (const e of evs) {
    const li = document.createElement('li');
    li.className = 'event';
    li.innerHTML = `
      <span class="event-time">${e.time || '—'}</span>
      <span class="event-title">${escapeHtml(e.title)}</span>
      <button class="del" data-del-event="${e.id}" title="Supprimer">✕</button>`;
    list.appendChild(li);
  }
}

// Frise des 7 derniers jours (jusqu'au jour affiché) : point plein = fait
function habitWeekDots(habit) {
  let html = '<span class="habit-week" title="7 derniers jours">';
  for (let i = 6; i >= 0; i--) {
    const ds = ymd(addDays(selectedDate, -i));
    html += `<span class="hd${habit.history[ds] ? ' on' : ''}${i === 0 ? ' now' : ''}"></span>`;
  }
  return html + '</span>';
}

function renderHabits() {
  const list = document.getElementById('habit-list');
  const dateStr = ymd(selectedDate);
  list.innerHTML = '';
  if (state.habits.length === 0) {
    list.innerHTML = '<li class="empty">Ajoute ta première habitude ci-dessous 🌱</li>';
    return;
  }
  const showAll = !!state.settings.showAllHabits;
  const applicable = state.habits.filter((h) => habitAppliesOn(h, selectedDate));
  const visible = showAll ? state.habits : applicable;
  const hiddenCount = state.habits.length - applicable.length;

  if (visible.length === 0) {
    list.innerHTML = '<li class="empty">Aucune habitude prévue ce jour 🎈</li>';
  }
  for (const h of visible) {
    const applies = habitAppliesOn(h, selectedDate);
    const done = !!h.history[dateStr];
    const s = habitSchedule(h);
    let rightHtml;
    if (s.type === 'weekly') {
      rightHtml = `<span class="streak weekly" title="Cette semaine">${weeklyDoneCount(h, selectedDate)}/${s.target || 1} sem.</span>`;
    } else {
      rightHtml = `${habitWeekDots(h)}<span class="streak" title="Série en cours">🔥 ${currentStreak(h)}</span>`;
    }
    const li = document.createElement('li');
    li.className = 'habit' + (done ? ' done' : '') + (applies ? '' : ' off');
    li.innerHTML = `
      <button class="drag-handle" data-drag="habit:${h.id}" title="Glisser pour réordonner">⠿</button>
      <button class="check" data-habit="${h.id}" title="Cocher pour ce jour">${done ? '✓' : ''}</button>
      ${editingItem && editingItem.type === 'habit' && editingItem.id === h.id
        ? `<input class="rename-input" data-rename="habit:${h.id}" value="${escapeHtml(h.name)}" />`
        : `<span class="habit-name" data-edithabit="${h.id}" title="Double-clic pour renommer">${escapeHtml(h.name)}</span>`}
      <button class="sched-chip ${editingSchedule === h.id ? 'open' : ''}" data-sched="${h.id}" title="Programmer les jours">${scheduleLabel(h)}</button>
      ${rightHtml}
      <button class="del" data-del-habit="${h.id}" title="Supprimer">✕</button>`;
    list.appendChild(li);
    if (editingSchedule === h.id) list.appendChild(buildScheduleEditor(h));
  }
  if (hiddenCount > 0 || showAll) {
    const li = document.createElement('li');
    li.className = 'habit-toggle';
    li.innerHTML = `<button class="link-btn" id="toggle-all-habits">${showAll ? '▾ Afficher seulement ce jour' : `▸ Voir toutes les habitudes (+${hiddenCount})`}</button>`;
    list.appendChild(li);
  }
}

// Éditeur de programmation (déplié sous l'habitude)
function buildScheduleEditor(h) {
  const s = habitSchedule(h);
  const li = document.createElement('li');
  li.className = 'sched-editor';
  const mode = (type, label) => `<button class="sched-mode ${s.type === type ? 'active' : ''}" data-sched-mode="${h.id}:${type}">${label}</button>`;
  let detail = '';
  if (s.type === 'weekdays') {
    detail = '<div class="sched-days">' + WK_ORDER.map((d) =>
      `<button class="sched-day ${(s.days || []).includes(d) ? 'on' : ''}" data-sched-day="${h.id}:${d}" title="${WK_SHORT[d]}">${WK_LETTER[d]}</button>`).join('') + '</div>';
  } else if (s.type === 'weekly') {
    detail = `<div class="sched-detail"><input type="number" min="1" max="7" value="${s.target || 3}" class="sched-num" data-sched-num="${h.id}" /> fois par semaine (quand tu veux)</div>`;
  } else if (s.type === 'monthdays') {
    detail = `<div class="sched-detail">Jours du mois : <input type="text" value="${(s.days || []).join(', ')}" class="sched-text" data-sched-month="${h.id}" placeholder="ex. 1, 15" /></div>`;
  }
  li.innerHTML = `<div class="sched-modes">${mode('daily', 'Tous les jours')}${mode('weekdays', 'Jours')}${mode('weekly', 'X/sem')}${mode('monthdays', 'Du mois')}</div>${detail}`;
  return li;
}

// Éditeur de récurrence d'une tâche (déplié sous la tâche)
function buildRecurEditor(t) {
  const li = document.createElement('li');
  li.className = 'sched-editor';
  const opt = (period, label) => `<button class="sched-mode ${(t.recur || '') === (period || '') ? 'active' : ''}" data-recur-set="${t.id}:${period || 'none'}">${label}</button>`;
  li.innerHTML = `<div class="sched-modes">${opt('', 'Non')}${opt('daily', 'Chaque jour')}${opt('weekly', 'Chaque semaine')}${opt('monthly', 'Chaque mois')}</div>`;
  return li;
}

function renderTasks() {
  const dateStr = ymd(selectedDate);
  const { pending, doneToday } = tasksForDay(dateStr);
  const list = document.getElementById('task-list');
  list.innerHTML = '';
  if (pending.length === 0 && doneToday.length === 0) {
    list.innerHTML = '<li class="empty">Rien pour l\'instant. Ajoute une tâche 👇</li>';
  }
  for (const t of pending) {
    const overdue = t.date && t.date < dateStr;
    const li = document.createElement('li');
    li.className = 'task';
    li.innerHTML = `
      <button class="drag-handle" data-drag="task:${t.id}" title="Glisser pour réordonner">⠿</button>
      <button class="check" data-task="${t.id}" title="${t.recur ? 'Fait — passe à la prochaine fois' : 'Terminer'}"></button>
      ${editingItem && editingItem.type === 'task' && editingItem.id === t.id
        ? `<input class="rename-input" data-rename="task:${t.id}" value="${escapeHtml(t.title)}" />`
        : `<span class="task-title" data-edittask="${t.id}" title="Double-clic pour renommer">${escapeHtml(t.title)}</span>`}
      ${t.recur ? `<button class="recur-tag ${editingRecur === t.id ? 'on' : ''}" data-recur="${t.id}" title="Changer la récurrence">🔁 ${RECUR_LABEL[t.recur]}</button>` : ''}
      ${t.date && t.date !== dateStr ? `<span class="task-date ${overdue ? 'overdue' : ''}">${overdue ? '⚠ ' : ''}${formatShort(t.date)}</span>` : ''}
      <button class="task-act" data-postpone="${t.id}" title="Reporter à demain">↪</button>
      ${t.recur ? '' : `<button class="task-act ${editingRecur === t.id ? 'on' : ''}" data-recur="${t.id}" title="Rendre récurrente">🔁</button>`}
      <button class="del" data-del-task="${t.id}" title="Supprimer">✕</button>`;
    list.appendChild(li);
    if (editingRecur === t.id) list.appendChild(buildRecurEditor(t));
  }
  for (const t of doneToday) {
    const li = document.createElement('li');
    li.className = 'task done';
    li.innerHTML = `
      <button class="check" data-task="${t.id}" title="Rouvrir">✓</button>
      <span class="task-title">${escapeHtml(t.title)}</span>
      <button class="del" data-del-task="${t.id}" title="Supprimer">✕</button>`;
    list.appendChild(li);
  }
}

function renderCalendar() {
  document.getElementById('cal-title').textContent = `${MONTHS[calendarMonth.getMonth()]} ${calendarMonth.getFullYear()}`;
  const grid = document.getElementById('cal-grid');
  grid.innerHTML = '';

  for (const d of DAYS_SHORT) {
    const el = document.createElement('div');
    el.className = 'cal-weekday';
    el.textContent = d;
    grid.appendChild(el);
  }

  const first = startOfMonth(calendarMonth);
  const offset = (first.getDay() + 6) % 7; // décale pour commencer le lundi
  const daysInMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 0).getDate();

  for (let i = 0; i < offset; i++) {
    const el = document.createElement('div');
    el.className = 'cal-cell blank';
    grid.appendChild(el);
  }

  const todayStr = ymd(new Date());
  const selStr = ymd(selectedDate);
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = ymd(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), day));
    const hasEvents = eventsForDay(dateStr).length > 0;
    const hasTasks = state.tasks.some((t) => t.date === dateStr && !t.done);
    const hasNote = !!(state.journal[dateStr] && state.journal[dateStr].trim());
    const cell = document.createElement('div');
    cell.className = 'cal-cell';
    if (dateStr === todayStr) cell.classList.add('today');
    if (dateStr === selStr) cell.classList.add('selected');
    cell.dataset.date = dateStr;
    const dots = (hasEvents ? '<span class="dot ev"></span>' : '')
      + (hasTasks ? '<span class="dot task"></span>' : '')
      + (hasNote ? '<span class="dot note"></span>' : '');
    cell.innerHTML = `<span class="cal-num">${day}</span><span class="cal-dots">${dots}</span>`;
    grid.appendChild(cell);
  }

  renderDayPanel();
}

function renderDayPanel() {
  document.getElementById('day-panel-title').textContent = prettyDate(selectedDate);
  const list = document.getElementById('event-list');
  list.innerHTML = '';
  const evs = eventsForDay(ymd(selectedDate));
  if (evs.length === 0) {
    list.innerHTML = '<li class="empty">Aucun événement ce jour.</li>';
  }
  for (const e of evs) {
    const li = document.createElement('li');
    li.className = 'event';
    li.innerHTML = `
      <span class="event-time">${e.time || '—'}</span>
      <span class="event-title">${escapeHtml(e.title)}</span>
      <button class="del" data-del-event="${e.id}" title="Supprimer">✕</button>`;
    list.appendChild(li);
  }
}

function renderWeek() {
  const days = [];
  for (let i = 0; i < 7; i++) days.push(addDays(weekStart, i));
  const last = days[6];

  // Titre : "16 – 22 juin 2026" (ou avec les deux mois si la semaine est à cheval)
  document.getElementById('week-title').textContent = weekStart.getMonth() === last.getMonth()
    ? `${weekStart.getDate()} – ${last.getDate()} ${MONTHS[last.getMonth()]} ${last.getFullYear()}`
    : `${weekStart.getDate()} ${MONTHS[weekStart.getMonth()]} – ${last.getDate()} ${MONTHS[last.getMonth()]} ${last.getFullYear()}`;

  const grid = document.getElementById('week-grid');
  grid.innerHTML = '';
  const todayStr = ymd(new Date());

  // En-tête : coin vide + 7 jours cliquables
  const corner = document.createElement('div');
  corner.className = 'wk-corner';
  grid.appendChild(corner);
  days.forEach((d, i) => {
    const ds = ymd(d);
    const head = document.createElement('div');
    head.className = 'wk-dayhead' + (ds === todayStr ? ' today' : '');
    head.dataset.drill = ds;
    head.innerHTML = `<span class="wk-dow">${DAYS_SHORT[i]}</span><span class="wk-date">${d.getDate()}</span>`;
    grid.appendChild(head);
  });

  // Ligne "jour entier" : tâches dues + événements sans heure
  const adLabel = document.createElement('div');
  adLabel.className = 'wk-allday-label';
  adLabel.textContent = 'jour';
  grid.appendChild(adLabel);
  for (const d of days) {
    const ds = ymd(d);
    const cell = document.createElement('div');
    cell.className = 'wk-allday' + (ds === todayStr ? ' today' : '');
    state.tasks.filter((t) => t.date === ds && !t.done).forEach((t) => {
      const chip = document.createElement('div');
      chip.className = 'wk-chip task';
      chip.dataset.drill = ds;
      chip.title = t.title;
      chip.textContent = t.title;
      cell.appendChild(chip);
    });
    state.events.filter((e) => e.date === ds && !e.time).forEach((e) => {
      const chip = document.createElement('div');
      chip.className = 'wk-chip ev';
      chip.dataset.drill = ds;
      chip.title = e.title;
      chip.textContent = e.title;
      cell.appendChild(chip);
    });
    grid.appendChild(cell);
  }

  // Lignes horaires 00:00 → 23:00
  for (let hour = 0; hour < 24; hour++) {
    const hl = document.createElement('div');
    hl.className = 'wk-hourlabel';
    hl.dataset.h = hour;
    hl.textContent = String(hour).padStart(2, '0') + ':00';
    grid.appendChild(hl);
    for (const d of days) {
      const ds = ymd(d);
      const cell = document.createElement('div');
      cell.className = 'wk-cell' + (ds === todayStr ? ' today' : '');
      cell.dataset.date = ds;
      cell.dataset.hour = hour;
      state.events
        .filter((e) => e.date === ds && e.time && parseInt(e.time.slice(0, 2), 10) === hour)
        .sort((a, b) => a.time.localeCompare(b.time))
        .forEach((e) => {
          const blk = document.createElement('div');
          blk.className = 'wk-event';
          blk.dataset.drill = ds;
          blk.innerHTML = `<span class="wk-event-time">${e.time}</span>${escapeHtml(e.title)}`;
          cell.appendChild(blk);
        });
      // Saisie en ligne d'un événement sur un créneau cliqué
      if (editingSlot && editingSlot.date === ds && editingSlot.hour === hour) {
        const inp = document.createElement('input');
        inp.type = 'text';
        inp.className = 'wk-input';
        inp.placeholder = "Titre de l'événement…";
        const slotKey = ds + 'T' + hour;
        inp.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter') {
            const title = inp.value.trim();
            editingSlot = null;
            if (title) addEvent(title, `${String(hour).padStart(2, '0')}:00`, ds);
            else render();
          } else if (ev.key === 'Escape') {
            editingSlot = null; render();
          }
        });
        inp.addEventListener('blur', () => {
          // annule si on clique vraiment ailleurs (laisse le temps à un autre créneau de s'ouvrir)
          setTimeout(() => {
            if (editingSlot && editingSlot.date + 'T' + editingSlot.hour === slotKey) { editingSlot = null; render(); }
          }, 120);
        });
        cell.appendChild(inp);
      }
      grid.appendChild(cell);
    }
  }
  const editInput = grid.querySelector('.wk-input');
  if (editInput) editInput.focus();
}

// Cale la grille de la semaine sur le matin (≈ 7h) à l'ouverture/navigation.
function scrollWeekToMorning() {
  requestAnimationFrame(() => {
    const scroller = document.querySelector('.week-scroll');
    const row = document.querySelector('.wk-hourlabel[data-h="7"]');
    if (scroller && row) scroller.scrollTop = Math.max(0, row.offsetTop - 80);
  });
}

// ---------- Actions ----------
function addHabit(name) {
  name = name.trim();
  if (!name) return;
  state.habits.push({ id: crypto.randomUUID(), name, history: {} });
  save(); render();
}
function toggleHabit(id) {
  const h = state.habits.find((x) => x.id === id);
  if (!h) return;
  const ds = ymd(selectedDate);
  if (h.history[ds]) delete h.history[ds]; else h.history[ds] = true;
  save(); render();
}
function deleteHabit(id) { state.habits = state.habits.filter((x) => x.id !== id); save(); render(); }

function setScheduleMode(id, type) {
  const h = state.habits.find((x) => x.id === id);
  if (!h) return;
  const prev = h.schedule || {};
  if (type === 'weekdays') h.schedule = { type: 'weekdays', days: prev.type === 'weekdays' && prev.days ? prev.days : [1, 2, 3, 4, 5] };
  else if (type === 'weekly') h.schedule = { type: 'weekly', target: prev.target || 3 };
  else if (type === 'monthdays') h.schedule = { type: 'monthdays', days: prev.type === 'monthdays' && prev.days ? prev.days : [1] };
  else h.schedule = { type: 'daily' };
  save(); render();
}
function toggleScheduleDay(id, day) {
  const h = state.habits.find((x) => x.id === id);
  if (!h || !h.schedule) return;
  const days = h.schedule.days || [];
  h.schedule.days = days.includes(day) ? days.filter((d) => d !== day) : [...days, day];
  save(); render();
}
function setWeeklyTarget(id, n) {
  const h = state.habits.find((x) => x.id === id);
  if (!h || !h.schedule) return;
  h.schedule.target = Math.max(1, Math.min(7, n | 0));
  save(); render();
}
function setMonthDays(id, str) {
  const h = state.habits.find((x) => x.id === id);
  if (!h || !h.schedule) return;
  h.schedule.days = str.split(',').map((x) => parseInt(x.trim(), 10)).filter((n) => n >= 1 && n <= 31);
  save(); render();
}

function addTask(title, date) {
  title = title.trim();
  if (!title) return;
  state.tasks.push({ id: crypto.randomUUID(), title, done: false, date: date || null, createdAt: ymd(new Date()), doneAt: null });
  save(); render();
}
function advanceDate(dateStr, period) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  if (period === 'daily') dt.setDate(dt.getDate() + 1);
  else if (period === 'weekly') dt.setDate(dt.getDate() + 7);
  else if (period === 'monthly') dt.setMonth(dt.getMonth() + 1);
  return ymd(dt);
}
function toggleTask(id) {
  const t = state.tasks.find((x) => x.id === id);
  if (!t) return;
  if (t.recur && !t.done) {
    // Tâche récurrente : "fait" la fait passer à sa prochaine occurrence (future).
    let next = advanceDate(t.date || ymd(selectedDate), t.recur);
    const todayStr = ymd(new Date());
    let guard = 0;
    while (next <= todayStr && guard++ < 60) next = advanceDate(next, t.recur);
    t.date = next;
  } else {
    t.done = !t.done;
    t.doneAt = t.done ? ymd(selectedDate) : null;
  }
  save(); render();
}
function deleteTask(id) { state.tasks = state.tasks.filter((x) => x.id !== id); save(); render(); }
function postponeTask(id) {
  const t = state.tasks.find((x) => x.id === id);
  if (!t) return;
  t.date = advanceDate(t.date || ymd(selectedDate), 'daily'); // +1 jour
  save(); render();
}
function setRecur(id, period) {
  const t = state.tasks.find((x) => x.id === id);
  if (!t) return;
  if (period) t.recur = period; else delete t.recur;
  editingRecur = null;
  save(); render();
}

function addEvent(title, time, dateStr) {
  title = title.trim();
  if (!title) return;
  state.events.push({ id: crypto.randomUUID(), title, date: dateStr || ymd(selectedDate), time: time || null });
  save(); render();
}
function deleteEvent(id) { state.events = state.events.filter((x) => x.id !== id); save(); render(); }

// Trouve la ligne (du même type) au-dessus de laquelle insérer pendant un glisser.
function dragRowAfter(list, y, type) {
  const rows = [...list.children].filter((li) => {
    const h = li.querySelector && li.querySelector('.drag-handle');
    return h && h.dataset.drag.split(':')[0] === type && !li.classList.contains('dragging');
  });
  for (const row of rows) {
    const box = row.getBoundingClientRect();
    if (y < box.top + box.height / 2) return row;
  }
  return null;
}

// ---------- Branchements ----------
function wireEvents() {
  // Réordonner par glisser-déposer (souris + tactile, via Pointer Events)
  document.addEventListener('pointerdown', (e) => {
    const handle = e.target.closest('.drag-handle');
    if (!handle) return;
    e.preventDefault();
    editingSchedule = null; editingRecur = null; editingItem = null;
    const row = handle.closest('li');
    drag = { type: handle.dataset.drag.split(':')[0], row, list: row.parentElement };
    row.classList.add('dragging');
    try { handle.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  });
  document.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const after = dragRowAfter(drag.list, e.clientY, drag.type);
    if (after == null) { if (drag.row.nextElementSibling) drag.list.appendChild(drag.row); }
    else if (after !== drag.row && after !== drag.row.nextElementSibling) drag.list.insertBefore(drag.row, after);
  });
  document.addEventListener('pointerup', () => {
    if (!drag) return;
    drag.row.classList.remove('dragging');
    const arr = drag.type === 'habit' ? state.habits : state.tasks;
    const movedId = drag.row.querySelector('.drag-handle').dataset.drag.split(':')[1];
    let sib = drag.row.nextElementSibling, beforeId = null;
    while (sib) {
      const h = sib.querySelector && sib.querySelector('.drag-handle');
      if (h && h.dataset.drag.split(':')[0] === drag.type) { beforeId = h.dataset.drag.split(':')[1]; break; }
      sib = sib.nextElementSibling;
    }
    const moved = arr.find((x) => x.id === movedId);
    if (moved) {
      const without = arr.filter((x) => x.id !== movedId);
      let idx = beforeId ? without.findIndex((x) => x.id === beforeId) : without.length;
      if (idx < 0) idx = without.length;
      without.splice(idx, 0, moved);
      if (drag.type === 'habit') state.habits = without; else state.tasks = without;
      save();
    }
    drag = null;
    render();
  });

  // Navigation entre les jours
  document.getElementById('prev-day').onclick = () => { selectedDate = addDays(selectedDate, -1); render(); };
  document.getElementById('next-day').onclick = () => { selectedDate = addDays(selectedDate, 1); render(); };
  document.getElementById('today-btn').onclick = () => { selectedDate = new Date(); calendarMonth = startOfMonth(selectedDate); render(); };

  // Onglets
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.onclick = () => {
      editingSlot = null;
      currentView = tab.dataset.view;
      render();
      if (currentView === 'week') scrollWeekToMorning();
    };
  });

  // Navigation du calendrier
  document.getElementById('cal-prev').onclick = () => { calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1); render(); };
  document.getElementById('cal-next').onclick = () => { calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1); render(); };

  // Navigation de la semaine
  document.getElementById('week-prev').onclick = () => { editingSlot = null; weekStart = addDays(weekStart, -7); render(); scrollWeekToMorning(); };
  document.getElementById('week-next').onclick = () => { editingSlot = null; weekStart = addDays(weekStart, 7); render(); scrollWeekToMorning(); };
  document.getElementById('week-today').onclick = () => { editingSlot = null; weekStart = startOfWeek(new Date()); render(); scrollWeekToMorning(); };

  // Clic dans la grille de la semaine : drill-in sur un jour, ou créneau vide -> saisie en ligne
  document.getElementById('week-grid').addEventListener('click', (e) => {
    if (e.target.tagName === 'INPUT') return; // ne pas perturber une saisie en cours
    const drill = e.target.closest('[data-drill]');
    if (drill) {
      const [y, m, d] = drill.dataset.drill.split('-').map(Number);
      selectedDate = new Date(y, m - 1, d);
      currentView = 'today';
      editingSlot = null;
      render();
      return;
    }
    const cell = e.target.closest('.wk-cell');
    if (cell) {
      editingSlot = { date: cell.dataset.date, hour: Number(cell.dataset.hour) };
      render();
    }
  });

  // Clic sur un jour du calendrier
  document.getElementById('cal-grid').addEventListener('click', (e) => {
    const cell = e.target.closest('.cal-cell');
    if (!cell || !cell.dataset.date) return;
    const [y, m, d] = cell.dataset.date.split('-').map(Number);
    selectedDate = new Date(y, m - 1, d);
    currentView = 'today'; // ouvrir ce jour pour tout voir/éditer
    render();
  });

  // Cases à cocher / suppressions (délégation globale)
  document.addEventListener('click', (e) => {
    const ds = e.target.dataset;
    if (!ds) return;
    if (ds.habit) toggleHabit(ds.habit);
    else if (ds.delHabit) { if (confirm('Supprimer cette habitude et son historique ?')) deleteHabit(ds.delHabit); }
    else if (ds.task) toggleTask(ds.task);
    else if (ds.delTask) deleteTask(ds.delTask);
    else if (ds.delEvent) deleteEvent(ds.delEvent);
  });

  // Programmation des habitudes (ouvrir l'éditeur, choisir mode/jours, bascule "toutes")
  document.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-sched]');
    if (chip) { editingSchedule = editingSchedule === chip.dataset.sched ? null : chip.dataset.sched; render(); return; }
    const m = e.target.closest('[data-sched-mode]');
    if (m) { const [id, type] = m.dataset.schedMode.split(':'); setScheduleMode(id, type); return; }
    const dy = e.target.closest('[data-sched-day]');
    if (dy) { const [id, day] = dy.dataset.schedDay.split(':'); toggleScheduleDay(id, Number(day)); return; }
    const pp = e.target.closest('[data-postpone]');
    if (pp) { postponeTask(pp.dataset.postpone); return; }
    const rc = e.target.closest('[data-recur]');
    if (rc) { editingRecur = editingRecur === rc.dataset.recur ? null : rc.dataset.recur; render(); return; }
    const rs = e.target.closest('[data-recur-set]');
    if (rs) { const [id, p] = rs.dataset.recurSet.split(':'); setRecur(id, p === 'none' ? null : p); return; }
    if (e.target.id === 'toggle-all-habits') { state.settings.showAllHabits = !state.settings.showAllHabits; save(); render(); }
  });
  document.addEventListener('change', (e) => {
    if (e.target.dataset.schedNum) setWeeklyTarget(e.target.dataset.schedNum, Number(e.target.value));
    else if (e.target.dataset.schedMonth) setMonthDays(e.target.dataset.schedMonth, e.target.value);
  });

  // Renommage par double-clic (habitudes / tâches)
  document.addEventListener('dblclick', (e) => {
    const h = e.target.closest('[data-edithabit]');
    if (h) { editingItem = { type: 'habit', id: h.dataset.edithabit }; render(); return; }
    const t = e.target.closest('[data-edittask]');
    if (t) { editingItem = { type: 'task', id: t.dataset.edittask }; render(); }
  });
  document.addEventListener('keydown', (e) => {
    if (!e.target.classList || !e.target.classList.contains('rename-input')) return;
    if (e.key === 'Enter') commitRename(e.target);
    else if (e.key === 'Escape') { editingItem = null; render(); }
  });
  document.addEventListener('focusout', (e) => {
    if (e.target.classList && e.target.classList.contains('rename-input')) commitRename(e.target);
  });

  // Navigation au clavier : ←/→ selon la vue (jour / semaine / mois)
  document.addEventListener('keydown', (e) => {
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea') return; // ne pas gêner la saisie
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const dir = e.key === 'ArrowLeft' ? -1 : 1;
    if (currentView === 'today') { selectedDate = addDays(selectedDate, dir); render(); }
    else if (currentView === 'week') { editingSlot = null; weekStart = addDays(weekStart, 7 * dir); render(); scrollWeekToMorning(); }
    else { calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + dir, 1); render(); }
  });

  // Journal (sauvegarde au fil de la frappe)
  document.getElementById('journal-text').addEventListener('input', (e) => {
    state.journal[ymd(selectedDate)] = e.target.value;
    save();
  });

  // Ajout d'habitude
  const habitInput = document.getElementById('habit-input');
  const submitHabit = () => { addHabit(habitInput.value); habitInput.value = ''; habitInput.focus(); };
  habitInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitHabit(); });
  document.getElementById('add-habit').onclick = submitHabit;

  // Ajout de tâche
  const taskInput = document.getElementById('task-input');
  const taskDate = document.getElementById('task-date');
  const submitTask = () => { addTask(taskInput.value, taskDate.value || ymd(selectedDate)); taskInput.value = ''; taskDate.value = ''; taskInput.focus(); };
  taskInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitTask(); });
  document.getElementById('add-task').onclick = submitTask;

  // Ajout d'événement
  const eventTitle = document.getElementById('event-title');
  const eventTime = document.getElementById('event-time');
  const submitEvent = () => { addEvent(eventTitle.value, eventTime.value || null); eventTitle.value = ''; eventTime.value = ''; eventTitle.focus(); };
  eventTitle.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitEvent(); });
  document.getElementById('add-event').onclick = submitEvent;
}

// ---------- Démarrage ----------
(async function init() {
  await loadState();
  wireEvents();
  render();
})();
