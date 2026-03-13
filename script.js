const severityMap = {
  low: "低胜利",
  medium: "中胜利",
  high: "高胜利",
  overwhelming: "压倒性胜利"
};

const winnerClassMap = {
  coffee: "winner-inline-coffee",
  game: "winner-inline-game"
};

const panelMeta = {
  coffee: {
    name: "咖啡猫猫",
    panel: document.querySelector(".coffee-panel"),
    textarea: document.getElementById("coffee-input"),
    note: document.getElementById("coffee-panel-note"),
    sealButton: document.querySelector('.seal-btn[data-panel="coffee"]'),
    editButton: document.querySelector('.edit-btn[data-panel="coffee"]'),
    mask: document.querySelector('.argument-box[data-panel="coffee"] .sealed-mask')
  },
  game: {
    name: "游戏猫猫",
    panel: document.querySelector(".game-panel"),
    textarea: document.getElementById("game-input"),
    note: document.getElementById("game-panel-note"),
    sealButton: document.querySelector('.seal-btn[data-panel="game"]'),
    editButton: document.querySelector('.edit-btn[data-panel="game"]'),
    mask: document.querySelector('.argument-box[data-panel="game"] .sealed-mask')
  }
};

const sideChoiceButtons = document.querySelectorAll("[data-side-choice]");
const caseCodeInputEl = document.getElementById("case-code-input");
const joinCaseBtn = document.getElementById("join-case-btn");
const currentCaseBadgeEl = document.getElementById("current-case-badge");
const sessionStatusTextEl = document.getElementById("session-status-text");
const caseHelpToggleBtn = document.getElementById("case-help-toggle");
const caseHelpModalEl = document.getElementById("case-help-modal");
const caseHelpCloseBtn = document.getElementById("case-help-close");

const verdictEl = document.getElementById("verdict-text");
const verdictLevelEl = document.getElementById("verdict-level");
const verdictMetaEl = document.getElementById("judge-meta");
const analysisEl = document.getElementById("analysis-text");
const reasonListEl = document.getElementById("reason-list");
const courtTriggerBtn = document.getElementById("court-trigger");
const archiveCaseBtn = document.getElementById("refresh-judge");
const coffeeAdviceEl = document.getElementById("coffee-advice-text");
const gameAdviceEl = document.getElementById("game-advice-text");

const datePickerTriggerBtn = document.getElementById("date-picker-trigger");
const datePickerPopoverEl = document.getElementById("date-picker-popover");
const selectedDateLabelEl = document.getElementById("selected-date-label");
const dateGridEl = document.getElementById("date-grid");
const calendarTitleEl = document.getElementById("calendar-title");
const prevMonthBtn = document.getElementById("prev-month");
const nextMonthBtn = document.getElementById("next-month");
const historyListEl = document.getElementById("history-list");

const recordModalEl = document.getElementById("record-modal");
const confirmModalEl = document.getElementById("confirm-modal");
const detailCloseBtn = document.getElementById("detail-close");
const confirmCancelBtn = document.getElementById("confirm-cancel");
const confirmDeleteBtn = document.getElementById("confirm-delete");
const detailTitleEl = document.getElementById("detail-title");
const detailDateEl = document.getElementById("detail-date");
const detailLevelEl = document.getElementById("detail-level");
const detailWinnerEl = document.getElementById("detail-winner");
const detailVerdictEl = document.getElementById("detail-verdict");
const detailAnalysisEl = document.getElementById("detail-analysis");
const detailCoffeeAdviceEl = document.getElementById("detail-coffee-advice");
const detailGameAdviceEl = document.getElementById("detail-game-advice");
const detailCoffeeEl = document.getElementById("detail-coffee");
const detailGameEl = document.getElementById("detail-game");

const activeState = {
  selectedSide: "coffee",
  side: "coffee",
  code: "",
  joined: false,
  snapshot: null,
  isEditing: false,
  localDraft: "",
  isJoining: false,
  isSubmitting: false,
  isJudging: false,
  isArchiving: false,
  pollTimer: null
};

let selectedHistoryDate = null;
let visibleMonth = new Date();
let pendingDeleteId = null;
let isDatePickerOpen = false;
let recordsCache = [];

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizeCode(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 6);
}

