# 🚀 Antigravity Mission Control

[![VS Code](https://img.shields.io/badge/VS%20Code-v1.90+-007ACC?logo=visualstudiocode&logoColor=white)](https://code.visualstudio.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![AI Pair Programmer](https://img.shields.io/badge/AI%20Agent-Antigravity%20Engine-8A2BE2)](#-features)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](#-contributing)

> **Bring the powerful, human-in-the-loop autonomous pair programming experience of Antigravity IDE directly into Visual Studio Code.**

**Antigravity Mission Control** transforms VS Code into an agentic IDE with multi-file workspace reasoning, human review approval gates, real-time reasoning scratchpads, and automated post-execution verification walkthroughs.

---

## 📸 Core Highlights

```
┌────────────────────────────────────────────────────────────────────────┐
│  🚀 ANTIGRAVITY MISSION CONTROL                           ⚙️ Settings  │
├───────────────┬───────────────┬───────────────────┬────────────────────┤
│   📋 Task     │    🗺️ Plan    │   🧠 Scratchpad   │   🔍 Walkthrough   │
├───────────────┴───────────────┴───────────────────┴────────────────────┤
│                                                                        │
│  [IDLE] Ready for your next objective.                                 │
│                                                                        │
│  🧠 Live Thought: Discovered 3 matching workspace files via grep...    │
│                                                                        │
│  Subtasks:                                                             │
│  ✅ Read workspace structure & context                                 │
│  ✅ Generate implementation plan with approval gate                    │
│  ⏳ Execute approved code modifications across all files               │
│  ⬜ Run verification checks & generate walkthrough                     │
│                                                                        │
├────────────────────────────────────────────────────────────────────────┤
│  📎 [📄 math_quest.html ✕] [📄 main.css ✕]           🔍 Auto-Grep Active │
│  Ask Antigravity, @file, or type /plan <goal>...           [ ➤ Send ]  │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 🌟 Key Features

### 1. 🗺️ Implementation Plan & Approval Gates
* **No Unsolicited Edits**: Before touching your code, Antigravity drafts a structured implementation plan.
* **Human-in-the-Loop Review**: Review proposed changes and approve with **`✅ Approve & Execute Plan`** or provide feedback via **`💬 Request Changes`**.
* **Clean & Concise by Default**: Plans focus on high-level architectural summaries and bullet points without giant code dumps. Clickable file cards let you inspect modified files immediately.
* **Granular Snippet Control**: Need exact diff snippets in the plan? Toggle code snippets ON or OFF anytime in **`⚙️ Settings`**.

### 2. 🧠 Agent Scratchpad (Chain of Thought & Running Comments)
* **Transparent Agent Reasoning**: Watch the model reason in real-time. Antigravity streams step-by-step thinking accordions before writing plans or executing code.
* **Live Running Commentary**: Tagged timeline logs every agent observation, decision, tool use, and thought:
  - `[THOUGHT]` Analyzing state variables and dependencies...
  - `[OBSERVATION]` Discovered relevant files via workspace grep.
  - `[DECISION]` Applied search-and-replace patches across 3 files.
* **Persistent Working Notes**: Notes auto-sync to `.copilot/scratchpad.md` and `.copilot/scratchpad.json`.
* **Export & Share**: Copy the full reasoning trace to your clipboard with one click (**`📋 Copy`**).

### 3. 🔍 Natural Language Workspace Grep & Multi-File Editing
* **Automatic Workspace Discovery**: Type natural language goals like `/plan update audio and styling across all arcade games`. Antigravity runs a deep content and filename grep, ranks matching files, and injects them into context automatically.
* **Multiple Ways to Attach Context**:
  - **Prompt Chip Bar**: Click **`📎 + Add File`** for a fuzzy quick-pick list.
  - **`@` Shortcut**: Type `@` anywhere in the prompt to pick files on the fly.
  - **Right-Click Explorer Menu**: Right-click any file in VS Code Explorer $\rightarrow$ **`Antigravity: Attach to Mission Context`**.
  - **Shift + Drag**: Hold <kbd>Shift</kbd> and drop files directly into the sidebar from the VS Code Explorer.
* **Automated Batch Multi-File Execution**: Executes approved code modifications across all targeted files sequentially, writing buffers to disk and refreshing open editors.

### 4. 🔬 Dynamic Mission Walkthroughs (Antigravity IDE Match)
* **Real AI-Synthesized Verification**: Replaces generic static reports with dynamic synthesis powered by Copilot LM.
* **Structured Walkthrough Reports**:
  - **Executive Summary**: What was accomplished and how components interact.
  - **Changes Made**: Per-file modification breakdowns.
  - **Verification Checklist**: Interactive checklists (`☑️`, `⬜`) validating syntax, event bindings, and UI state.
  - **User Next Steps**: Guidance on how to test and experience the new features.
* **Regenerate & Re-verify**: Re-run verification at any time with **`🔄 Regenerate`**.

### 5. ⚙️ In-Panel Settings & Preferences
* In-panel settings drawer accessible from the header bar (**`⚙️ Settings`**).
* Toggle detailed code snippets in plans (default: OFF).
* Configure maximum candidate files for auto-grep discovery (default: 5).
* Seamlessly synchronized with VS Code's global configuration (`antigravity.*`).

---

## ⌨️ Quick Commands & Shortcuts

| Command / Pill | Description |
| :--- | :--- |
| `⚡ /plan <goal>` | Researches workspace and generates an implementation plan with an approval gate |
| `✅ /execute` | Approves and executes the active implementation plan across all target files |
| `🔍 /walkthrough` | Re-synthesizes the verification report in `.copilot/walkthrough.md` |
| `🧠 /scratch` | Switches directly to the live Chain of Thought & Scratchpad tab |
| `🧹 Reset` | Clears mission state, plans, walkthroughs, and prompt attachments for a fresh start |
| `@` in prompt | Quick-picks and attaches any file from your workspace |
| Right-click file in Explorer | **`Antigravity: Attach to Mission Context`** |

---

## 🛠️ Installation & Getting Started

### Prerequisites
* **VS Code** 1.90.0 or higher
* **GitHub Copilot** extension with access to language models (`vscode.lm`)

### Local Setup & Development

```bash
# 1. Clone the repository
git clone https://github.com/jaymelby/antigravity.git
cd antigravity

# 2. Install dependencies
npm install

# 3. Build & Compile
npm run compile

# 4. Package into VSIX
npx @vscode/vsce package --no-dependencies

# 5. Install into your local VS Code
code --install-extension antigravity-vscode-1.0.0.vsix --force
```

---

## 📁 Repository Structure

```
antigravity/
├── media/
│   ├── icon.svg                     # Antigravity rocket icon
│   ├── main.css                     # Dark-mode glassmorphic design system
│   └── main.js                      # Client-side webview controller & Markdown engine
├── src/
│   ├── chat/
│   │   └── chatParticipant.ts       # @antigravity VS Code Chat participant
│   ├── services/
│   │   ├── planWatcher.ts           # Watches & reloads .copilot/implementation_plan.md
│   │   ├── scratchpadStore.ts       # Chain of Thought & Running Comments engine
│   │   ├── taskRunner.ts            # State machine & task logging
│   │   ├── walkthroughWatcher.ts    # Watches & parses .copilot/walkthrough.md
│   │   └── workspaceSearch.ts       # Natural language grep & fuzzy file picker
│   ├── webview/
│   │   ├── AntigravityViewProvider.ts # Backend execution engine & LLM orchestrator
│   │   └── getWebviewContent.ts     # HTML template with 4-tab control center
│   └── extension.ts                 # Extension activation & command registry
├── esbuild.js                       # Fast production bundler
├── package.json                     # Extension manifest & configuration contributes
└── tsconfig.json                    # TypeScript compiler configuration
```

---

## 🤝 Contributing

Contributions, feature requests, and suggestions are warmly welcomed!
Feel free to open an issue or submit a Pull Request.

---

## 📄 License

Distributed under the [MIT License](LICENSE).
