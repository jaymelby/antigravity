// Antigravity Mission Control - Client Script
const vscode = acquireVsCodeApi();

// State
let currentTab = "task-tab";
let currentColor = "#ffffff";
let currentTool = "pen";
let undoStack = [];
let canvasHeight = 240;
let currentStreamingMsg = null;
let isPlanViewExpanded = false;
let isWtViewExpanded = false;

// Core Elements
const tabs = document.querySelectorAll(".nav-tab");
const panes = document.querySelectorAll(".tab-pane");
const stateBadge = document.getElementById("agent-state-badge");
const goalText = document.getElementById("task-goal-text");
const subtaskList = document.getElementById("subtask-list");
const logStream = document.getElementById("log-stream");
const chatStream = document.getElementById("chat-stream");

// Live Thought Callout (on Task Tab)
const liveThoughtCallout = document.getElementById("live-thought-callout");
const activeThoughtSummary = document.getElementById("active-thought-summary");
const btnJumpScratchpad = document.getElementById("btn-jump-to-scratchpad");

// Settings Elements
const btnOpenSettings = document.getElementById("btn-open-settings");
const btnCloseSettings = document.getElementById("btn-close-settings");
const settingsModal = document.getElementById("settings-modal");
const settingsBackdrop = document.getElementById("settings-backdrop");
const btnSaveSettings = document.getElementById("btn-save-settings");
const settingCodeSnippets = document.getElementById("setting-code-snippets");
const settingMaxGrep = document.getElementById("setting-max-grep");
const settingPreferredModel = document.getElementById("setting-preferred-model");

// Mission Log Export/Import Elements
const btnExportLog = document.getElementById("btn-export-log");
const btnImportLog = document.getElementById("btn-import-log");
const historyContextStrip = document.getElementById("history-context-strip");
const historyChipName = document.getElementById("history-chip-name");
const btnClearHistory = document.getElementById("btn-clear-history");

// Telemetry HUD Elements
const telemetryHud = document.getElementById("telemetry-hud");
const telemetryPopover = document.getElementById("telemetry-popover");
const btnCloseTelemetry = document.getElementById("btn-close-telemetry");
const hudModelName = document.getElementById("hud-model-name");
const hudAicValue = document.getElementById("hud-aic-value");

// Telemetry Popover Elements
const telemetryModelName = document.getElementById("telemetry-model-name");
const telemetryPricingLabel = document.getElementById("telemetry-pricing-label");
const telemetryLastIn = document.getElementById("telemetry-last-in");
const telemetryLastOut = document.getElementById("telemetry-last-out");
const telemetryLastCost = document.getElementById("telemetry-last-cost");
const telemetryTotalTokens = document.getElementById("telemetry-total-tokens");
const telemetryTotalAic = document.getElementById("telemetry-total-aic");
const telemetryTotalUsd = document.getElementById("telemetry-total-usd");
const btnTelemetrySwitchModel = document.getElementById("btn-telemetry-switch-model");

// Plan Elements
const planTitle = document.getElementById("plan-title");
const planSummary = document.getElementById("plan-summary");
const reviewSection = document.getElementById("user-review-callout") || document.querySelector(".user-review-card");
const reviewItems = document.getElementById("plan-review-list") || document.getElementById("review-items");
const planMarkdownView = document.getElementById("plan-rendered-markdown");
const feedbackDrawer = document.getElementById("feedback-drawer");
const feedbackInput = document.getElementById("feedback-input");

// Walkthrough Elements
const walkthroughTitle = document.getElementById("walkthrough-title");
const walkthroughSummary = document.getElementById("walkthrough-summary");
const walkthroughBadge = document.getElementById("walkthrough-badge");
const btnRegenerateWalkthrough = document.getElementById("btn-regenerate-walkthrough");
const walkthroughMarkdownView = document.getElementById("walkthrough-rendered-markdown");

// Scratchpad & Chain of Thought Elements
const thoughtStatusBadge = document.getElementById("thought-status-badge");
const cotContainer = document.getElementById("chain-of-thought-container");
const commentsStream = document.getElementById("running-comments-stream");
const commentsCountBadge = document.getElementById("comments-count-badge");
const notesInput = document.getElementById("scratchpad-notes-input");
const btnCopyThoughts = document.getElementById("btn-copy-thoughts");
const btnClearScratchpad = document.getElementById("btn-clear-scratchpad");
const btnOpenRawScratchpad = document.getElementById("btn-open-raw-scratchpad");

// Canvas Elements (Optional Whiteboard)
const canvas = document.getElementById("scratchpad-canvas");
const ctx = canvas ? canvas.getContext("2d") : null;

// Docked Prompt Elements
const promptInput = document.getElementById("prompt-input");
const btnSendPrompt = document.getElementById("btn-send-prompt");
const btnAttachFile = document.getElementById("btn-attach-file");
const attachedChipsContainer = document.getElementById("attached-chips-container");
const promptModelSelect = document.getElementById("prompt-model-select");
const btnQuickModelChange = document.getElementById("btn-quick-model-change");
const dockModelName = document.getElementById("dock-model-name");

// Attached Files State
let attachedFiles = [];

function renderAttachedFiles() {
  if (!attachedChipsContainer) return;
  attachedChipsContainer.innerHTML = attachedFiles.map((f, idx) => `
    <div class="file-context-chip" title="${escapeHtml(f.fsPath)}">
      <span>📄</span>
      <span class="chip-name">${escapeHtml(f.fileName)}</span>
      <button type="button" class="chip-remove-btn" onclick="removeAttachedFile(${idx})" title="Remove file from context">✕</button>
    </div>
  `).join("");
}

window.removeAttachedFile = function(index) {
  attachedFiles.splice(index, 1);
  renderAttachedFiles();
};

if (btnAttachFile) {
  btnAttachFile.addEventListener("click", () => {
    vscode.postMessage({ type: "PICK_FILE_TO_ATTACH" });
  });
}