function parseDateString(dateString) {
  const [year, month, day] = dateString.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function formatDisplayDate(dateString) {
  const date = parseDateString(dateString);
  return `${date.getFullYear()} 年 ${date.getMonth() + 1} 月 ${date.getDate()} 日`;
}

function normalizeRecord(record, index) {
  return {
    id: record.id || `history-${index}`,
    date: record.date || "",
    title: record.title || "猫猫判决记录",
    coffeeText: record.coffeeText || "当时没有留下详细陈述。",
    gameText: record.gameText || "当时没有留下详细陈述。",
    winner: record.winner === "game" ? "game" : "coffee",
    severity: severityMap[record.severity] ? record.severity : "low",
    verdict: record.verdict || "这条历史记录只有简要结果。",
    analysis: record.analysis || "这条历史记录暂时没有更详细的法官分析。",
    reason_summary: Array.isArray(record.reason_summary) ? record.reason_summary.slice(0, 3) : [],
    coffeeAdvice: record.coffeeAdvice || "",
    gameAdvice: record.gameAdvice || "",
    created_at: record.created_at || ""
  };
}

function getAllRecords() {
  return [...recordsCache].sort((a, b) => {
    if (a.date === b.date) {
      const aKey = a.created_at || a.id;
      const bKey = b.created_at || b.id;
      return bKey.localeCompare(aKey);
    }
    return b.date.localeCompare(a.date);
  });
}

function getAvailableDates() {
  return new Set(getAllRecords().map((record) => record.date));
}

function setVerdictLevel(levelKey, label = "等待开庭", targetEl = verdictLevelEl) {
  if (!severityMap[levelKey]) {
    targetEl.className = "verdict-level verdict-level-neutral";
    targetEl.textContent = label;
    return;
  }

  targetEl.className = `verdict-level verdict-level-${levelKey}`;
  targetEl.textContent = severityMap[levelKey];
}

function renderReasonSummary(reasons) {
  if (!Array.isArray(reasons) || reasons.length === 0) {
    reasonListEl.innerHTML = "";
    return;
  }

  reasonListEl.innerHTML = reasons
    .map((reason) => `<span class="reason-chip">${escapeHtml(reason)}</span>`)
    .join("");
}

function clearWinnerState() {
  Object.values(panelMeta).forEach(({ panel }) => {
    panel.classList.remove("is-winner", "bursting");
  });
}

function triggerCelebration(winnerKey) {
  const winnerPanel = panelMeta[winnerKey].panel;
  winnerPanel.classList.add("is-winner", "bursting");
  window.setTimeout(() => {
    winnerPanel.classList.remove("bursting");
  }, 950);
}

function adviceFallback(name) {
  return `${name}这边这一轮已经做得不错，小咪判官暂时没有额外补充。`;
}

function renderAdvice(result) {
  coffeeAdviceEl.textContent = result.coffeeAdvice || adviceFallback("咖啡猫猫");
  gameAdviceEl.textContent = result.gameAdvice || adviceFallback("游戏猫猫");
}

function renderVerdict(result) {
  const winnerName = panelMeta[result.winner].name;
  const winnerClass = winnerClassMap[result.winner];
  verdictEl.innerHTML = `
    <span class="winner-inline ${winnerClass}">${escapeHtml(winnerName)}</span>
    <span>${escapeHtml(result.verdict)}</span>
  `;
  analysisEl.textContent = result.analysis;
  renderReasonSummary(result.reason_summary);
  setVerdictLevel(result.severity);
  renderAdvice(result);
}

function setMaskCopy(panelKey, title, body) {
  const mask = panelMeta[panelKey].mask;
  mask.querySelector("p").textContent = title;
  mask.querySelector("span").textContent = body;
}

function setSelectedSide(side) {
  activeState.selectedSide = side;
  sideChoiceButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.sideChoice === side);
  });
}

function getRouteCase() {
  const params = new URLSearchParams(window.location.search);
  const code = normalizeCode(params.get("code") || "");
  const side = params.get("side");
  if (!code || (side !== "coffee" && side !== "game")) {
    return null;
  }
  return { code, side };
}

function updateUrl() {
  if (!activeState.joined || !activeState.code) {
    window.history.replaceState({}, "", "./");
    return;
  }

  const params = new URLSearchParams();
  params.set("code", activeState.code);
  params.set("side", activeState.side);
  window.history.replaceState({}, "", `?${params.toString()}`);
}

function syncEntryControls() {
  joinCaseBtn.disabled = activeState.isJoining;
  joinCaseBtn.textContent = activeState.isJoining ? "进入中..." : "进入案件";
}

function setSessionStatus(text = "") {
  if (!text) {
    sessionStatusTextEl.hidden = true;
    sessionStatusTextEl.textContent = "";
    return;
  }

  sessionStatusTextEl.hidden = false;
  sessionStatusTextEl.textContent = text;
}

