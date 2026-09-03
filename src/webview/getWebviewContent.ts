import * as vscode from 'vscode';

export function getWebviewContent(
  webview: vscode.Webview,
  extensionUri: vscode.Uri
): string {
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'main.js'));
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'main.css'));
  const nonce = getNonce();

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} data: https:;">
  <link rel="stylesheet" href="${styleUri}">
  <title>Antigravity Mission Control</title>
</head>
<body>
  <div class="app-container">
    <!-- Drag & Drop Visual Overlay -->
    <div id="drop-overlay" class="drop-overlay hidden">
      <span class="drop-overlay-icon">📥</span>
      <span class="drop-overlay-text">Drop Files to Attach</span>
      <span class="drop-overlay-sub">Attaches files directly to context & multi-file planning</span>
      <span class="drop-overlay-tip">💡 Note: Hold <kbd>Shift</kbd> while dragging from VS Code Explorer</span>
    </div>

    <!-- Top Navigation Bar -->
    <header class="app-header">
      <div class="brand">
        <span class="brand-icon">🚀</span>
        <span class="brand-title">Antigravity</span>
      </div>
      <div class="header-actions">
        <button id="btn-open-settings" class="btn btn-sm btn-secondary settings-btn" title="Antigravity Settings & Preferences">
          ⚙️ Settings
        </button>
        <button id="btn-reset-mission" class="btn btn-sm btn-secondary reset-btn" title="Reset mission, plan, and start over">
          🧹 Reset
        </button>
        <div id="agent-state-badge" class="state-badge state-idle">IDLE</div>
      </div>
    </header>

    <!-- Settings Modal -->
    <div id="settings-modal" class="settings-modal hidden">
      <div class="settings-modal-backdrop" id="settings-backdrop"></div>
      <div class="settings-modal-content">
        <div class="settings-modal-header">
          <div class="settings-modal-title">
            <span class="settings-icon">⚙️</span>
            <h3>Mission Control Settings</h3>
          </div>
          <button id="btn-close-settings" class="icon-btn" title="Close Settings">✕</button>
        </div>
        <div class="settings-modal-body">
          <div class="setting-item">
            <div class="setting-info">
              <label class="setting-label" for="setting-code-snippets">Include Detailed Code Snippets in Plan</label>
              <span class="setting-desc">When disabled (default), plans remain concise architectural summaries without verbose code blocks.</span>
            </div>
            <label class="switch">
              <input type="checkbox" id="setting-code-snippets">
              <span class="slider round"></span>
            </label>
          </div>

          <div class="setting-item">
            <div class="setting-info">
              <label class="setting-label" for="setting-max-grep">Max Auto-Grep Context Files</label>
              <span class="setting-desc">Maximum number of matching workspace files to discover and attach via natural language grep.</span>
            </div>
            <input type="number" id="setting-max-grep" class="setting-number-input" min="1" max="15" value="5">
          </div>
        </div>
        <div class="settings-modal-footer">
          <button id="btn-save-settings" class="btn btn-primary btn-sm">Save Preferences</button>
        </div>
      </div>
    </div>

    <!-- Navigation Tabs -->
    <nav class="nav-tabs">
      <button class="nav-tab active" data-tab="task-tab">
        <span class="tab-icon">📋</span> Task
      </button>
      <button class="nav-tab" data-tab="plan-tab">
        <span class="tab-icon">🗺️</span> Plan
      </button>
      <button class="nav-tab" data-tab="scratchpad-tab">
        <span class="tab-icon">🧠</span> Scratchpad
      </button>
      <button class="nav-tab" data-tab="walkthrough-tab">
        <span class="tab-icon">🔍</span> Walkthrough
      </button>
    </nav>

    <!-- Content Area (Scrollable) -->
    <main class="tabs-content-area">
      <!-- Tab 1: Task Tab -->
      <section id="task-tab" class="tab-pane active">
        <div class="card goal-card">
          <div class="card-header collapsible-header" data-target="goal-body">
            <div class="header-left">
              <span class="chevron">▼</span>
              <span class="card-title">🎯 Active Objective</span>
            </div>
            <button id="btn-refresh-task" class="icon-btn" title="Refresh">🔄</button>
          </div>
          <div id="goal-body" class="card-body">
            <p id="task-goal-text" class="goal-text">Ready for your next coding mission.</p>
          </div>
        </div>

        <!-- Live Thought Callout (Pulsing when agent is reasoning) -->
        <div id="live-thought-callout" class="live-thought-callout hidden">
          <div class="thought-callout-header">
            <div class="thought-pulse-indicator">
              <span class="thought-spinner"></span>
              <span class="thought-pulse-label">🧠 Agent Reasoning Active</span>
            </div>
            <button id="btn-jump-to-scratchpad" class="btn btn-xs btn-outline">Open Scratchpad ↗</button>
          </div>
          <div id="active-thought-summary" class="active-thought-summary">Analyzing workspace context...</div>
        </div>

        <!-- Chat / Agent Thought Stream -->
        <div class="card chat-card">
          <div class="card-header collapsible-header" data-target="chat-body">
            <div class="header-left">
              <span class="chevron">▼</span>
              <span class="card-title">💬 Mission Conversation</span>
            </div>
            <button id="btn-clear-chat" class="icon-btn" title="Clear conversation">🧹</button>
          </div>
          <div id="chat-body" class="card-body">
            <div id="chat-stream" class="chat-stream">
              <div class="chat-msg system-msg">
                <span class="msg-icon">🚀</span>
                <div class="msg-content">Welcome to Antigravity Mission Control! Enter your goal below or pick an action pill.</div>
              </div>
            </div>
          </div>
        </div>

        <div class="card subtask-card">
          <div class="card-header collapsible-header" data-target="subtask-body">
            <div class="header-left">
              <span class="chevron">▼</span>
              <span class="card-title">📊 Workflow Progression</span>
            </div>
          </div>
          <div id="subtask-body" class="card-body">
            <ul id="subtask-list" class="subtask-list"></ul>
          </div>
        </div>

        <div class="card log-card">
          <div class="card-header collapsible-header" data-target="log-body">
            <div class="header-left">
              <span class="chevron">▼</span>
              <span class="card-title">📡 Live Activity & Context Log</span>
            </div>
            <button id="btn-clear-logs" class="icon-btn" title="Clear logs">🧹</button>
          </div>
          <div id="log-body" class="card-body">
            <div id="log-stream" class="log-stream"></div>
          </div>
        </div>
      </section>

      <!-- Tab 2: Implementation Plan Tab -->
      <section id="plan-tab" class="tab-pane">
        <div class="plan-top-bar">
          <div class="plan-banner">
            <div class="plan-title-row">
              <h2 id="plan-title">No Active Implementation Plan</h2>
              <div class="plan-title-actions">
                <button id="btn-open-raw-plan" class="btn btn-sm btn-secondary">Open Markdown ↗</button>
              </div>
            </div>
            <p id="plan-summary" class="plan-summary">Draft a plan using the prompt bar below.</p>
          </div>

          <div class="approval-strip">
            <button id="btn-approve-plan" class="btn btn-primary btn-approve">
              ✅ Approve &amp; Execute Plan
            </button>
            <button id="btn-open-feedback-drawer" class="btn btn-secondary btn-feedback">
              💬 Request Changes
            </button>
          </div>
        </div>

        <!-- User Review Callout (if any review items) -->
        <div id="user-review-callout" class="card user-review-card hidden">
          <div class="card-header">
            <div class="header-left">
              <span class="card-title">⚠️ User Review Required</span>
            </div>
            <span class="badge badge-warning">Action Items</span>
          </div>
          <div class="card-body">
            <ul id="plan-review-list" class="review-list"></ul>
          </div>
        </div>

        <!-- Rendered Plan Document -->
        <div class="card plan-document-card">
          <div class="card-body">
            <div id="plan-rendered-markdown" class="rendered-markdown plan-content">
              <p class="empty-hint">No plan loaded. Send a prompt to create an implementation plan.</p>
            </div>
          </div>
        </div>

        <!-- Inline In-Panel Feedback Drawer -->
        <div id="feedback-drawer" class="feedback-drawer hidden">
          <div class="feedback-drawer-header">
            <span class="drawer-title">💬 Request Changes to Plan</span>
            <button id="btn-close-feedback-drawer" class="icon-btn" title="Close">✕</button>
          </div>
          <textarea id="feedback-input" class="feedback-textarea" placeholder="Describe the adjustments, file constraints, or architectural changes you want..."></textarea>
          <div class="feedback-drawer-footer">
            <button id="btn-cancel-feedback" class="btn btn-secondary btn-sm">Cancel</button>
            <button id="btn-submit-feedback" class="btn btn-primary btn-sm">Send Feedback</button>
          </div>
        </div>
      </section>

      <!-- Tab 3: Scratchpad Tab (Antigravity Chain of Thought & Running Comments) -->
      <section id="scratchpad-tab" class="tab-pane">
        <!-- Top Toolbar & Status -->
        <div class="scratchpad-header-bar">
          <div class="scratchpad-header-title">
            <span class="tab-icon">🧠</span>
            <div>
              <h2>Agent Scratchpad</h2>
              <span class="scratchpad-subtitle">Live Chain of Thought &amp; Running Commentary</span>
            </div>
          </div>
          <div class="scratchpad-actions">
            <button id="btn-copy-thoughts" class="btn btn-sm btn-secondary" title="Copy chain of thought to clipboard">📋 Copy</button>
            <button id="btn-clear-scratchpad" class="btn btn-sm btn-secondary" title="Clear current scratchpad">🗑️ Clear</button>
            <button id="btn-open-raw-scratchpad" class="btn btn-sm btn-secondary" title="Open scratchpad.md in editor">Open Markdown ↗</button>
          </div>
        </div>

        <!-- Section 1: Chain of Thought (Thinking Process) -->
        <div class="card chain-of-thought-card">
          <div class="card-header collapsible-header" data-target="cot-body">
            <div class="header-left">
              <span class="chevron">▼</span>
              <span class="card-title">🧠 Chain of Thought (Thinking Process)</span>
            </div>
            <div class="header-right">
              <span id="thought-status-badge" class="thought-badge idle">Idle</span>
            </div>
          </div>
          <div id="cot-body" class="card-body">
            <div id="chain-of-thought-container" class="thought-steps-list">
              <!-- Steps rendered here dynamically -->
            </div>
          </div>
        </div>

        <!-- Section 2: Running Agent Commentary & Observations -->
        <div class="card running-comments-card">
          <div class="card-header collapsible-header" data-target="comments-body">
            <div class="header-left">
              <span class="chevron">▼</span>
              <span class="card-title">⚡ Running Comments &amp; Observations</span>
            </div>
            <span id="comments-count-badge" class="badge badge-info">0 notes</span>
          </div>
          <div id="comments-body" class="card-body">
            <div id="running-comments-stream" class="running-comments-stream">
              <!-- Chronological comments rendered here -->
            </div>
          </div>
        </div>

        <!-- Section 3: Working Notes & Hypotheses (Auto-saved) -->
        <div class="card scratchpad-notes-card">
          <div class="card-header collapsible-header" data-target="notes-body">
            <div class="header-left">
              <span class="chevron">▼</span>
              <span class="card-title">📝 Working Notes (Saved to .copilot/scratchpad.md)</span>
            </div>
            <button id="btn-save-notes" class="btn btn-sm btn-primary">Save Notes</button>
          </div>
          <div id="notes-body" class="card-body">
            <textarea id="scratchpad-notes-input" class="notes-textarea" placeholder="Agent notes and discovered state are recorded here. You can also jot down manual notes..."></textarea>
          </div>
        </div>

        <!-- Section 4: Optional Quick Sketch Whiteboard -->
        <div class="card whiteboard-card collapsible-card">
          <div class="card-header collapsible-header collapsed" data-target="whiteboard-body">
            <div class="header-left">
              <span class="chevron">▶</span>
              <span class="card-title">🎨 Quick Sketch Whiteboard (Optional)</span>
            </div>
          </div>
          <div id="whiteboard-body" class="card-body hidden">
            <div class="scratchpad-toolbar">
              <div class="color-palette">
                <button class="color-swatch active" data-color="#ffffff" style="background: #ffffff;"></button>
                <button class="color-swatch" data-color="#60a5fa" style="background: #60a5fa;"></button>
                <button class="color-swatch" data-color="#34d399" style="background: #34d399;"></button>
                <button class="color-swatch" data-color="#fbbf24" style="background: #fbbf24;"></button>
                <button class="color-swatch" data-color="#f87171" style="background: #f87171;"></button>
              </div>
              <div class="tool-controls">
                <button id="tool-pen" class="tool-btn active" title="Pen">✏️</button>
                <button id="tool-eraser" class="tool-btn" title="Eraser">🧹</button>
                <button id="tool-undo" class="tool-btn" title="Undo">↩️</button>
                <button id="tool-clear" class="tool-btn" title="Clear Canvas">🗑️</button>
              </div>
            </div>
            <div class="canvas-wrapper">
              <canvas id="scratchpad-canvas" width="600" height="240"></canvas>
            </div>
          </div>
        </div>
      </section>

      <!-- Tab 4: Walkthrough Tab (Antigravity IDE Match) -->
      <section id="walkthrough-tab" class="tab-pane">
        <div class="plan-top-bar">
          <div class="plan-banner">
            <div class="plan-title-row">
              <div class="walkthrough-title-group">
                <span class="tab-icon">🔍</span>
                <div>
                  <h2 id="walkthrough-title">No Walkthrough Generated</h2>
                  <span id="walkthrough-badge" class="badge badge-success hidden">VERIFIED</span>
                </div>
              </div>
              <div class="plan-title-actions">
                <button id="btn-regenerate-walkthrough" class="btn btn-sm btn-secondary" title="Re-synthesize verification report">🔄 Regenerate</button>
                <button id="btn-open-raw-walkthrough" class="btn btn-sm btn-secondary" title="Open walkthrough.md in editor">Open Markdown ↗</button>
              </div>
            </div>
            <p id="walkthrough-summary" class="plan-summary">Execute an approved plan or run /walkthrough to generate verification results.</p>
          </div>
        </div>

        <div class="card walkthrough-document-card">
          <div class="card-body">
            <div id="walkthrough-rendered-markdown" class="rendered-markdown walkthrough-content">
              <p class="empty-hint">No walkthrough loaded. Execute an approved plan or run /walkthrough to generate a verification report.</p>
            </div>
          </div>
        </div>
      </section>
    </main>

    <!-- DOCKED BOTTOM PROMPT BAR -->
    <footer class="docked-prompt-bar">
      <div class="action-pills">
        <button class="pill-btn" data-cmd="/plan">⚡ /plan</button>
        <button class="pill-btn" data-cmd="/execute">✅ /execute</button>
        <button class="pill-btn" data-cmd="/walkthrough">🔍 /walkthrough</button>
        <button class="pill-btn" data-cmd="/scratch">🧠 /scratch</button>
      </div>

      <!-- Attached Files Strip & Auto-Grep indicator -->
      <div class="attached-files-strip">
        <button id="btn-attach-file" class="btn-attach-chip" title="Attach any file from workspace to prompt context (or type @ in prompt)">
          <span>📎 + Add File</span>
        </button>
        <div id="attached-chips-container" class="attached-chips-container"></div>
        <span class="auto-grep-badge" title="Auto-grep automatically discovers relevant workspace files based on natural language queries">🔍 Auto-Grep Active</span>
      </div>

      <div class="prompt-input-row">
        <textarea id="prompt-input" class="prompt-textarea" rows="1" placeholder="Ask Antigravity, @file, or type /plan &lt;goal&gt;... (Enter to send)"></textarea>
        <button id="btn-send-prompt" class="btn btn-primary send-btn" title="Send (Enter)">
          <span>➤</span>
        </button>
      </div>
      <div class="dock-footer">
        <span class="prompt-tip"><kbd>@</kbd> attach, or Right-Click file in Explorer → "Attach to Antigravity"</span>
        <span class="model-badge">Copilot LM (Multi-File Grep)</span>
      </div>
    </footer>
  </div>

  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

function getNonce() {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