if (promptModelSelect) {
  promptModelSelect.addEventListener("change", () => {
    vscode.postMessage({
      type: "SET_MODEL",
      payload: { modelId: promptModelSelect.value }
    });
  });
}

if (btnQuickModelChange) {
  btnQuickModelChange.addEventListener("click", () => {
    vscode.postMessage({ type: "PROMPT_SELECT_MODEL" });
  });
}

if (btnTelemetrySwitchModel) {
  btnTelemetrySwitchModel.addEventListener("click", () => {
    vscode.postMessage({ type: "PROMPT_SELECT_MODEL" });
    if (telemetryPopover) telemetryPopover.classList.add("hidden");
  });
}

// Drag & Drop Files Support (from VS Code Explorer or OS Desktop)
const dropOverlay = document.getElementById("drop-overlay");
let dragCounter = 0;

function handleDragEnter(e) {
  e.preventDefault();
  dragCounter++;
  if (dropOverlay) dropOverlay.classList.remove("hidden");
}

function handleDragOver(e) {
  e.preventDefault();
  if (e.dataTransfer) {
    e.dataTransfer.dropEffect = "copy";
  }
}

function handleDragLeave(e) {
  e.preventDefault();
  dragCounter--;
  if (dragCounter <= 0) {
    dragCounter = 0;
    if (dropOverlay) dropOverlay.classList.add("hidden");
  }
}

function handleDrop(e) {
  e.preventDefault();
  e.stopPropagation();
  dragCounter = 0;
  if (dropOverlay) dropOverlay.classList.add("hidden");

  const droppedPaths = [];

  if (e.dataTransfer) {
    // 1. VS Code Explorer text/uri-list
    const uriList = e.dataTransfer.getData("text/uri-list");
    if (uriList) {
      const lines = uriList.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith("#"));
      droppedPaths.push(...lines);
    }

    // 2. dataTransfer.files (from Desktop or Electron)
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      for (let i = 0; i < e.dataTransfer.files.length; i++) {
        const f = e.dataTransfer.files[i];
        if (f.path && !droppedPaths.includes(f.path)) {
          droppedPaths.push(f.path);
        } else if (f.name && !droppedPaths.includes(f.name)) {
          droppedPaths.push(f.name);
        }
      }
    }

    // 3. text/plain fallback
    const textPlain = e.dataTransfer.getData("text/plain");
    if (textPlain && !droppedPaths.includes(textPlain)) {
      if (textPlain.startsWith("file://") || textPlain.includes("/") || textPlain.includes("\\")) {
        droppedPaths.push(textPlain);
      }
    }
  }

  if (droppedPaths.length > 0) {
    vscode.postMessage({
      type: "FILES_DROPPED",
      payload: { paths: droppedPaths }
    });
  }
}

document.addEventListener("dragenter", handleDragEnter, true);
document.addEventListener("dragover", handleDragOver, true);
document.addEventListener("dragleave", handleDragLeave, true);
document.addEventListener("drop", handleDrop, true);

window.addEventListener("dragenter", handleDragEnter);
window.addEventListener("dragover", handleDragOver);
window.addEventListener("dragleave", handleDragLeave);
window.addEventListener("drop", handleDrop);

// ==========================================
// 1. Tab Navigation
// ==========================================
function switchTab(targetId) {
  currentTab = targetId;
  tabs.forEach(t => t.classList.toggle("active", t.dataset.tab === targetId));
  panes.forEach(p => p.classList.toggle("active", p.id === targetId));

  if (targetId === "scratchpad-tab" && canvas) {
    resizeCanvas(canvasHeight);
  }
}

tabs.forEach(tab => {
  tab.addEventListener("click", () => switchTab(tab.dataset.tab));
});

if (btnJumpScratchpad) {
  btnJumpScratchpad.addEventListener("click", () => {
    switchTab("scratchpad-tab");
  });
}

// ==========================================
// 2. Collapsible Sections Accordion
// ==========================================
document.querySelectorAll(".collapsible-header").forEach(header => {
  header.addEventListener("click", (e) => {
    if (e.target.closest("button") || e.target.closest("textarea")) return;

    const targetId = header.dataset.target;
    if (!targetId) return;

    const body = document.getElementById(targetId);
    const chevron = header.querySelector(".chevron");

    if (body) {
      body.classList.toggle("collapsed");
      body.classList.toggle("hidden");
    }
    if (chevron) {
      chevron.classList.toggle("collapsed");
    }
  });
});

// Expand / Compact View for Full Plan Document
const btnExpandPlan = document.getElementById("btn-expand-plan-view");
if (btnExpandPlan) {
  btnExpandPlan.addEventListener("click", () => {
    isPlanViewExpanded = !isPlanViewExpanded;
    planMarkdownView.classList.toggle("expanded-view", isPlanViewExpanded);
    btnExpandPlan.textContent = isPlanViewExpanded ? "⤡ Compact View" : "⤢ Expand View";
  });
}

// Expand / Compact View for Walkthrough Document
const btnExpandWt = document.getElementById("btn-expand-wt-view");
if (btnExpandWt) {
  btnExpandWt.addEventListener("click", () => {
    isWtViewExpanded = !isWtViewExpanded;
    walkthroughMarkdownView.classList.toggle("expanded-view", isWtViewExpanded);
    btnExpandWt.textContent = isWtViewExpanded ? "⤡ Compact View" : "⤢ Expand View";
  });
}

// Toggle All Sections in Plan Tab
const btnToggleAllPlan = document.getElementById("btn-toggle-all-sections");
let planAllCollapsed = false;
if (btnToggleAllPlan) {
  btnToggleAllPlan.addEventListener("click", () => {
    planAllCollapsed = !planAllCollapsed;
    const planPane = document.getElementById("plan-tab");
    planPane.querySelectorAll(".card-body").forEach(b => b.classList.toggle("collapsed", planAllCollapsed));
    planPane.querySelectorAll(".chevron").forEach(c => c.classList.toggle("collapsed", planAllCollapsed));
    btnToggleAllPlan.textContent = planAllCollapsed ? "Expand All" : "Collapse All";
  });
}