function openCaseHelp() {
  caseHelpModalEl.hidden = false;
  caseHelpToggleBtn.setAttribute("aria-expanded", "true");
}

function closeCaseHelp() {
  caseHelpModalEl.hidden = true;
  caseHelpToggleBtn.setAttribute("aria-expanded", "false");
}

function syncJudgeButtons() {
  const snapshot = activeState.snapshot;
  const busy = activeState.isJudging || activeState.isArchiving || activeState.isSubmitting || activeState.isJoining;
  const canJudge = Boolean(snapshot && snapshot.allSubmitted && snapshot.status !== "archived");
  const canArchive = Boolean(snapshot && snapshot.status === "judged");

  courtTriggerBtn.disabled = busy || !canJudge;
  archiveCaseBtn.disabled = busy || !canArchive;
  courtTriggerBtn.textContent = activeState.isJudging
    ? "审判中"
    : snapshot && snapshot.status === "judged"
      ? "重新开庭"
      : "开庭";
  archiveCaseBtn.textContent = activeState.isArchiving ? "封存中..." : "本案封存";
}

function resetCourtCopy() {
  verdictMetaEl.textContent = "先在上面选好席位，再输入同一个数字案件码，进入同一场案子。";
  verdictEl.textContent = "当前还没进入任何案件。等你和另一边都带着同一个案件码进来之后，小咪判官再开始听案。";
  analysisEl.textContent = "目前法官还在安静舔毛。等双方都进入同一个案件并提交陈词之后，这里会显示猫猫怎么看待这场吵架。";
  renderReasonSummary([]);
  coffeeAdviceEl.textContent = "等真正开庭之后，这里会出现给这一边的建议。";
  gameAdviceEl.textContent = "等真正开庭之后，这里会出现给这一边的建议。";
  setVerdictLevel(null, "等待开庭");
}

function lockPanel(panelKey, title, body, note) {
  const meta = panelMeta[panelKey];
  meta.textarea.value = "";
  meta.textarea.setAttribute("readonly", "true");
  meta.sealButton.hidden = true;
  meta.editButton.hidden = true;
  meta.note.textContent = note;
  meta.mask.hidden = false;
  setMaskCopy(panelKey, title, body);
}

function renderOwnPanel(snapshot, panelKey) {
  const meta = panelMeta[panelKey];
  const submitted = snapshot.submitted[panelKey];
  const finished = snapshot.status === "judged" || snapshot.status === "archived";

  if (finished) {
    meta.note.textContent =
      snapshot.status === "archived"
        ? "这场案件已经封存，你这一边的陈词也随案归档了。"
        : "本轮已经宣判，你这一边的陈词已经进入判决。";
    meta.textarea.value = snapshot.ownText || "";
    meta.textarea.setAttribute("readonly", "true");
    meta.sealButton.hidden = true;
    meta.editButton.hidden = true;
    meta.mask.hidden = false;
    setMaskCopy(panelKey, snapshot.status === "archived" ? "本案已封存" : "已完成宣判", "这边的陈词已经不再开放修改。");
    return;
  }

  if (submitted && !activeState.isEditing) {
    meta.note.textContent = "你的陈词已经封存好了。正式开庭前，另一边还看不到这里的内容。";
    meta.textarea.value = snapshot.ownText || "";
    meta.textarea.setAttribute("readonly", "true");
    meta.sealButton.hidden = true;
    meta.editButton.hidden = false;
    meta.mask.hidden = false;
    setMaskCopy(panelKey, "已封存陈词", "喵，另一边暂时看不到这里的内容。");
    return;
  }

  meta.note.textContent = "现在轮到你发言。写清楚自己的想法，再点击“输入完成”封存。";
  meta.textarea.value = activeState.localDraft;
  meta.textarea.removeAttribute("readonly");
  meta.sealButton.hidden = false;
  meta.editButton.hidden = true;
  meta.mask.hidden = true;
}

