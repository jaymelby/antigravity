import * as vscode from 'vscode';
import * as path from 'path';

export interface SanitizedScratchpad {
  notes: string;
  keySteps: { title: string; summary: string }[];
  keyComments: { type: string; text: string }[];
  telemetryNote?: string;
}

export interface MissionLogMetadata {
  version: string;
  exportedAt: string;
  goal: string;
  modelName?: string;
  totalTokens?: number;
  totalAic?: number;
}

export interface ImportedMissionData {
  metadata: MissionLogMetadata;
  planContent: string;
  walkthroughContent: string;
  scratchpadContent: SanitizedScratchpad;
  copilotContextSummary: string;
}

export class MissionLogService {
  private static readonly LOG_FOLDER_NAME = 'Antigravity Logs';

  /**
   * Returns the URI for the workspace 'Antigravity Logs' folder.
   * Ensures the folder exists on disk.
   */
  public async getLogFolderUri(workspaceRoot: vscode.Uri): Promise<vscode.Uri> {
    const logFolder = vscode.Uri.joinPath(workspaceRoot, MissionLogService.LOG_FOLDER_NAME);
    try {
      await vscode.workspace.fs.createDirectory(logFolder);
    } catch {
      // Folder already exists or cannot be created
    }
    return logFolder;
  }

  /**
   * Sanitizes Scratchpad steps and comments:
   * - Filters out raw code diff blocks (<<<<<<< SEARCH ... ======= ... >>>>>>>)
   * - Filters out large code fences (> 8 lines of code)
   * - Retains goals, architectural decisions, file lists, observations, and notes
   */
  public sanitizeScratchpad(rawScratchpad: any): SanitizedScratchpad {
    if (!rawScratchpad) {
      return { notes: '', keySteps: [], keyComments: [] };
    }

    const notes = typeof rawScratchpad.notes === 'string' ? rawScratchpad.notes.trim() : '';
    const keySteps: { title: string; summary: string }[] = [];
    const keyComments: { type: string; text: string }[] = [];

    // Sanitize thought steps
    if (Array.isArray(rawScratchpad.steps)) {
      for (const step of rawScratchpad.steps) {
        if (!step.title) continue;
        const rawContent = step.content || '';
        const cleaned = this.cleanVerboseCode(rawContent);
        if (cleaned) {
          keySteps.push({
            title: step.title,
            summary: cleaned
          });
        }
      }
    }

    // Sanitize running comments (decisions, observations, high-level thoughts)
    if (Array.isArray(rawScratchpad.runningComments)) {
      for (const comment of rawScratchpad.runningComments) {
        if (!comment.text) continue;
        const cleaned = this.cleanVerboseCode(comment.text);
        if (cleaned) {
          keyComments.push({
            type: comment.type || 'observation',
            text: cleaned
          });
        }
      }
    }

    return { notes, keySteps, keyComments };
  }

  /**
   * Removes code diff blocks, SEARCH/REPLACE blocks, and large code dumps from text.
   */
  private cleanVerboseCode(text: string): string {
    if (!text) return '';

    let cleaned = text;

    // Remove search/replace blocks: <<<<<<< SEARCH ... ======= ... >>>>>>>
    cleaned = cleaned.replace(/<{7}\s*SEARCH[\s\S]*?={7}[\s\S]*?>{7}/gi, '[Code Patch Applied]');

    // Strip large code blocks (> 8 lines) and replace with compact note
    cleaned = cleaned.replace(/```(?:[a-zA-Z0-9_\-]*)\r?\n([\s\S]*?)```/g, (match, code) => {
      const lineCount = code.split(/\r?\n/).length;
      if (lineCount > 8) {
        return `\`\`\`\n[Code snippet omitted from log - ${lineCount} lines]\n\`\`\``;
      }
      return match;
    });

    // Remove consecutive empty lines
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n');

    return cleaned.trim();
  }