// Toggle All Sections in Walkthrough Tab
const btnToggleAllWt = document.getElementById("btn-toggle-all-walkthrough");
let wtAllCollapsed = false;
if (btnToggleAllWt) {
  btnToggleAllWt.addEventListener("click", () => {
    wtAllCollapsed = !wtAllCollapsed;
    const wtPane = document.getElementById("walkthrough-tab");
    wtPane.querySelectorAll(".card-body").forEach(b => b.classList.toggle("collapsed", wtAllCollapsed));
    wtPane.querySelectorAll(".chevron").forEach(c => c.classList.toggle("collapsed", wtAllCollapsed));
    btnToggleAllWt.textContent = wtAllCollapsed ? "Expand All" : "Collapse All";
  });
}

// Toggle Thought Step Body
window.toggleThoughtStep = function(stepId) {
  const body = document.getElementById(`step-body-${stepId}`);
  if (body) {
    body.classList.toggle("collapsed");
  }
};

// ==========================================
// 3. Docked Prompt & Action Pills (No Top Bar!)
// ==========================================
function sendPrompt() {
  const text = promptInput.value.trim();
  if (!text) return;

  const currentAttached = [...attachedFiles];
  let attachedHint = "";
  if (currentAttached.length > 0) {
    attachedHint = `\n\n*(📎 Attached: ${currentAttached.map(f => `\`${f.fileName}\``).join(", ")})*`;
  }

  appendChatMessage("user", text + attachedHint);
  promptInput.value = "";
  promptInput.style.height = "auto";

  if (text === "/execute") {
    vscode.postMessage({ type: "APPROVE_PLAN" });
    return;
  }
  if (text === "/scratch") {
    switchTab("scratchpad-tab");
    return;
  }
  if (text === "/walkthrough") {
    vscode.postMessage({ type: "GENERATE_WALKTHROUGH" });
    return;
  }

  vscode.postMessage({ 
    type: "SEND_PROMPT", 
    payload: { 
      prompt: text,
      attachedFiles: currentAttached,
    } 
  });
}

promptInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendPrompt();
  }
});

promptInput.addEventListener("keyup", (e) => {
  if (e.key === "@") {
    vscode.postMessage({ type: "PICK_FILE_TO_ATTACH" });
  }
});

btnSendPrompt.addEventListener("click", sendPrompt);

promptInput.addEventListener("input", () => {
  promptInput.style.height = "auto";
  promptInput.style.height = Math.min(promptInput.scrollHeight, 100) + "px";
});

document.querySelectorAll(".pill-btn").forEach(pill => {
  pill.addEventListener("click", () => {
    const cmd = pill.dataset.cmd;
    if (cmd === "/plan") {
      promptInput.value = "/plan ";
      promptInput.focus();
    } else if (cmd === "/execute") {
      vscode.postMessage({ type: "APPROVE_PLAN" });
    } else if (cmd === "/walkthrough") {
      vscode.postMessage({ type: "GENERATE_WALKTHROUGH" });
    } else if (cmd === "/scratch") {
      switchTab("scratchpad-tab");
    }
  });
});

// Reset Mission
const btnResetMission = document.getElementById("btn-reset-mission");
if (btnResetMission) {
  btnResetMission.addEventListener("click", () => {
    attachedFiles = [];
    renderAttachedFiles();
    chatStream.innerHTML = `
      <div class="chat-msg system-msg">
        <span class="msg-icon">🚀</span>
        <div class="msg-content">Mission reset. All plans, walkthroughs, and attached files cleared. Standing by for fresh instructions!</div>
      </div>
    `;
    vscode.postMessage({ type: "RESET_MISSION" });
  });
}

// Chat Messages
function appendChatMessage(role, text) {
  const msg = document.createElement("div");
  msg.className = `chat-msg ${role}-msg`;
  const icon = role === "user" ? "👤" : role === "agent" ? "🚀" : "ℹ️";

  msg.innerHTML = `
    <span class="msg-icon">${icon}</span>
    <div class="msg-content">${renderMarkdown(text)}</div>
  `;
  chatStream.appendChild(msg);
  chatStream.scrollTop = chatStream.scrollHeight;
  return msg;
}

// In-Panel Feedback Drawer
const btnOpenFeedback = document.getElementById("btn-open-feedback-drawer") || document.getElementById("btn-toggle-feedback");
if (btnOpenFeedback) {
  btnOpenFeedback.addEventListener("click", () => {
    feedbackDrawer.classList.remove("hidden");
    feedbackInput.focus();
  });
}

const btnCloseFeedback = document.getElementById("btn-close-feedback-drawer") || document.getElementById("btn-close-drawer");
if (btnCloseFeedback) {
  btnCloseFeedback.addEventListener("click", () => {
    feedbackDrawer.classList.add("hidden");
  });
}

const btnCancelFeedback = document.getElementById("btn-cancel-feedback");
if (btnCancelFeedback) {
  btnCancelFeedback.addEventListener("click", () => {
    feedbackDrawer.classList.add("hidden");
  });
}

const btnSubmitFeedback = document.getElementById("btn-submit-feedback");
if (btnSubmitFeedback) {
  btnSubmitFeedback.addEventListener("click", () => {
    const feedback = feedbackInput.value.trim();
    if (feedback) {
      appendChatMessage("user", `Requested Changes: ${feedback}`);
      vscode.postMessage({ type: "SUBMIT_FEEDBACK", payload: { feedback } });
      feedbackInput.value = "";
      feedbackDrawer.classList.add("hidden");
    }
  });
}

// ==========================================
// 4. Scratchpad Actions & Toolbar
// ==========================================
if (btnCopyThoughts) {
  btnCopyThoughts.addEventListener("click", () => {
    vscode.postMessage({ type: "COPY_THOUGHTS" });
  });
}

if (btnClearScratchpad) {
  btnClearScratchpad.addEventListener("click", () => {
    vscode.postMessage({ type: "CLEAR_SCRATCHPAD" });
  });
}

if (btnOpenRawScratchpad) {
  btnOpenRawScratchpad.addEventListener("click", () => {
    vscode.postMessage({ type: "OPEN_RAW_SCRATCHPAD" });
  });
}

let notesTimer;
if (notesInput) {
  notesInput.addEventListener("input", () => {
    clearTimeout(notesTimer);
    notesTimer = setTimeout(saveScratchpadState, 1000);
  });
}

const btnSaveNotes = document.getElementById("btn-save-notes");
if (btnSaveNotes) {
  btnSaveNotes.addEventListener("click", saveScratchpadState);
}

function saveScratchpadState() {
  vscode.postMessage({
    type: "SAVE_SCRATCHPAD",
    payload: {
      notesMarkdown: notesInput ? notesInput.value : "",
      drawingDataUrl: canvas ? canvas.toDataURL() : "",
      canvasHeight,
      updatedAt: Date.now(),
    }
  });
}

// ==========================================
// 5. Whiteboard Canvas (Optional Sub-Drawer)
// ==========================================
let isDrawing = false;
let lastX = 0;
let lastY = 0;

function initCanvas() {
  if (!canvas || !ctx) return;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width || 600;
  canvas.height = canvasHeight;

  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  saveUndoState();
}

function saveUndoState() {
  if (!ctx || !canvas) return;
  if (undoStack.length >= 20) undoStack.shift();
  undoStack.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
}

function resizeCanvas(newHeight) {
  if (!canvas || !ctx) return;
  const clamped = Math.max(160, Math.min(600, newHeight));
  canvasHeight = clamped;

  const temp = document.createElement("canvas");
  temp.width = canvas.width;
  temp.height = canvas.height;
  const tempCtx = temp.getContext("2d");
  tempCtx.drawImage(canvas, 0, 0);

  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width || 600;
  canvas.height = clamped;
  canvas.style.height = clamped + "px";

  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.drawImage(temp, 0, 0);
}

function startDrawing(e) {
  if (!ctx || !canvas) return;
  isDrawing = true;
  const rect = canvas.getBoundingClientRect();
  lastX = (e.clientX || e.touches?.[0]?.clientX) - rect.left;
  lastY = (e.clientY || e.touches?.[0]?.clientY) - rect.top;
}

function draw(e) {
  if (!isDrawing || !ctx || !canvas) return;
  const rect = canvas.getBoundingClientRect();
  const currentX = (e.clientX || e.touches?.[0]?.clientX) - rect.left;
  const currentY = (e.clientY || e.touches?.[0]?.clientY) - rect.top;

  ctx.beginPath();
  ctx.moveTo(lastX, lastY);
  ctx.lineTo(currentX, currentY);

  if (currentTool === "eraser") {
    ctx.globalCompositeOperation = "destination-out";
    ctx.lineWidth = 20;
  } else {
    ctx.globalCompositeOperation = "source-over";
    ctx.strokeStyle = currentColor;
    ctx.lineWidth = 3;
  }

  ctx.stroke();
  lastX = currentX;
  lastY = currentY;
}

function stopDrawing() {
  if (isDrawing) {
    isDrawing = false;
    saveUndoState();
    saveScratchpadState();
  }
}

if (canvas) {
  canvas.addEventListener("mousedown", startDrawing);
  canvas.addEventListener("mousemove", draw);
  canvas.addEventListener("mouseup", stopDrawing);
  canvas.addEventListener("mouseleave", stopDrawing);

  canvas.addEventListener("touchstart", (e) => { e.preventDefault(); startDrawing(e); }, { passive: false });
  canvas.addEventListener("touchmove", (e) => { e.preventDefault(); draw(e); }, { passive: false });
  canvas.addEventListener("touchend", stopDrawing);
}

document.querySelectorAll(".color-swatch").forEach(swatch => {
  swatch.addEventListener("click", () => {
    document.querySelectorAll(".color-swatch").forEach(s => s.classList.remove("active"));
    swatch.classList.add("active");
    currentColor = swatch.dataset.color;
    currentTool = "pen";
    document.getElementById("tool-pen")?.classList.add("active");
    document.getElementById("tool-eraser")?.classList.remove("active");
  });
});

document.getElementById("tool-pen")?.addEventListener("click", () => {
  currentTool = "pen";
  document.getElementById("tool-pen")?.classList.add("active");
  document.getElementById("tool-eraser")?.classList.remove("active");
});

document.getElementById("tool-eraser")?.addEventListener("click", () => {
  currentTool = "eraser";
  document.getElementById("tool-eraser")?.classList.add("active");
  document.getElementById("tool-pen")?.classList.remove("active");
});

document.getElementById("tool-undo")?.addEventListener("click", () => {
  if (!ctx || !canvas) return;
  if (undoStack.length > 1) {
    undoStack.pop();
    const prev = undoStack[undoStack.length - 1];
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.putImageData(prev, 0, 0);
    saveScratchpadState();
  }
});

document.getElementById("tool-clear")?.addEventListener("click", () => {
  if (!ctx || !canvas) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  saveUndoState();
  saveScratchpadState();
});

// ==========================================
// 6. Action Button Listeners
// ==========================================
document.getElementById("btn-approve-plan")?.addEventListener("click", () => {
  vscode.postMessage({ type: "APPROVE_PLAN" });
});
document.getElementById("btn-open-raw-plan")?.addEventListener("click", () => {
  vscode.postMessage({ type: "OPEN_RAW_PLAN" });
});
document.getElementById("btn-open-raw-walkthrough")?.addEventListener("click", () => {
  vscode.postMessage({ type: "OPEN_RAW_WALKTHROUGH" });
});
btnRegenerateWalkthrough?.addEventListener("click", () => {
  vscode.postMessage({ type: "GENERATE_WALKTHROUGH" });
});
document.getElementById("btn-clear-logs")?.addEventListener("click", () => {
  logStream.innerHTML = "";
});
document.getElementById("btn-clear-chat")?.addEventListener("click", () => {
  chatStream.innerHTML = `
    <div class="chat-msg system-msg">
      <span class="msg-icon">🚀</span>
      <div class="msg-content">Conversation cleared. Standing by for instructions.</div>
    </div>
  `;
});
document.getElementById("btn-refresh-task")?.addEventListener("click", () => {
  vscode.postMessage({ type: "READY" });
});

// Rollback Listeners
const rollbackButtons = [
  document.getElementById("btn-header-rollback"),
  document.getElementById("btn-plan-rollback"),
  document.getElementById("btn-walkthrough-rollback")
];

rollbackButtons.forEach(btn => {
  btn?.addEventListener("click", () => {
    vscode.postMessage({ type: "ROLLBACK_MISSION" });
  });
});

// Telemetry HUD Click Listeners
if (telemetryHud && telemetryPopover) {
  telemetryHud.addEventListener("click", (e) => {
    e.stopPropagation();
    telemetryPopover.classList.toggle("hidden");
  });
}
if (btnCloseTelemetry && telemetryPopover) {
  btnCloseTelemetry.addEventListener("click", () => {
    telemetryPopover.classList.add("hidden");
  });
}
document.addEventListener("click", (e) => {
  if (telemetryPopover && !telemetryPopover.classList.contains("hidden")) {
    if (!telemetryPopover.contains(e.target) && !telemetryHud.contains(e.target)) {
      telemetryPopover.classList.add("hidden");
    }
  }
});

// Mission Log Export/Import Listeners
if (btnExportLog) {
  btnExportLog.addEventListener("click", () => {
    vscode.postMessage({ type: "EXPORT_MISSION_LOG" });
  });
}

if (btnImportLog) {
  btnImportLog.addEventListener("click", () => {
    vscode.postMessage({ type: "IMPORT_MISSION_LOG" });
  });
}

if (btnClearHistory) {
  btnClearHistory.addEventListener("click", () => {
    vscode.postMessage({ type: "CLEAR_HISTORICAL_CONTEXT" });
  });
}

// Settings UI Listeners
if (btnOpenSettings) {
  btnOpenSettings.addEventListener("click", () => {
    vscode.postMessage({ type: "GET_SETTINGS" });
    if (settingsModal) settingsModal.classList.remove("hidden");
  });
}
if (btnCloseSettings) {
  btnCloseSettings.addEventListener("click", () => {
    if (settingsModal) settingsModal.classList.add("hidden");
  });
}
if (settingsBackdrop) {
  settingsBackdrop.addEventListener("click", () => {
    if (settingsModal) settingsModal.classList.add("hidden");
  });
}
if (btnSaveSettings) {
  btnSaveSettings.addEventListener("click", () => {
    const includeCodeSnippets = settingCodeSnippets ? settingCodeSnippets.checked : false;
    const maxGrepFiles = settingMaxGrep ? parseInt(settingMaxGrep.value, 10) || 5 : 5;
    const preferredModel = settingPreferredModel ? settingPreferredModel.value : "auto";
    vscode.postMessage({
      type: "SAVE_SETTINGS",
      payload: { includeCodeSnippets, maxGrepFiles, preferredModel }
    });
    if (settingsModal) settingsModal.classList.add("hidden");
  });
}

// ==========================================
// 7. Data Renderers
// ==========================================
function renderPlan(plan) {
  if (!plan || !plan.exists) {
    planTitle.textContent = "No Active Implementation Plan";
    planSummary.textContent = "Type /plan <goal> in the bottom prompt bar to generate a plan.";
    if (reviewSection) reviewSection.classList.add("hidden");
    if (planMarkdownView) planMarkdownView.innerHTML = `<p class="empty-hint">No plan loaded. Send a prompt to create an implementation plan.</p>`;
    return;
  }

  planTitle.textContent = plan.title || "Implementation Plan";
  planSummary.textContent = plan.summary || "Proposed architectural modifications.";

  if (plan.userReviewRequired && plan.userReviewRequired.length > 0) {
    if (reviewSection) reviewSection.classList.remove("hidden");
    if (reviewItems) {
      reviewItems.innerHTML = plan.userReviewRequired
        .map(item => `<li>⚠️ ${escapeHtml(item)}</li>`)
        .join("");
    }
  } else {
    if (reviewSection) reviewSection.classList.add("hidden");
  }

  if (planMarkdownView) {
    planMarkdownView.innerHTML = renderMarkdown(plan.rawContent);
  }
}

function renderWalkthrough(wt) {
  if (!wt || !wt.exists) {
    walkthroughTitle.textContent = "No Walkthrough Generated";
    walkthroughSummary.textContent = "Execute an approved plan or run /walkthrough to generate verification results.";
    if (walkthroughBadge) walkthroughBadge.classList.add("hidden");
    if (walkthroughMarkdownView) {
      walkthroughMarkdownView.innerHTML = `<p class="empty-hint">No walkthrough loaded. Execute an approved plan or run /walkthrough to generate a verification report.</p>`;
    }
    return;
  }

  walkthroughTitle.textContent = wt.title || "Walkthrough & Verification";
  walkthroughSummary.textContent = wt.summary || "Post-execution verification debrief.";
  if (walkthroughBadge) walkthroughBadge.classList.remove("hidden");

  if (walkthroughMarkdownView) {
    walkthroughMarkdownView.innerHTML = renderMarkdown(wt.rawContent);
  }
}

function renderTaskState(task) {
  if (!task) return;

  stateBadge.className = "state-badge";
  switch (task.state) {
    case "IDLE": stateBadge.classList.add("state-idle"); stateBadge.textContent = "IDLE"; break;
    case "PLANNING": stateBadge.classList.add("state-planning"); stateBadge.textContent = "PLANNING"; break;
    case "WAITING_APPROVAL": stateBadge.classList.add("state-waiting"); stateBadge.textContent = "REVIEW REQUIRED"; break;
    case "EXECUTING": stateBadge.classList.add("state-executing"); stateBadge.textContent = "EXECUTING"; break;
    case "COMPLETED": stateBadge.classList.add("state-completed"); stateBadge.textContent = "DONE"; break;
    default: stateBadge.classList.add("state-idle"); stateBadge.textContent = task.state;
  }

  goalText.textContent = task.goal || "Ready for next objective.";

  if (task.subtasks) {
    subtaskList.innerHTML = task.subtasks.map(s => `
      <li class="subtask-item ${s.done ? "done" : ""}">
        <span>${s.done ? "✅" : "⏳"}</span>
        <span>${escapeHtml(s.title)}</span>
      </li>
    `).join("");
  }

  if (task.logs) {
    logStream.innerHTML = task.logs.map(log => `
      <div class="log-line ${log.type}">
        <span style="opacity: 0.6;">[${escapeHtml(log.timestamp)}]</span>
        <span>${escapeHtml(log.message)}</span>
      </div>
    `).join("");
    logStream.scrollTop = logStream.scrollHeight;
  }
}

// ==========================================
// 8. Scratchpad & Chain of Thought Renderer
// ==========================================
function renderScratchpad(data) {
  if (!data) return;

  // 1. Thought Status Badge & Live Callout Banner
  const isThinking = !!data.activeThought || data.chainOfThought?.some(s => s.status === "thinking");

  if (thoughtStatusBadge) {
    thoughtStatusBadge.className = "thought-badge " + (isThinking ? "thinking" : "idle");
    thoughtStatusBadge.textContent = isThinking ? "Thinking..." : "Idle";
  }

  if (liveThoughtCallout) {
    if (isThinking && data.activeThought) {
      liveThoughtCallout.classList.remove("hidden");
      if (activeThoughtSummary) {
        activeThoughtSummary.textContent = data.activeThought;
      }
    } else {
      liveThoughtCallout.classList.add("hidden");
    }
  }

  // 2. Chain of Thought Steps
  if (cotContainer) {
    if (!data.chainOfThought || data.chainOfThought.length === 0) {
      cotContainer.innerHTML = `<div class="empty-hint">No reasoning traces recorded yet. Start a mission or plan to stream thoughts.</div>`;
    } else {
      cotContainer.innerHTML = data.chainOfThought.map((step, idx) => {
        const isStepThinking = step.status === "thinking";
        const icon = isStepThinking ? "⏳" : "✅";
        const safeTitle = escapeHtml(step.title);
        const safeTime = escapeHtml(step.timestamp);
        const isLast = idx === data.chainOfThought.length - 1;
        const contentHtml = step.content ? renderMarkdown(step.content) : '<span class="empty-hint">Reasoning in progress...</span>';

        return `
          <div class="thought-step-card ${isStepThinking ? 'active-thinking' : 'done'}" data-step-id="${step.id}">
            <div class="thought-step-header" onclick="toggleThoughtStep('${step.id}')">
              <div class="thought-step-title-row">
                <span class="step-icon">${icon}</span>
                <span>${safeTitle}</span>
              </div>
              <span class="thought-step-time">${safeTime}</span>
            </div>
            <div id="step-body-${step.id}" class="thought-step-body ${!isLast && !isStepThinking ? 'collapsed' : ''}">
              ${contentHtml}
            </div>
          </div>
        `;
      }).join("");
    }
  }

  // 3. Running Comments Stream
  if (commentsStream) {
    if (!data.runningComments || data.runningComments.length === 0) {
      commentsStream.innerHTML = `<div class="empty-hint">No commentary recorded yet.</div>`;
    } else {
      commentsStream.innerHTML = data.runningComments.map(c => {
        const tagClass = `tag-${c.tag || 'thought'}`;
        return `
          <div class="comment-item">
            <span class="comment-time">${escapeHtml(c.timestamp)}</span>
            <span class="comment-tag ${tagClass}">${escapeHtml(c.tag)}</span>
            <span class="comment-msg">${escapeHtml(c.message)}</span>
          </div>
        `;
      }).join("");
      commentsStream.scrollTop = commentsStream.scrollHeight;
    }
    if (commentsCountBadge) {
      commentsCountBadge.textContent = `${data.runningComments?.length || 0} notes`;
    }
  }

  // 4. Notes input
  if (notesInput && data.notesMarkdown !== undefined && document.activeElement !== notesInput) {
    notesInput.value = data.notesMarkdown;
  }

  // 5. Whiteboard canvas drawing restoration
  if (data.drawingDataUrl && ctx) {
    const img = new Image();
    img.onload = () => ctx.drawImage(img, 0, 0);
    img.src = data.drawingDataUrl;
  }
}

// ==========================================
// 9. Robust Markdown Parser (Codeblocks, Lists, Alerts)
// ==========================================
function renderMarkdown(md) {
  if (!md) return "";

  // 1. Fenced Code Blocks (```lang ... ```)
  const codeBlocks = [];
  let html = md.replace(/```([a-zA-Z0-9_\-]*)\r?\n([\s\S]*?)```/g, (match, lang, code) => {
    const idx = codeBlocks.length;
    const safeCode = escapeHtml(code.trim());
    codeBlocks.push(`
      <pre class="code-block">
        <div class="code-lang-tag">${escapeHtml(lang || "code")}</div>
        <code>${safeCode}</code>
      </pre>
    `);
    return `<!--CODEBLOCK_${idx}-->`;
  });

  // 2. File Action Headers: #### [MODIFY] [filename](url)
  html = html.replace(/^####\s*\[(MODIFY|NEW|DELETE)\]\s*\[([^\]]+)\]\(([^)]+)\)/gim, (match, action, fname, fpath) => {
    const badgeClass = action.toUpperCase() === 'NEW' ? 'badge-new' : action.toUpperCase() === 'DELETE' ? 'badge-delete' : 'badge-modify';
    return `<div class="plan-file-header"><span class="badge ${badgeClass}">${action.toUpperCase()}</span> <a href="#" class="file-link" onclick="openFileUrl('${escapeHtml(fpath)}'); return false;">📄 ${escapeHtml(fname)}</a> <button class="btn-diff-preview" onclick="openFileDiff('${escapeHtml(fpath)}'); return false;" title="Inspect side-by-side diff in VS Code">🔍 Diff</button></div>`;
  });

  // 3. Headings
  html = html
    .replace(/^#### (.*$)/gim, '<h4>$1</h4>')
    .replace(/^### (.*$)/gim, '<h3>$1</h3>')
    .replace(/^## (.*$)/gim, '<h2>$1</h2>')
    .replace(/^# (.*$)/gim, '<h1>$1</h1>');

  // 4. Markdown Links: [text](url)
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, txt, url) => {
    return `<a href="#" class="file-link" onclick="openFileUrl('${escapeHtml(url)}'); return false;">${escapeHtml(txt)}</a>`;
  });

  // 5. GitHub Alerts / Blockquotes
  html = html.replace(/^>\s*\[!IMPORTANT\]\s*(.*$)/gim, '<blockquote class="alert-important"><strong>⚠️ IMPORTANT:</strong> $1</blockquote>');
  html = html.replace(/^>\s*\[!WARNING\]\s*(.*$)/gim, '<blockquote class="alert-important"><strong>⚠️ WARNING:</strong> $1</blockquote>');
  html = html.replace(/^>\s*\[!NOTE\]\s*(.*$)/gim, '<blockquote><strong>ℹ️ NOTE:</strong> $1</blockquote>');
  html = html.replace(/^>\s*(.*$)/gim, '<blockquote>$1</blockquote>');

  // 6. Inline Styling: bold, italic, code
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // 7. Unordered Lists & Checkboxes
  const lines = html.split(/\r?\n/);
  const processedLines = [];
  let inUl = false;
  let inOl = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const ulMatch = line.match(/^(\s*)[-*]\s+(.*)$/);
    const olMatch = line.match(/^(\s*)\d+\.\s+(.*)$/);

    if (ulMatch) {
      if (!inUl) {
        if (inOl) { processedLines.push('</ol>'); inOl = false; }
        processedLines.push('<ul>');
        inUl = true;
      }
      let itemContent = ulMatch[2];
      if (/^\[x\]\s*/i.test(itemContent)) {
        itemContent = `<span class="task-checkbox-item checked"><span>☑️</span> <span>${itemContent.replace(/^\[x\]\s*/i, '')}</span></span>`;
      } else if (/^\[ \]\s*/i.test(itemContent)) {
        itemContent = `<span class="task-checkbox-item"><span>⬜</span> <span>${itemContent.replace(/^\[ \]\s*/i, '')}</span></span>`;
      }
      processedLines.push(`<li>${itemContent}</li>`);
    } else if (olMatch) {
      if (!inOl) {
        if (inUl) { processedLines.push('</ul>'); inUl = false; }
        processedLines.push('<ol>');
        inOl = true;
      }
      processedLines.push(`<li>${olMatch[2]}</li>`);
    } else {
      if (inUl) { processedLines.push('</ul>'); inUl = false; }
      if (inOl) { processedLines.push('</ol>'); inOl = false; }
      processedLines.push(line);
    }
  }
  if (inUl) processedLines.push('</ul>');
  if (inOl) processedLines.push('</ol>');

  html = processedLines.join('\n');

  // 8. Paragraphs and Linebreaks
  html = html.replace(/\n\n+/g, '<br /><br />');
  html = html.replace(/\n/g, '<br />');

  // 9. Restore Code Blocks
  codeBlocks.forEach((block, idx) => {
    html = html.replace(`<!--CODEBLOCK_${idx}-->`, block);
  });

  return html;
}

window.openFileUrl = function(rawUrl) {
  let clean = rawUrl.replace(/^file:\/\/\/?/, '');
  if (/^\/[a-zA-Z]:/.test(clean)) {
    clean = clean.substring(1);
  }
  vscode.postMessage({ type: 'OPEN_FILE', payload: { filePath: clean } });
};

window.openFileDiff = function(rawUrl) {
  let clean = rawUrl.replace(/^file:\/\/\/?/, '');
  if (/^\/[a-zA-Z]:/.test(clean)) {
    clean = clean.substring(1);
  }
  vscode.postMessage({ type: 'PREVIEW_DIFF', payload: { filePath: clean } });
};

function escapeHtml(text) {
  if (!text) return "";
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  return String(text).replace(/[&<>"']/g, m => map[m]);
}

// ==========================================
// 10. Message Listener (Direct Streaming & Events)
// ==========================================
window.addEventListener("message", (event) => {
  const { type, payload } = event.data;

  switch (type) {
    case "INIT_DATA":
      if (payload.plan) renderPlan(payload.plan);
      if (payload.wt) renderWalkthrough(payload.wt);
      if (payload.taskState) renderTaskState(payload.taskState);
      if (payload.scratchpad) renderScratchpad(payload.scratchpad);
      break;

    case "STREAM_START":
      currentStreamingMsg = document.createElement("div");
      currentStreamingMsg.className = "chat-msg agent-msg";
      currentStreamingMsg.innerHTML = `
        <span class="msg-icon">🚀</span>
        <div class="msg-content streaming-text"></div>
      `;
      chatStream.appendChild(currentStreamingMsg);
      chatStream.scrollTop = chatStream.scrollHeight;
      break;

    case "STREAM_CHUNK":
      if (currentStreamingMsg) {
        const textEl = currentStreamingMsg.querySelector(".streaming-text");
        textEl.innerHTML += escapeHtml(payload.chunk);
        chatStream.scrollTop = chatStream.scrollHeight;
      }
      break;

    case "STREAM_END":
      if (currentStreamingMsg) {
        const textEl = currentStreamingMsg.querySelector(".streaming-text");
        textEl.innerHTML = renderMarkdown(textEl.textContent);
        currentStreamingMsg = null;
      }
      break;

    case "UPDATE_SCRATCHPAD":
      renderScratchpad(payload);
      break;

    case "UPDATE_PLAN":
      renderPlan(payload);
      break;

    case "UPDATE_WALKTHROUGH":
      renderWalkthrough(payload);
      break;

    case "UPDATE_TASK_STATE":
      renderTaskState(payload);
      break;

    case "ATTACH_FILE_RESULT":
      if (payload && payload.fsPath) {
        if (!attachedFiles.some(f => f.fsPath.toLowerCase() === payload.fsPath.toLowerCase())) {
          attachedFiles.push(payload);
          renderAttachedFiles();
        }
      }
      break;

    case "ATTACH_MULTIPLE_FILES_RESULT":
      if (Array.isArray(payload)) {
        for (const f of payload) {
          if (!attachedFiles.some(af => af.fsPath.toLowerCase() === f.fsPath.toLowerCase())) {
            attachedFiles.push(f);
          }
        }
        renderAttachedFiles();
      }
      break;

    case "SWITCH_TAB":
      if (payload?.tabId) switchTab(payload.tabId);
      break;

    case "SETTINGS_DATA":
      if (payload) {
        if (settingCodeSnippets && typeof payload.includeCodeSnippets === "boolean") {
          settingCodeSnippets.checked = payload.includeCodeSnippets;
        }
        if (settingMaxGrep && typeof payload.maxGrepFiles === "number") {
          settingMaxGrep.value = payload.maxGrepFiles;
        }

        const buildOptionsHtml = (selectedId) => {
          let html = '<option value="auto">Auto / Default</option>';
          if (Array.isArray(payload.availableModels)) {
            payload.availableModels.forEach(m => {
              const isSel = selectedId === m.id ? "selected" : "";
              html += `<option value="${escapeHtml(m.id)}" ${isSel}>${escapeHtml(m.name)} (${escapeHtml(m.pricing)})</option>`;
            });
          }
          return html;
        };

        if (settingPreferredModel) {
          settingPreferredModel.innerHTML = buildOptionsHtml(payload.preferredModel);
          if (payload.preferredModel === "auto" || !payload.preferredModel) {
            settingPreferredModel.value = "auto";
          }
        }

        if (promptModelSelect) {
          promptModelSelect.innerHTML = buildOptionsHtml(payload.preferredModel);
          if (payload.preferredModel === "auto" || !payload.preferredModel) {
            promptModelSelect.value = "auto";
          }
        }

        if (dockModelName) {
          const active = payload.availableModels?.find(m => m.id === payload.preferredModel);
          dockModelName.textContent = active ? `🤖 ${active.name}` : (payload.preferredModel === "auto" ? "🤖 Model: Auto" : `🤖 ${payload.preferredModel}`);
        }
      }
      break;

    case "TELEMETRY_UPDATE":
      if (payload) {
        if (payload.turn) {
          if (hudModelName) hudModelName.textContent = payload.turn.modelName;
          if (dockModelName) dockModelName.textContent = `🤖 ${payload.turn.modelName}`;
          if (telemetryModelName) telemetryModelName.textContent = payload.turn.modelName;
          if (telemetryPricingLabel) telemetryPricingLabel.textContent = payload.turn.pricingLabel;
          if (telemetryLastIn) telemetryLastIn.textContent = payload.turn.inputTokens.toLocaleString();
          if (telemetryLastOut) telemetryLastOut.textContent = payload.turn.outputTokens.toLocaleString();
          if (telemetryLastCost) telemetryLastCost.textContent = `${payload.turn.estimatedAic.toFixed(3)} AIC ($${payload.turn.estimatedUsd.toFixed(4)})`;
        }
        if (payload.session) {
          if (hudAicValue) hudAicValue.textContent = `${payload.session.sessionAic.toFixed(3)} AIC`;
          if (telemetryTotalTokens) telemetryTotalTokens.textContent = `${payload.session.sessionTotalTokens.toLocaleString()} tokens`;
          if (telemetryTotalAic) telemetryTotalAic.textContent = `${payload.session.sessionAic.toFixed(3)} AIC`;
          if (telemetryTotalUsd) telemetryTotalUsd.textContent = `$${payload.session.sessionUsd.toFixed(4)} USD`;
          if (!payload.turn && payload.session.lastTurn) {
            if (hudModelName) hudModelName.textContent = payload.session.lastTurn.modelName;
            if (dockModelName) dockModelName.textContent = `🤖 ${payload.session.lastTurn.modelName}`;
            if (telemetryModelName) telemetryModelName.textContent = payload.session.lastTurn.modelName;
            if (telemetryPricingLabel) telemetryPricingLabel.textContent = payload.session.lastTurn.pricingLabel;
          }
        }
      }
      break;

    case "OPEN_SETTINGS":
      if (settingsModal) settingsModal.classList.remove("hidden");
      break;

    case "UPDATE_CHECKPOINT_STATE":
      if (payload && typeof payload.hasCheckpoint === "boolean") {
        rollbackButtons.forEach(btn => {
          if (btn) {
            if (payload.hasCheckpoint) {
              btn.classList.remove("hidden");
            } else {
              btn.classList.add("hidden");
            }
          }
        });
      }
      break;

    case "HISTORICAL_CONTEXT_UPDATE":
      if (payload && payload.hasContext) {
        if (historyContextStrip) historyContextStrip.classList.remove("hidden");
        if (historyChipName) historyChipName.textContent = payload.goal || payload.logName || "Historical Mission";
      } else {
        if (historyContextStrip) historyContextStrip.classList.add("hidden");
      }
      break;
  }
});

// Boot
initCanvas();
vscode.postMessage({ type: "READY" });