function renderOtherPanel(snapshot, panelKey) {
  const meta = panelMeta[panelKey];
  const otherSubmitted = snapshot.submitted[panelKey];
  const canReveal = snapshot.status === "judged" || snapshot.status === "archived";

  meta.textarea.setAttribute("readonly", "true");
  meta.sealButton.hidden = true;
  meta.editButton.hidden = true;

  if (canReveal && snapshot.otherText) {
    meta.note.textContent =
      snapshot.status === "judged" || snapshot.status === "archived"
        ? "双方陈词都已公开，这一边的内容现在可以查看。"
        : "这边的内容现在可以查看。";
    meta.textarea.value = snapshot.otherText;
    meta.mask.hidden = true;
    return;
  }

  meta.textarea.value = "";
  meta.mask.hidden = false;

  if (otherSubmitted) {
    meta.note.textContent = "另一边已经写完并封存了，但在正式开庭宣判前，这里的内容仍然保密。";
    setMaskCopy(panelKey, "对方已封存", "等小咪判官正式开庭并宣判后，这里的内容才会公开。");
    return;
  }

  meta.note.textContent = "另一边还没用相同的案件码进来，或者还没开始写。";
  setMaskCopy(panelKey, "席位保密中", "等另一边输入相同案件码并提交后，这里才会有内容。");
}

function renderPanels() {
  clearWinnerState();

  if (!activeState.joined || !activeState.snapshot) {
    lockPanel("coffee", "等待案件码", "先在上面选好席位并输入同一个数字案件码。", "还没进入案件，先在上面输入案件码。");
    lockPanel("game", "等待案件码", "先在上面选好席位并输入同一个数字案件码。", "还没进入案件，先在上面输入案件码。");
    return;
  }

  const ownSide = activeState.side;
  const otherSide = ownSide === "coffee" ? "game" : "coffee";
  renderOwnPanel(activeState.snapshot, ownSide);
  renderOtherPanel(activeState.snapshot, otherSide);

  if (activeState.snapshot.status === "judged" || activeState.snapshot.status === "archived") {
    const winner = activeState.snapshot.result.winner;
    if (winner && panelMeta[winner]) {
      panelMeta[winner].panel.classList.add("is-winner");
    }
  }
}

function renderJudgeState() {
  clearWinnerState();

  if (!activeState.joined || !activeState.snapshot) {
    resetCourtCopy();
    syncJudgeButtons();
    return;
  }

  const snapshot = activeState.snapshot;

  if (snapshot.status === "judged" || snapshot.status === "archived") {
    verdictMetaEl.textContent =
      snapshot.status === "archived"
        ? `案件码 ${snapshot.code} 已经封存进历史记录。`
        : `案件码 ${snapshot.code} 的本轮审判已经完成。如果满意这份结果，就可以封存。`;
    renderVerdict(snapshot.result);
    if (snapshot.result.winner && panelMeta[snapshot.result.winner]) {
      panelMeta[snapshot.result.winner].panel.classList.add("is-winner");
    }
    syncJudgeButtons();
    return;
  }

  if (!snapshot.submitted.coffee || !snapshot.submitted.game) {
    verdictMetaEl.textContent = `当前案件码 ${snapshot.code} 还在等双方把陈词都交齐。`;
    verdictEl.textContent = "至少还有一边没有完成陈词封存。等双方都用同一个案件码提交之后，小咪判官才会开庭。";
    analysisEl.textContent = "法官现在只是在巡场，不会提前偏心。等两边都交卷后，它才会认真评理。";
    renderReasonSummary([]);
    coffeeAdviceEl.textContent = "等真正开庭之后，这里会出现给这一边的建议。";
    gameAdviceEl.textContent = "等真正开庭之后，这里会出现给这一边的建议。";
    setVerdictLevel(null, "待双方到齐");
    syncJudgeButtons();
    return;
  }

  verdictMetaEl.textContent = `案件码 ${snapshot.code} 的双方陈词都已封存，点击【开庭】即可开始审判。`;
  verdictEl.textContent = "双方陈词都已经齐了。现在只差你按一下【开庭】，小咪判官就会给出这一轮裁决。";
  analysisEl.textContent = "小咪判官正在来回踱步。它会综合双方观点，给出胜方、胜利程度和一段猫猫式分析。";
  renderReasonSummary([]);
  coffeeAdviceEl.textContent = "等真正开庭之后，这里会出现给这一边的建议。";
  gameAdviceEl.textContent = "等真正开庭之后，这里会出现给这一边的建议。";
  setVerdictLevel(null, "待宣判");
  syncJudgeButtons();
}