  /**
   * Formats the complete mission into a dual-purpose Markdown file
   * (Human-readable Markdown for user review + LLM ingestible + Embedded state for re-importing)
   */
  public formatMissionMarkdown(
    goal: string,
    planMarkdown: string,
    walkthroughMarkdown: string,
    sanitizedScratchpad: SanitizedScratchpad,
    telemetry?: { modelName?: string; tokens?: number; aic?: number }
  ): string {
    const timestamp = new Date().toISOString();
    const cleanGoal = goal || 'Workspace Mission';
    const model = telemetry?.modelName || 'Copilot';
    const aic = telemetry?.aic !== undefined ? telemetry.aic.toFixed(3) : '0.000';
    const tokens = telemetry?.tokens !== undefined ? telemetry.tokens.toLocaleString() : '0';

    // State payload for lossless import
    const statePayload = {
      version: '1.0.0',
      exportedAt: timestamp,
      goal: cleanGoal,
      model,
      tokens: telemetry?.tokens || 0,
      aic: telemetry?.aic || 0,
      plan: planMarkdown,
      walkthrough: walkthroughMarkdown,
      scratchpad: sanitizedScratchpad
    };

    const encodedState = Buffer.from(JSON.stringify(statePayload)).toString('base64');

    let md = '';

    // YAML Frontmatter
    md += `---\n`;
    md += `antigravity_version: 1.0.0\n`;
    md += `export_timestamp: "${timestamp}"\n`;
    md += `mission_goal: "${cleanGoal.replace(/"/g, '\\"')}"\n`;
    md += `ai_model: "${model}"\n`;
    md += `total_tokens: ${telemetry?.tokens || 0}\n`;
    md += `total_aic: ${aic}\n`;
    md += `---\n\n`;

    // Title & Header
    md += `# 🚀 Antigravity Mission Log: ${cleanGoal}\n\n`;
    md += `> **Exported:** ${new Date().toLocaleString()} | **Model:** ${model} | **Compute:** ${tokens} tokens (~${aic} AIC)\n\n`;

    // Section 1: Objective
    md += `## 🎯 Mission Objective\n${cleanGoal}\n\n`;

    // Section 2: Implementation Plan
    md += `## 📋 Implementation Plan\n`;
    if (planMarkdown && planMarkdown.trim()) {
      md += `${planMarkdown.trim()}\n\n`;
    } else {
      md += `*No implementation plan recorded for this mission.*\n\n`;
    }

    // Section 3: Walkthrough & Verification
    md += `## 🔍 Walkthrough & Verification Report\n`;
    if (walkthroughMarkdown && walkthroughMarkdown.trim()) {
      md += `${walkthroughMarkdown.trim()}\n\n`;
    } else {
      md += `*No walkthrough verification report recorded for this mission.*\n\n`;
    }

    // Section 4: Key Scratchpad Insights & Decisions
    md += `## 🧠 Key Scratchpad Insights & Architectural Decisions\n\n`;

    if (sanitizedScratchpad.keySteps.length > 0) {
      md += `### 🛠️ Execution & Reasoning Steps\n`;
      for (const step of sanitizedScratchpad.keySteps) {
        md += `#### ${step.title}\n${step.summary}\n\n`;
      }
    }

    if (sanitizedScratchpad.keyComments.length > 0) {
      md += `### 💡 Architectural Decisions & Discoveries\n`;
      for (const c of sanitizedScratchpad.keyComments) {
        const icon = c.type === 'decision' ? '🎯' : c.type === 'thought' ? '💭' : '👁️';
        md += `- **${icon} [${c.type.toUpperCase()}]**: ${c.text}\n`;
      }
      md += `\n`;
    }

    if (sanitizedScratchpad.notes) {
      md += `### 📝 Working Notes\n`;
      md += `${sanitizedScratchpad.notes}\n\n`;
    }

    // Embedded lossless state payload
    md += `<!-- ANTIGRAVITY_STATE_PAYLOAD: ${encodedState} -->\n`;

    return md;
  }