function renderSessionMeta() {
  if (!activeState.joined || !activeState.snapshot) {
    currentCaseBadgeEl.textContent = "还没进入案件";
    currentCaseBadgeEl.classList.remove("is-live");
    setSessionStatus("");
    return;
  }

  const sideName = panelMeta[activeState.side].name;
  const snapshot = activeState.snapshot;
  currentCaseBadgeEl.textContent = `案件码 ${snapshot.code} · ${sideName}`;
  currentCaseBadgeEl.classList.add("is-live");

  if (snapshot.status === "archived") {
    setSessionStatus("这场案件已经封存。如果还想再开一场新的，换一个数字案件码就好。");
    return;
  }

  if (snapshot.status === "judged") {
    setSessionStatus("这场案件已经宣判完成。你们现在可以看结果，也可以把它正式封存进历史记录。");
    return;
  }

  if (snapshot.submitted[activeState.side] && !snapshot.allSubmitted) {
    setSessionStatus("你这一边已经交卷了。现在只差另一边也输入相同案件码并提交。");
    return;
  }

  if (!snapshot.submitted[activeState.side]) {
    setSessionStatus("你已经进入这场案件了。现在轮到你在自己的席位上把想法写清楚。");
    return;
  }

  setSessionStatus("双方都已经提交完成。现在可以去请小咪判官开庭了。");
}

function renderActiveCase(triggerCelebrate = false) {
  renderSessionMeta();
  renderPanels();
  renderJudgeState();

  if (triggerCelebrate && activeState.snapshot && activeState.snapshot.result.winner) {
    clearWinnerState();
    triggerCelebration(activeState.snapshot.result.winner);
  }
}

function stopPolling() {
  if (activeState.pollTimer) {
    window.clearInterval(activeState.pollTimer);
    activeState.pollTimer = null;
  }
}

function startPolling() {
  stopPolling();

  if (!activeState.joined) {
    return;
  }

  activeState.pollTimer = window.setInterval(async () => {
    if (activeState.isJoining || activeState.isSubmitting || activeState.isJudging || activeState.isArchiving) {
      return;
    }

    try {
      const snapshot = await fetchJson(
        `/api/active-cases/${encodeURIComponent(activeState.code)}?side=${encodeURIComponent(activeState.side)}`
      );

      activeState.snapshot = snapshot;
      if (!activeState.isEditing || snapshot.submitted[activeState.side]) {
        activeState.localDraft = snapshot.ownText || "";
      }
      renderActiveCase();
    } catch (_error) {
      // Polling failures are ignored to avoid noisy UI flicker.
    }
  }, 4000);
}

function monthKey(date) {
  return `${date.getFullYear()}-${date.getMonth()}`;
}

function pickDateForVisibleMonth() {
  const availableDates = [...getAvailableDates()].sort().reverse();
  const currentMonthKey = monthKey(visibleMonth);

  if (selectedHistoryDate && monthKey(parseDateString(selectedHistoryDate)) === currentMonthKey) {
    return;
  }

  const firstMatch = availableDates.find((dateString) => monthKey(parseDateString(dateString)) === currentMonthKey);
  selectedHistoryDate = firstMatch || null;
}

function renderCalendar() {
  pickDateForVisibleMonth();

  const year = visibleMonth.getFullYear();
  const month = visibleMonth.getMonth();
  const firstDay = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const weekDay = (firstDay.getDay() + 6) % 7;
  const availableDates = getAvailableDates();

  calendarTitleEl.textContent = `${year} 年 ${String(month + 1).padStart(2, "0")} 月`;
  selectedDateLabelEl.textContent = selectedHistoryDate ? formatDisplayDate(selectedHistoryDate) : "暂无记录";
  dateGridEl.innerHTML = "";

  for (let i = 0; i < weekDay; i += 1) {
    const spacer = document.createElement("div");
    spacer.className = "calendar-spacer";
    dateGridEl.appendChild(spacer);
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const dateString = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const button = document.createElement("button");
    const hasRecord = availableDates.has(dateString);
    button.className = `calendar-day ${hasRecord ? "has-record" : "is-empty"}`;
    button.type = "button";
    button.disabled = !hasRecord;

    if (selectedHistoryDate === dateString) {
      button.classList.add("is-selected");
    }

    button.innerHTML = `<time datetime="${dateString}">${day}</time>`;

    if (hasRecord) {
      button.addEventListener("click", () => {
        selectedHistoryDate = dateString;
        renderCalendar();
        renderHistoryList();
        closeDatePicker();
      });
    }

    dateGridEl.appendChild(button);
  }
}

function renderHistoryList() {
  const records = getAllRecords().filter((record) => record.date === selectedHistoryDate);

  if (!selectedHistoryDate || records.length === 0) {
    historyListEl.innerHTML =
      '<div class="history-empty">这个日期没有吵架记录，灰掉的日期暂时都不可点击。</div>';
    return;
  }

  historyListEl.innerHTML = records
    .map((record) => {
      const winnerName = panelMeta[record.winner].name;
      return `
        <article class="history-item" data-record-id="${record.id}">
          <button class="history-delete" type="button" data-delete-id="${record.id}" aria-label="删除记录">
            ×
          </button>
          <time datetime="${record.date}">${escapeHtml(formatDisplayDate(record.date))}</time>
          <h3>${escapeHtml(record.title)}</h3>
          <p>${escapeHtml(winnerName)}获胜，${escapeHtml(severityMap[record.severity])}。</p>
        </article>
      `;
    })
    .join("");
}

function openDetailModal(recordId) {
  const record = getAllRecords().find((item) => item.id === recordId);

  if (!record) {
    return;
  }

  detailTitleEl.textContent = record.title;
  detailDateEl.textContent = formatDisplayDate(record.date);
  setVerdictLevel(record.severity, severityMap[record.severity], detailLevelEl);
  detailWinnerEl.textContent = panelMeta[record.winner].name;
  detailWinnerEl.className = `detail-winner ${record.winner}`;
  detailVerdictEl.textContent = record.verdict;
  detailAnalysisEl.textContent = record.analysis;
  detailCoffeeAdviceEl.textContent = record.coffeeAdvice || adviceFallback("咖啡猫猫");
  detailGameAdviceEl.textContent = record.gameAdvice || adviceFallback("游戏猫猫");
  detailCoffeeEl.textContent = record.coffeeText;
  detailGameEl.textContent = record.gameText;
  recordModalEl.hidden = false;
}

function openDatePicker() {
  isDatePickerOpen = true;
  datePickerPopoverEl.hidden = false;
}

function closeDatePicker() {
  isDatePickerOpen = false;
  datePickerPopoverEl.hidden = true;
}

function closeDetailModal() {
  recordModalEl.hidden = true;
}

function openDeleteConfirm(recordId) {
  pendingDeleteId = recordId;
  confirmModalEl.hidden = false;
}

function closeDeleteConfirm() {
  pendingDeleteId = null;
  confirmModalEl.hidden = true;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error || "请求失败，请稍后再试。");
  }

  return payload;
}

async function loadRecords() {
  const payload = await fetchJson("/api/records");
  recordsCache = Array.isArray(payload.records) ? payload.records.map(normalizeRecord) : [];
}

async function refreshRecordsAndRender(preferredDate = selectedHistoryDate) {
  await loadRecords();

  const availableDates = [...getAvailableDates()].sort().reverse();
  selectedHistoryDate = preferredDate && availableDates.includes(preferredDate) ? preferredDate : availableDates[0] || null;
  visibleMonth = selectedHistoryDate ? startOfMonth(parseDateString(selectedHistoryDate)) : startOfMonth(new Date());
  renderCalendar();
  renderHistoryList();
}

async function joinActiveCase(code) {
  const normalized = normalizeCode(code || caseCodeInputEl.value);
  if (normalized.length < 4) {
    setSessionStatus("案件码至少要 4 位数字。");
    caseCodeInputEl.focus();
    return;
  }

  activeState.isJoining = true;
  syncEntryControls();
  setSessionStatus("正在进入案件，请稍等。");

  try {
    const snapshot = await fetchJson("/api/active-cases/join", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        code: normalized,
        side: activeState.selectedSide
      })
    });

    activeState.code = snapshot.code;
    activeState.joined = true;
    activeState.side = snapshot.side;
    activeState.snapshot = snapshot;
    activeState.localDraft = snapshot.ownText || "";
    activeState.isEditing = !snapshot.submitted[activeState.side] && snapshot.status !== "judged" && snapshot.status !== "archived";
    caseCodeInputEl.value = snapshot.code;
    updateUrl();
    renderActiveCase();
    startPolling();
  } catch (error) {
    activeState.joined = false;
    activeState.snapshot = null;
    setSessionStatus(error.message || "进入案件失败，请稍后再试。");
    renderPanels();
    renderJudgeState();
  } finally {
    activeState.isJoining = false;
    syncEntryControls();
  }
}

async function deleteRecord(recordId) {
  await fetchJson(`/api/records/${encodeURIComponent(recordId)}`, {
    method: "DELETE"
  });

  await refreshRecordsAndRender(selectedHistoryDate);
}