  /**
   * Exports active mission data to a file inside 'Antigravity Logs/'
   */
  public async exportMissionLog(
    workspaceRoot: vscode.Uri,
    goal: string,
    planMarkdown: string,
    walkthroughMarkdown: string,
    rawScratchpad: any,
    telemetry?: { modelName?: string; tokens?: number; aic?: number }
  ): Promise<{ fileUri: vscode.Uri; fileName: string; markdownContent: string }> {
    const logFolder = await this.getLogFolderUri(workspaceRoot);
    const sanitizedScratchpad = this.sanitizeScratchpad(rawScratchpad);

    const now = new Date();
    const dateStr = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const slug = (goal || 'mission')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 32);

    const fileName = `mission-${dateStr}-${slug || 'log'}.md`;
    const fileUri = vscode.Uri.joinPath(logFolder, fileName);

    const markdownContent = this.formatMissionMarkdown(
      goal,
      planMarkdown,
      walkthroughMarkdown,
      sanitizedScratchpad,
      telemetry
    );

    await vscode.workspace.fs.writeFile(fileUri, Buffer.from(markdownContent, 'utf8'));

    return { fileUri, fileName, markdownContent };
  }

  /**
   * Scans 'Antigravity Logs' for historical mission logs
   */
  public async listMissionLogs(workspaceRoot: vscode.Uri): Promise<{ uri: vscode.Uri; fileName: string; goal: string; date: string }[]> {
    const logFolder = vscode.Uri.joinPath(workspaceRoot, MissionLogService.LOG_FOLDER_NAME);
    const results: { uri: vscode.Uri; fileName: string; goal: string; date: string }[] = [];

    try {
      const entries = await vscode.workspace.fs.readDirectory(logFolder);
      for (const [name, type] of entries) {
        if (type === vscode.FileType.File && name.endsWith('.md')) {
          const fileUri = vscode.Uri.joinPath(logFolder, name);
          try {
            const bytes = await vscode.workspace.fs.readFile(fileUri);
            const content = Buffer.from(bytes).toString('utf8');

            // Extract goal from frontmatter or heading
            let goal = name.replace(/^mission-/, '').replace(/\.md$/, '');
            const goalMatch = content.match(/mission_goal:\s*"([^"]+)"/) || content.match(/# 🚀 Antigravity Mission Log:\s*(.+)/);
            if (goalMatch) {
              goal = goalMatch[1].trim();
            }

            let date = '';
            const dateMatch = content.match(/export_timestamp:\s*"([^"]+)"/);
            if (dateMatch) {
              date = new Date(dateMatch[1]).toLocaleString();
            }

            results.push({ uri: fileUri, fileName: name, goal, date });
          } catch {}
        }
      }
    } catch {
      // Folder might not exist yet
    }

    // Sort newest first
    results.sort((a, b) => b.fileName.localeCompare(a.fileName));
    return results;
  }

  /**
   * Imports a mission log from disk and parses its state
   */
  public async importMissionLog(fileUri: vscode.Uri): Promise<ImportedMissionData> {
    const bytes = await vscode.workspace.fs.readFile(fileUri);
    const content = Buffer.from(bytes).toString('utf8');

    // Attempt to parse embedded base64 state payload first
    const payloadMatch = content.match(/<!-- ANTIGRAVITY_STATE_PAYLOAD:\s*([A-Za-z0-9+/=]+)\s*-->/);
    if (payloadMatch) {
      try {
        const decoded = Buffer.from(payloadMatch[1], 'base64').toString('utf8');
        const state = JSON.parse(decoded);

        const metadata: MissionLogMetadata = {
          version: state.version || '1.0.0',
          exportedAt: state.exportedAt || '',
          goal: state.goal || path.basename(fileUri.fsPath),
          modelName: state.model,
          totalTokens: state.tokens,
          totalAic: state.aic
        };

        const copilotContextSummary = this.distillCopilotContext(state.goal, state.plan, state.walkthrough, state.scratchpad);

        return {
          metadata,
          planContent: state.plan || '',
          walkthroughContent: state.walkthrough || '',
          scratchpadContent: state.scratchpad || { notes: '', keySteps: [], keyComments: [] },
          copilotContextSummary
        };
      } catch {}
    }

    // Fallback: Parse markdown sections manually
    const goalMatch = content.match(/# 🚀 Antigravity Mission Log:\s*(.+)/);
    const goal = goalMatch ? goalMatch[1].trim() : path.basename(fileUri.fsPath);

    const planSection = this.extractSection(content, '## 📋 Implementation Plan', ['## 🔍', '## 🧠']);
    const walkthroughSection = this.extractSection(content, '## 🔍 Walkthrough & Verification Report', ['## 🧠', '<!--']);

    const metadata: MissionLogMetadata = {
      version: '1.0.0',
      exportedAt: new Date().toISOString(),
      goal
    };

    const scratchpadContent: SanitizedScratchpad = {
      notes: '',
      keySteps: [],
      keyComments: []
    };

    const copilotContextSummary = this.distillCopilotContext(goal, planSection, walkthroughSection, scratchpadContent);

    return {
      metadata,
      planContent: planSection,
      walkthroughContent: walkthroughSection,
      scratchpadContent,
      copilotContextSummary
    };
  }

  /**
   * Distills a past mission into a token-efficient knowledge block
   * specifically engineered for injection into GitHub Copilot prompt context.
   */
  public distillCopilotContext(
    goal: string,
    planContent: string,
    walkthroughContent: string,
    scratchpad: SanitizedScratchpad
  ): string {
    let block = `\n==================================================\n`;
    block += `### 📜 HISTORICAL MISSION CONTEXT (Prior Session Work)\n`;
    block += `The user previously executed a related mission in this workspace:\n`;
    block += `- **Prior Objective**: "${goal}"\n`;

    // Extract modified files from plan or walkthrough
    const modifiedFiles = [...new Set([
      ...(planContent.match(/####\s*\[(?:MODIFY|NEW|DELETE)\]\s*\[([^\]]+)\]/gi) || []).map(m => m.replace(/####\s*\[(?:MODIFY|NEW|DELETE)\]\s*\[/i, '').replace(/\]$/, '')),
      ...(walkthroughContent.match(/###\s+([a-zA-Z0-9_\-./\\]+\.[a-zA-Z0-9]+)/gi) || []).map(m => m.replace(/###\s+/i, ''))
    ])];

    if (modifiedFiles.length > 0) {
      block += `- **Files Modified in Prior Session**: ${modifiedFiles.join(', ')}\n`;
    }

    // Extract key decisions from scratchpad
    const decisions = scratchpad.keyComments
      .filter(c => c.type === 'decision' || c.type === 'thought')
      .slice(0, 5)
      .map(c => c.text);

    if (decisions.length > 0) {
      block += `- **Key Architectural Decisions Made**:\n`;
      for (const d of decisions) {
        block += `  * ${d}\n`;
      }
    }

    // Extract executive summary from walkthrough if available
    const wtSummaryMatch = walkthroughContent.match(/# Walkthrough[^\n]*\n\n([\s\S]*?)(?=\n## Changes Made|\n## Verification|$)/);
    if (wtSummaryMatch && wtSummaryMatch[1].trim()) {
      block += `- **Prior Verification Outcome**: ${wtSummaryMatch[1].trim().slice(0, 300)}...\n`;
    }

    block += `CRITICAL INSTRUCTION: Adhere to established architectural patterns, state managers, and naming conventions from this prior mission.\n`;
    block += `==================================================\n\n`;

    return block;
  }

  private extractSection(content: string, header: string, nextHeaders: string[]): string {
    const startIndex = content.indexOf(header);
    if (startIndex === -1) return '';

    const afterHeader = content.substring(startIndex + header.length);
    let endIndex = afterHeader.length;

    for (const nh of nextHeaders) {
      const idx = afterHeader.indexOf(nh);
      if (idx !== -1 && idx < endIndex) {
        endIndex = idx;
      }
    }

    return afterHeader.substring(0, endIndex).trim();
  }
}