async function sealOwnStatement(panelKey) {
  if (!activeState.joined || activeState.side !== panelKey || !activeState.snapshot) {
    setSessionStatus("先进入一个案件，再轮到你这一边发言。");
    return;
  }

  const content = panelMeta[panelKey].textarea.value.trim();
  if (!content) {
    panelMeta[panelKey].textarea.focus();
    return;
  }

  activeState.isSubmitting = true;
  syncEntryControls();
  syncJudgeButtons();

  try {
    const snapshot = await fetchJson(`/api/active-cases/${encodeURIComponent(activeState.code)}/submit`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        side: activeState.side,
        content
      })
    });

    activeState.snapshot = snapshot;
    activeState.localDraft = snapshot.ownText || "";
    activeState.isEditing = false;
    renderActiveCase();
  } catch (error) {
    setSessionStatus(error.message || "封存陈词失败，请稍后再试。");
  } finally {
    activeState.isSubmitting = false;
    syncEntryControls();
    syncJudgeButtons();
  }
}

function enableOwnEdit(panelKey) {
  if (!activeState.joined || activeState.side !== panelKey || !activeState.snapshot) {
    return;
  }

  if (activeState.snapshot.status === "judged" || activeState.snapshot.status === "archived") {
    return;
  }

  activeState.isEditing = true;
  activeState.localDraft = activeState.snapshot.ownText || "";
  renderPanels();
  panelMeta[panelKey].textarea.focus();
}

async function runJudgement() {
  if (!activeState.joined || !activeState.snapshot) {
    verdictMetaEl.textContent = "还没进入案件，暂时不能开庭。";
    verdictEl.textContent = "先在上面选好席位，再输入同一个数字案件码。";
    analysisEl.textContent = "只有两边都进入同一个案件并提交后，小咪判官才会开始听案。";
    setVerdictLevel(null, "尚未进入案件");
    return;
  }

  if (!activeState.snapshot.allSubmitted) {
    verdictMetaEl.textContent = "至少还有一边没交卷。";
    verdictEl.textContent = "双方都要先用同一个案件码提交陈词，才能开始审判。";
    analysisEl.textContent = "小咪判官现在先不偏心。等两边都交齐之后，它才会正式开庭。";
    setVerdictLevel(null, "尚未满足条件");
    renderReasonSummary([]);
    return;
  }

  activeState.isJudging = true;
  syncEntryControls();
  syncJudgeButtons();
  clearWinnerState();
  verdictMetaEl.textContent = `案件码 ${activeState.code} 正在开庭。`;
  verdictEl.textContent = "小咪判官正在认真翻阅两边陈述，努力做出一份尽量公平的本轮裁决...";
  analysisEl.textContent = "分析生成中，法官正在整理双方情绪、理由和关键分歧。";
  setVerdictLevel(null, "审判中");
  renderReasonSummary([]);

  try {
    const snapshot = await fetchJson(`/api/active-cases/${encodeURIComponent(activeState.code)}/judge`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        side: activeState.side
      })
    });

    activeState.snapshot = snapshot;
    activeState.localDraft = snapshot.ownText || "";
    activeState.isEditing = false;
    renderActiveCase(true);
  } catch (error) {
    verdictMetaEl.textContent = "这次小咪判官没能顺利开口。";
    verdictEl.textContent = error.message || "审判失败，请稍后再试。";
    analysisEl.textContent = "它不是偏心，是刚刚真的有点忙。等一小会儿重新开庭，通常就能恢复。";
    coffeeAdviceEl.textContent = "先别急着继续翻旧账，给小咪判官一点喘气时间。";
    gameAdviceEl.textContent = "这会儿最适合先停战三分钟，等法官重新上班。";
    setVerdictLevel(null, "审判失败");
    renderReasonSummary([]);
  } finally {
    activeState.isJudging = false;
    syncEntryControls();
    syncJudgeButtons();
  }
}

async function archiveCurrentCase() {
  if (!activeState.joined || !activeState.snapshot || activeState.snapshot.status !== "judged") {
    return;
  }

  activeState.isArchiving = true;
  syncEntryControls();
  syncJudgeButtons();

  try {
    const snapshot = await fetchJson(`/api/active-cases/${encodeURIComponent(activeState.code)}/archive`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        side: activeState.side
      })
    });

    activeState.snapshot = snapshot;
    await refreshRecordsAndRender(snapshot.date);
    renderActiveCase();
  } catch (error) {
    verdictMetaEl.textContent = "这次封存没有成功。";
    verdictEl.textContent = error.message || "封存失败，请稍后再试。";
    analysisEl.textContent = "请确认本地服务是否仍在运行，或者稍后再试一次。";
    setVerdictLevel(null, "封存失败");
  } finally {
    activeState.isArchiving = false;
    syncEntryControls();
    syncJudgeButtons();
  }
}

sideChoiceButtons.forEach((button) => {
  button.addEventListener("click", () => {
    setSelectedSide(button.dataset.sideChoice);
    if (activeState.joined && activeState.selectedSide !== activeState.side) {
      setSessionStatus(`席位已经切到${panelMeta[activeState.selectedSide].name}。再点一次“进入案件”，就会用当前案件码切到这一侧。`);
    }
  });
});

caseCodeInputEl.addEventListener("input", () => {
  caseCodeInputEl.value = normalizeCode(caseCodeInputEl.value);
});

joinCaseBtn.addEventListener("click", () => {
  joinActiveCase();
});

caseHelpToggleBtn.addEventListener("click", openCaseHelp);
caseHelpCloseBtn.addEventListener("click", closeCaseHelp);
caseHelpModalEl.addEventListener("click", (event) => {
  if (event.target === caseHelpModalEl) {
    closeCaseHelp();
  }
});

Object.keys(panelMeta).forEach((panelKey) => {
  const meta = panelMeta[panelKey];

  meta.sealButton.addEventListener("click", () => {
    sealOwnStatement(panelKey);
  });

  meta.editButton.addEventListener("click", () => {
    enableOwnEdit(panelKey);
  });

  meta.textarea.addEventListener("input", () => {
    if (activeState.joined && activeState.side === panelKey && activeState.isEditing) {
      activeState.localDraft = meta.textarea.value;
    }
  });
});

courtTriggerBtn.addEventListener("click", () => {
  runJudgement();
});

archiveCaseBtn.addEventListener("click", () => {
  archiveCurrentCase();
});

datePickerTriggerBtn.addEventListener("click", (event) => {
  event.stopPropagation();
  if (isDatePickerOpen) {
    closeDatePicker();
    return;
  }
  openDatePicker();
});

prevMonthBtn.addEventListener("click", () => {
  visibleMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() - 1, 1);
  renderCalendar();
  renderHistoryList();
});

nextMonthBtn.addEventListener("click", () => {
  visibleMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 1);
  renderCalendar();
  renderHistoryList();
});

historyListEl.addEventListener("click", (event) => {
  const deleteButton = event.target.closest("[data-delete-id]");

  if (deleteButton) {
    event.stopPropagation();
    openDeleteConfirm(deleteButton.dataset.deleteId);
    return;
  }

  const card = event.target.closest("[data-record-id]");
  if (card) {
    openDetailModal(card.dataset.recordId);
  }
});

detailCloseBtn.addEventListener("click", closeDetailModal);
recordModalEl.addEventListener("click", (event) => {
  if (event.target === recordModalEl) {
    closeDetailModal();
  }
});

confirmCancelBtn.addEventListener("click", closeDeleteConfirm);
confirmModalEl.addEventListener("click", (event) => {
  if (event.target === confirmModalEl) {
    closeDeleteConfirm();
  }
});

confirmDeleteBtn.addEventListener("click", async () => {
  if (pendingDeleteId) {
    try {
      await deleteRecord(pendingDeleteId);
    } catch (error) {
      setSessionStatus(error.message || "删除失败，请稍后再试。");
    }
  }
  closeDeleteConfirm();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeDetailModal();
    closeDeleteConfirm();
    closeDatePicker();
    closeCaseHelp();
  }
});

document.addEventListener("click", (event) => {
  if (
    isDatePickerOpen &&
    !datePickerPopoverEl.contains(event.target) &&
    !datePickerTriggerBtn.contains(event.target)
  ) {
    closeDatePicker();
  }
});

async function initializeApp() {
  resetCourtCopy();
  renderPanels();
  syncEntryControls();
  syncJudgeButtons();

  try {
    await refreshRecordsAndRender();
  } catch (error) {
    selectedHistoryDate = null;
    visibleMonth = startOfMonth(new Date());
    renderCalendar();
    renderHistoryList();
    setSessionStatus(error.message || "共享记录加载失败，请稍后再试。");
  }

  const routeCase = getRouteCase();
  if (routeCase) {
    setSelectedSide(routeCase.side);
    caseCodeInputEl.value = routeCase.code;
    await joinActiveCase(routeCase.code);
    return;
  }

  setSelectedSide("coffee");
}

initializeApp();
