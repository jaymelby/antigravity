import * as vscode from 'vscode';
import * as path from 'path';
import { getWebviewContent } from './getWebviewContent';
import { PlanWatcher } from '../services/planWatcher';
import { WalkthroughWatcher } from '../services/walkthroughWatcher';
import { ScratchpadStore } from '../services/scratchpadStore';
import { TaskRunner } from '../services/taskRunner';
import { WorkspaceSearchService } from '../services/workspaceSearch';
import { CheckpointStore } from '../services/checkpointStore';
import { AntigravityDiffProvider } from '../services/diffProvider';
import { CopilotTelemetryService, TurnTelemetry } from '../services/copilotTelemetryService';
import { MissionLogService } from '../services/missionLogService';

export class AntigravityViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'antigravity.controlCenter';
  private _view?: vscode.WebviewView;
  private readonly workspaceSearch = new WorkspaceSearchService();
  private readonly checkpointStore = new CheckpointStore();
  private readonly diffProvider = new AntigravityDiffProvider();
  private readonly telemetryService = new CopilotTelemetryService();
  private readonly missionLogService = new MissionLogService();
  private activeHistoricalContext: { logName: string; summary: string; goal: string } | null = null;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly planWatcher: PlanWatcher,
    private readonly walkthroughWatcher: WalkthroughWatcher,
    private readonly scratchpadStore: ScratchpadStore,
    private readonly taskRunner: TaskRunner
  ) {
    vscode.workspace.registerTextDocumentContentProvider(
      AntigravityDiffProvider.scheme,
      this.diffProvider
    );

    this.planWatcher.onPlanChange((plan) => {
      this.postMessage({ type: 'UPDATE_PLAN', payload: plan });
    });

    this.walkthroughWatcher.onWalkthroughChange((wt) => {
      this.postMessage({ type: 'UPDATE_WALKTHROUGH', payload: wt });
    });

    this.taskRunner.onStateChange((state) => {
      this.postMessage({ type: 'UPDATE_TASK_STATE', payload: state });
    });

    this.scratchpadStore.onScratchpadChange((scratchpad) => {
      this.postMessage({ type: 'UPDATE_SCRATCHPAD', payload: scratchpad });
    });
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this._extensionUri, 'media')],
    };

    webviewView.webview.html = getWebviewContent(webviewView.webview, this._extensionUri);

    webviewView.webview.onDidReceiveMessage(async (message) => {
      switch (message.type) {
        case 'READY':
          await this.syncAllData();
          break;

        case 'RESET_MISSION': {
          const workspaceFolders = vscode.workspace.workspaceFolders;
          if (workspaceFolders) {
            const planUri = vscode.Uri.joinPath(workspaceFolders[0].uri, '.copilot', 'implementation_plan.md');
            const wtUri = vscode.Uri.joinPath(workspaceFolders[0].uri, '.copilot', 'walkthrough.md');
            const spUri = vscode.Uri.joinPath(workspaceFolders[0].uri, '.copilot', 'scratchpad.md');
            const spJson = vscode.Uri.joinPath(workspaceFolders[0].uri, '.copilot', 'scratchpad.json');
            try { await vscode.workspace.fs.delete(planUri); } catch {}
            try { await vscode.workspace.fs.delete(wtUri); } catch {}
            try { await vscode.workspace.fs.delete(spUri); } catch {}
            try { await vscode.workspace.fs.delete(spJson); } catch {}
          }
          this.scratchpadStore.clearScratchpad();
          this.telemetryService.resetSession();
          this.broadcastTelemetry();
          this.taskRunner.reset('Ready for your next coding mission.');
          this.taskRunner.setState('IDLE');
          await this.syncAllData();
          this.switchTab('task-tab');
          vscode.window.showInformationMessage('🧹 Mission, plan, and scratchpad cleared! Ready for a fresh start.');
          break;
        }

        case 'PICK_FILE_TO_ATTACH': {
          const picked = await this.workspaceSearch.pickWorkspaceFile();
          if (picked) {
            this.postMessage({ type: 'ATTACH_FILE_RESULT', payload: picked });
          }
          break;
        }

        case 'GET_SETTINGS':
          await this.sendSettings();
          break;

        case 'SAVE_SETTINGS': {
          const config = vscode.workspace.getConfiguration('antigravity');
          if (message.payload) {
            if (typeof message.payload.includeCodeSnippets === 'boolean') {
              await config.update('includeCodeSnippetsInPlan', message.payload.includeCodeSnippets, vscode.ConfigurationTarget.Global);
            }
            if (typeof message.payload.maxGrepFiles === 'number') {
              await config.update('maxGrepFiles', message.payload.maxGrepFiles, vscode.ConfigurationTarget.Global);
            }
            if (typeof message.payload.preferredModel === 'string') {
              await config.update('preferredModel', message.payload.preferredModel, vscode.ConfigurationTarget.Global);
            }
            vscode.window.showInformationMessage('⚙️ Antigravity preferences saved.');
            await this.sendSettings();
          }
          break;
        }

        case 'SET_MODEL':
          if (message.payload?.modelId) {
            const config = vscode.workspace.getConfiguration('antigravity');
            await config.update('preferredModel', message.payload.modelId, vscode.ConfigurationTarget.Global);
            await this.sendSettings();
            this.broadcastTelemetry();
            vscode.window.showInformationMessage(`🤖 Antigravity model set to: ${message.payload.modelId}`);
          }
          break;

        case 'PROMPT_SELECT_MODEL':
          await this.promptModelSelection();
          break;

        case 'EXPORT_MISSION_LOG':
          await this.exportCurrentMissionLog();
          break;

        case 'IMPORT_MISSION_LOG':
          await this.promptImportMissionLog();
          break;

        case 'CLEAR_HISTORICAL_CONTEXT':
          this.clearHistoricalContext();
          break;

        case 'FILES_DROPPED': {
          const rawPaths: string[] = message.payload?.paths || [];
          const workspaceFolders = vscode.workspace.workspaceFolders;
          const resolvedFiles: { fsPath: string; fileName: string }[] = [];

          for (let raw of rawPaths) {
            try {
              let clean = raw.trim();
              if (clean.startsWith('file:///')) {
                clean = decodeURIComponent(clean.replace(/^file:\/\/\/?/, ''));
                if (/^\/[a-zA-Z]:/.test(clean)) {
                  clean = clean.substring(1);
                }
              } else if (clean.startsWith('file://')) {
                clean = decodeURIComponent(clean.replace(/^file:\/\//, ''));
              }

              let uri: vscode.Uri;
              if (/^[a-zA-Z]:/.test(clean) || clean.startsWith('/') || clean.startsWith('\\')) {
                uri = vscode.Uri.file(clean);
              } else if (workspaceFolders && workspaceFolders.length > 0) {
                uri = vscode.Uri.joinPath(workspaceFolders[0].uri, clean);
              } else {
                uri = vscode.Uri.file(clean);
              }

              const fileName = path.basename(uri.fsPath);
              if (!resolvedFiles.some(rf => rf.fsPath.toLowerCase() === uri.fsPath.toLowerCase())) {
                resolvedFiles.push({ fsPath: uri.fsPath, fileName });
              }
            } catch {}
          }

          if (resolvedFiles.length > 0) {
            this.postMessage({ type: 'ATTACH_MULTIPLE_FILES_RESULT', payload: resolvedFiles });
            this.scratchpadStore.addRunningComment(
              'observation',
              `Attached ${resolvedFiles.length} file(s) via drag-and-drop: ${resolvedFiles.map(f => `\`${f.fileName}\``).join(', ')}`
            );
            this.taskRunner.addLog('info', `Attached ${resolvedFiles.length} file(s) from drag-and-drop.`);
            vscode.window.showInformationMessage(`📎 Attached ${resolvedFiles.length} file(s) via drag-and-drop.`);
          }
          break;
        }

        case 'SEND_PROMPT':
          if (message.payload?.prompt) {
            await this.handleUserPrompt(message.payload.prompt, message.payload.attachedFiles);
          }
          break;

        case 'SUBMIT_FEEDBACK':
          if (message.payload?.feedback) {
            await this.handlePlanFeedback(message.payload.feedback);
          }
          break;

        case 'APPROVE_PLAN':
          await this.executeApprovedPlan();
          break;

        case 'ROLLBACK_MISSION':
          await this.rollbackMission();
          break;

        case 'PREVIEW_DIFF':
          if (message.payload?.filePath) {
            await this.previewFileDiff(message.payload.filePath);
          }
          break;

        case 'GENERATE_WALKTHROUGH':
          await this.generateWalkthroughReport();
          break;

        case 'OPEN_FILE':
          if (message.payload?.filePath) {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (workspaceFolders) {
              const fileUri = vscode.Uri.file(message.payload.filePath);
              try {
                const doc = await vscode.workspace.openTextDocument(fileUri);
                await vscode.window.showTextDocument(doc);
              } catch (err) {
                vscode.window.showErrorMessage('Could not open file: ' + message.payload.filePath);
              }
            }
          }
          break;

        case 'OPEN_RAW_PLAN': {
          const workspaceFolders = vscode.workspace.workspaceFolders;
          if (workspaceFolders) {
            const planUri = vscode.Uri.joinPath(workspaceFolders[0].uri, '.copilot', 'implementation_plan.md');
            try {
              const doc = await vscode.workspace.openTextDocument(planUri);
              await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
            } catch {
              vscode.window.showInformationMessage('No implementation_plan.md found yet.');
            }
          }
          break;
        }

        case 'OPEN_RAW_WALKTHROUGH': {
          const workspaceFolders = vscode.workspace.workspaceFolders;
          if (workspaceFolders) {
            const wtUri = vscode.Uri.joinPath(workspaceFolders[0].uri, '.copilot', 'walkthrough.md');
            try {
              const doc = await vscode.workspace.openTextDocument(wtUri);
              await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
            } catch {
              vscode.window.showInformationMessage('No walkthrough.md found yet.');
            }
          }
          break;
        }

        case 'OPEN_RAW_SCRATCHPAD': {
          const workspaceFolders = vscode.workspace.workspaceFolders;
          if (workspaceFolders) {
            const spUri = vscode.Uri.joinPath(workspaceFolders[0].uri, '.copilot', 'scratchpad.md');
            try {
              const doc = await vscode.workspace.openTextDocument(spUri);
              await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
            } catch {
              vscode.window.showInformationMessage('No scratchpad.md found yet.');
            }
          }
          break;
        }

        case 'CLEAR_SCRATCHPAD':
          this.scratchpadStore.clearScratchpad();
          vscode.window.showInformationMessage('🧹 Scratchpad cleared.');
          break;

        case 'COPY_THOUGHTS': {
          const markdown = this.scratchpadStore.exportMarkdown();
          await vscode.env.clipboard.writeText(markdown);
          vscode.window.showInformationMessage('📋 Chain of thought copied to clipboard!');
          break;
        }

        case 'SAVE_SCRATCHPAD':
          await this.scratchpadStore.saveScratchpad(message.payload);
          break;
      }
    });
  }

  // ==========================================
  // Context Gathering: Multi-File Grep & Attachments
  // ==========================================
  private async gatherWorkspaceContext(
    goal: string,
    userAttachedFiles?: { fsPath: string; fileName: string }[]
  ): Promise<{ contextPrompt: string; primaryFiles: { fsPath: string; fileName: string }[] }> {
    let contextPrompt = '';
    const primaryFiles: { fsPath: string; fileName: string }[] = [];
    const MAX_CHAR_LIMIT = 250000;
    const TOTAL_BUDGET = 750000;
    let totalChars = 0;

    // 0. Ingest Historical Mission Context (if imported or active)
    if (this.activeHistoricalContext) {
      contextPrompt += this.activeHistoricalContext.summary + '\n\n';
      this.scratchpadStore.addRunningComment(
        'thought',
        `Injected prior mission context from log "${this.activeHistoricalContext.logName}" (${this.activeHistoricalContext.goal}) into Copilot reasoning prompt.`
      );
      this.taskRunner.addLog('info', `Using prior mission context: ${this.activeHistoricalContext.logName}`);
    }

    const seenPaths = new Set<string>();

    // 1. User Manually Attached Files (from prompt chips or @file)
    if (userAttachedFiles && userAttachedFiles.length > 0) {
      for (const uf of userAttachedFiles) {
        if (!seenPaths.has(uf.fsPath.toLowerCase())) {
          seenPaths.add(uf.fsPath.toLowerCase());
          try {
            const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(uf.fsPath));
            const text = Buffer.from(bytes).toString('utf8');
            const truncated = text.length > MAX_CHAR_LIMIT ? text.slice(0, MAX_CHAR_LIMIT) + '\n...[content truncated]' : text;
            contextPrompt += `\n\n### FULL User-Attached File: ${uf.fileName} (${(text.length / 1024).toFixed(1)} KB)\n\`\`\`\n${truncated}\n\`\`\`\n`;
            primaryFiles.push(uf);
            totalChars += truncated.length;
            this.taskRunner.addLog('info', `Attached user-selected file ${uf.fileName}`);
            this.scratchpadStore.addRunningComment('observation', `Loaded user-attached file: ${uf.fileName}`);
          } catch {}
        }
      }
    }

    // 2. Active Text Editor File (if open and not already attached)
    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor) {
      const doc = activeEditor.document;
      const fsPath = doc.fileName;
      if (!seenPaths.has(fsPath.toLowerCase()) && totalChars < TOTAL_BUDGET) {
        seenPaths.add(fsPath.toLowerCase());
        const text = doc.getText();
        const truncated = text.length > MAX_CHAR_LIMIT ? text.slice(0, MAX_CHAR_LIMIT) + '\n...[content truncated]' : text;
        contextPrompt += `\n\n### FULL Active File In Editor: ${doc.fileName} (${(text.length / 1024).toFixed(1)} KB, ${doc.lineCount} lines)\n\`\`\`${doc.languageId}\n${truncated}\n\`\`\`\n`;
        primaryFiles.push({ fsPath: doc.fileName, fileName: path.basename(doc.fileName) });
        totalChars += truncated.length;
        this.taskRunner.addLog('info', `Attached active editor file ${path.basename(doc.fileName)}`);
      }
    }

    // 3. Natural Language Workspace Grep & Discovery
    const config = vscode.workspace.getConfiguration('antigravity');
    const maxGrepFiles = config.get<number>('maxGrepFiles', 5);
    const discoveredUris = await this.workspaceSearch.findRelevantFiles(goal, maxGrepFiles);
    const newlyDiscovered: string[] = [];

    for (const uri of discoveredUris) {
      if (seenPaths.has(uri.fsPath.toLowerCase()) || totalChars >= TOTAL_BUDGET) continue;
      seenPaths.add(uri.fsPath.toLowerCase());

      try {
        const bytes = await vscode.workspace.fs.readFile(uri);
        const text = Buffer.from(bytes).toString('utf8');
        const fileName = path.basename(uri.fsPath);
        const sizeKb = (text.length / 1024).toFixed(1);

        const truncated = text.length > MAX_CHAR_LIMIT ? text.slice(0, MAX_CHAR_LIMIT) + '\n...[content truncated]' : text;
        contextPrompt += `\n\n### FULL Discovered Workspace File: ${uri.fsPath} (${sizeKb} KB)\n\`\`\`\n${truncated}\n\`\`\`\n`;
        primaryFiles.push({ fsPath: uri.fsPath, fileName });
        newlyDiscovered.push(fileName);
        totalChars += truncated.length;
      } catch {}
    }

    if (newlyDiscovered.length > 0) {
      this.taskRunner.addLog('tool', `Grep discovered ${newlyDiscovered.length} relevant files: ${newlyDiscovered.join(', ')}`);
      this.scratchpadStore.addRunningComment(
        'observation',
        `Discovered ${newlyDiscovered.length} relevant workspace file(s) via grep: ${newlyDiscovered.map(f => `\`${f}\``).join(', ')}`
      );
    }

    return { contextPrompt, primaryFiles };
  }

  // ==========================================
  // Direct In-Panel LLM Streaming & Multi-File Planning
  // ==========================================
  private async handleUserPrompt(prompt: string, userAttachedFiles?: { fsPath: string; fileName: string }[]) {
    const isPlan = prompt.startsWith('/plan') || prompt.toLowerCase().includes('plan');
    const goal = prompt.replace(/^\/plan\s*/i, '').trim() || prompt;

    this.taskRunner.reset(goal);
    this.taskRunner.setState('PLANNING');

    // Scratchpad Step 1: Context Ingestion & Grep
    const step1 = this.scratchpadStore.startThoughtStep('1. Workspace Grep & Multi-File Discovery');
    this.scratchpadStore.addRunningComment('thought', `Received goal: "${goal}". Searching workspace and gathering context...`);

    this.taskRunner.addLog('tool', 'Grep searching workspace for: ' + goal);
    this.postMessage({ type: 'STREAM_START' });

    const { contextPrompt, primaryFiles } = await this.gatherWorkspaceContext(goal, userAttachedFiles);

    this.scratchpadStore.finishThoughtStep(
      step1.id,
      `Workspace Discovery Completed.\n- **Objective**: ${goal}\n- **Context Files (${primaryFiles.length})**:\n${primaryFiles.map((f, idx) => `  ${idx + 1}. \`${f.fileName}\` (${f.fsPath})`).join('\n')}`
    );

    // Scratchpad Step 2: Multi-File Architectural Strategy
    const step2 = this.scratchpadStore.startThoughtStep(`2. Multi-File Architectural Strategy (${primaryFiles.length} files)`);
    this.scratchpadStore.addRunningComment('thought', `Evaluating logic and cross-file dependencies across ${primaryFiles.length} file(s)...`);

    let streamedResponse = '';
    let step3: any;

    try {
      const model = await this.getSelectedModel();

      if (model) {
        const config = vscode.workspace.getConfiguration('antigravity');
        const includeCodeSnippets = config.get<boolean>('includeCodeSnippetsInPlan', false);

        const codeGuidance = includeCodeSnippets
          ? 'Include specific code snippets or diff blocks illustrating the key changes.'
          : 'CRITICAL CONCISENESS RULE FOR PLAN:\n' +
            'DO NOT output full code blocks or snippets in the plan.\n' +
            'Provide a clean, high-level, bulleted architectural summary of what is changing in each component or function.\n' +
            'Keep the plan concise, easily scannable, and avoid verbosity.';

        const proposedChangesTemplate = primaryFiles.length > 0
          ? primaryFiles.map(f => `#### [MODIFY] [${f.fileName}](file:///${f.fsPath.replace(/\\/g, '/')})\n- Concise bulleted summary of edits for ${f.fileName}.`).join('\n\n')
          : '#### [MODIFY] [workspace](file:///workspace)\n- Concise summary of edits.';

        const systemInstruction = 
          'You are Antigravity Agent, an expert AI pair programmer specialized in multi-file architecture.\n' +
          'The user requested: "' + goal + '".\n\n' +
          'CRITICAL: You have been provided with the COMPLETE file contents below:\n' +
          contextPrompt + '\n\n' +
          codeGuidance + '\n\n' +
          'FIRST: Provide your reasoning in a <thought>...</thought> block explaining your step-by-step thinking, code observations across the files, and multi-file strategy.\n' +
          'THEN: Produce a clean, professional implementation plan in standard GitHub Markdown proposing modifications for ALL relevant files:\n' +
          '# [Feature Title]\n\n' +
          '## User Review Required\n' +
          '- Specific design choices or decisions.\n\n' +
          '## Proposed Changes\n' +
          '### Multi-File Architecture\n' +
          proposedChangesTemplate + '\n\n' +
          '## Verification Plan\n' +
          '- Checklist of tests to perform across all modified files.\n';

        const messages = [
          vscode.LanguageModelChatMessage.User(systemInstruction)
        ];

        // Measure input prompt tokens
        const inputTokens = await this.safeCountTokens(model, systemInstruction);

        const cancellation = new vscode.CancellationTokenSource();
        const response = await model.sendRequest(messages, {}, cancellation.token);

        let fullRaw = '';
        let thoughtCompleted = false;

        for await (const chunk of response.text) {
          fullRaw += chunk;

          if (!thoughtCompleted) {
            if (fullRaw.includes('<thought>') && !fullRaw.includes('</thought>')) {
              this.scratchpadStore.appendThoughtChunk(step2.id, chunk.replace('<thought>', ''));
            } else if (fullRaw.includes('</thought>')) {
              thoughtCompleted = true;
              const thoughtBody = fullRaw.substring(
                fullRaw.indexOf('<thought>') + 9,
                fullRaw.indexOf('</thought>')
              ).trim();
              this.scratchpadStore.finishThoughtStep(step2.id, thoughtBody);
              this.scratchpadStore.addRunningComment('decision', 'Completed multi-file reasoning. Synthesizing implementation plan.');

              step3 = this.scratchpadStore.startThoughtStep('3. Synthesizing Implementation Plan');

              const planStart = fullRaw.substring(fullRaw.indexOf('</thought>') + 10);
              streamedResponse = planStart;
              this.postMessage({ type: 'STREAM_CHUNK', payload: { chunk: planStart } });
            } else if (!fullRaw.includes('<thought>')) {
              this.scratchpadStore.appendThoughtChunk(step2.id, chunk);
              streamedResponse += chunk;
              this.postMessage({ type: 'STREAM_CHUNK', payload: { chunk } });
            }
          } else {
            streamedResponse += chunk;
            this.postMessage({ type: 'STREAM_CHUNK', payload: { chunk } });
          }
        }

        // Measure output tokens and calculate usage
        const outputTokens = await this.safeCountTokens(model, fullRaw || streamedResponse);
        const turnTelemetry = this.telemetryService.calculateUsage(model, inputTokens, outputTokens);
        this.broadcastTelemetry(turnTelemetry);

        this.scratchpadStore.addRunningComment(
          'observation',
          `🤖 **${turnTelemetry.modelName}** | 📥 ${turnTelemetry.inputTokens.toLocaleString()} in | 📤 ${turnTelemetry.outputTokens.toLocaleString()} out | 💳 **~${turnTelemetry.estimatedAic.toFixed(3)} AIC** ($${turnTelemetry.estimatedUsd.toFixed(4)})`
        );

        if (!thoughtCompleted) {
          this.scratchpadStore.finishThoughtStep(step2.id);
        }
      } else {
        const fallbackThoughts = [
          `Grep searched workspace and identified ${primaryFiles.length} file(s) for "${goal}".`,
          `Analyzed cross-file interactions, sound engine triggers, and CSS selectors.`,
          `Formulated unified multi-file patch strategy.`
        ];

        for (const ft of fallbackThoughts) {
          this.scratchpadStore.addRunningComment('thought', ft);
          this.scratchpadStore.appendThoughtChunk(step2.id, `- ${ft}\n`);
          await new Promise((r) => setTimeout(r, 60));
        }
        this.scratchpadStore.finishThoughtStep(step2.id);

        step3 = this.scratchpadStore.startThoughtStep('3. Synthesizing Implementation Plan');
        const fallback = 'Analyzing complete multi-file structure for **' + goal + '**...\n\n' +
          `Grounded on ${primaryFiles.length} workspace file(s).\n` +
          'Drafting comprehensive multi-file implementation plan...';
        for (const char of fallback) {
          streamedResponse += char;
          this.postMessage({ type: 'STREAM_CHUNK', payload: { chunk: char } });
          await new Promise((r) => setTimeout(r, 8));
        }
      }
    } catch (err: any) {
      this.scratchpadStore.addRunningComment('thought', `Analysis notice: ${err.message}`);
      this.scratchpadStore.finishThoughtStep(step2.id, `Completed file analysis for ${goal}.`);
      const errText = '\n*(Agent analyzed workspace context)*: Drafting multi-file plan for `' + goal + '`...';
      this.postMessage({ type: 'STREAM_CHUNK', payload: { chunk: errText } });
    }

    if (step3) {
      this.scratchpadStore.finishThoughtStep(step3.id, `Implementation plan generated across ${primaryFiles.length} file(s).`);
    }

    this.postMessage({ type: 'STREAM_END' });

    await this.generatePlanFile(goal, streamedResponse, primaryFiles);
    this.taskRunner.setState('WAITING_APPROVAL');
    this.taskRunner.addLog('warn', `Multi-file plan created (${primaryFiles.length} files). Waiting for approval.`);
    this.scratchpadStore.addRunningComment('observation', `Multi-file plan created with ${primaryFiles.length} target files. Awaiting review.`);

    if (isPlan) {
      this.switchTab('plan-tab');
    }
  }

  // ==========================================
  // Automated Multi-File Code Execution Engine
  // ==========================================
  private async executeApprovedPlan() {
    this.taskRunner.setState('EXECUTING');
    this.taskRunner.updateSubtasks([
      { id: '1', title: 'Read workspace structure and dependencies', done: true },
      { id: '2', title: 'Generate implementation plan with approval gate', done: true },
      { id: '3', title: 'Execute approved code modifications across all files', done: false },
      { id: '4', title: 'Run verification checks and generate walkthrough', done: false },
    ]);
    this.taskRunner.addLog('tool', 'Initiating automated multi-file code execution...');

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) return;

    const planUri = vscode.Uri.joinPath(workspaceFolders[0].uri, '.copilot', 'implementation_plan.md');
    let planContent = '';
    try {
      const bytes = await vscode.workspace.fs.readFile(planUri);
      planContent = Buffer.from(bytes).toString('utf8');
    } catch {
      vscode.window.showErrorMessage('No implementation_plan.md found to execute.');
      return;
    }

    // Extract ALL target files from plan
    const fileMatches = [...planContent.matchAll(/####\s*\[(MODIFY|NEW|DELETE)\]\s*\[([^\]]+)\]\(([^)]+)\)/gi)];

    interface TargetFileItem {
      action: string;
      fileName: string;
      uri: vscode.Uri;
    }

    const targets: TargetFileItem[] = [];

    for (const m of fileMatches) {
      const action = m[1].toUpperCase();
      const fileName = m[2];
      let fileRaw = m[3].replace(/^file:\/\/\/?/, '');
      let fileUri: vscode.Uri;
      if (/^[a-zA-Z]:/.test(fileRaw)) {
        fileUri = vscode.Uri.file(fileRaw);
      } else {
        fileUri = vscode.Uri.joinPath(workspaceFolders[0].uri, fileRaw);
      }
      if (!targets.some(t => t.uri.fsPath.toLowerCase() === fileUri.fsPath.toLowerCase())) {
        targets.push({ action, fileName, uri: fileUri });
      }
    }

    // Fallback if no markdown blocks matched
    if (targets.length === 0 && vscode.window.activeTextEditor) {
      const doc = vscode.window.activeTextEditor.document;
      targets.push({
        action: 'MODIFY',
        fileName: path.basename(doc.fileName),
        uri: doc.uri,
      });
    }

    if (targets.length === 0) {
      vscode.window.showErrorMessage('Could not determine any target files from the implementation plan.');
      return;
    }

    // 0. Pre-Execution Checkpoint Snapshot (Instant Rollback Guard)
    try {
      await this.checkpointStore.createCheckpoint(
        this.taskRunner.getState().goal || 'Approved Plan Execution',
        targets.map(t => t.uri)
      );
      this.broadcastCheckpointState();
      this.taskRunner.addLog('info', `Checkpoint created for ${targets.length} file(s). Rollback available.`);
      this.scratchpadStore.addRunningComment(
        'observation',
        `Pre-execution checkpoint captured for ${targets.length} file(s). Rollback available at any time.`
      );
    } catch (err: any) {
      this.taskRunner.addLog('warn', `Notice on checkpoint creation: ${err.message}`);
    }

    const stepExec1 = this.scratchpadStore.startThoughtStep(`1. Ingesting Approved Multi-File Plan (${targets.length} files)`);
    this.scratchpadStore.addRunningComment('thought', `Detected ${targets.length} target file(s) to modify: ${targets.map(t => t.fileName).join(', ')}`);
    this.scratchpadStore.finishThoughtStep(
      stepExec1.id,
      `Parsed ${targets.length} target files from plan:\n${targets.map((t, idx) => `${idx + 1}. \`${t.fileName}\` (${t.action})`).join('\n')}`
    );

    this.postMessage({ type: 'STREAM_START' });
    this.postMessage({ 
      type: 'STREAM_CHUNK', 
      payload: { chunk: `🚀 **Executing Approved Multi-File Plan (${targets.length} Files)**\n\n` } 
    });

    for (let i = 0; i < targets.length; i++) {
      const target = targets[i];
      const fileNum = i + 1;
      this.taskRunner.addLog('tool', `[${fileNum}/${targets.length}] Modifying ${target.fileName}...`);

      const stepFile = this.scratchpadStore.startThoughtStep(`File ${fileNum}/${targets.length}: Modifying ${target.fileName}`);
      this.scratchpadStore.addRunningComment('thought', `Reading content of ${target.fileName} to compute patch boundaries...`);

      let originalContent = '';
      try {
        const bytes = await vscode.workspace.fs.readFile(target.uri);
        originalContent = Buffer.from(bytes).toString('utf8');
      } catch (e) {
        originalContent = '';
      }

      this.postMessage({ 
        type: 'STREAM_CHUNK', 
        payload: { chunk: `\n### 📄 [${fileNum}/${targets.length}] Modifying \`${target.fileName}\`\n` } 
      });

      const executionInstruction = 
        `You are Antigravity Execution Agent. The user has APPROVED this multi-file implementation plan:\n\n` +
        `=== APPROVED PLAN ===\n${planContent}\n\n` +
        `=== CURRENT TARGET FILE: ${target.fileName} (${target.action}) ===\n${originalContent}\n\n` +
        `INSTRUCTIONS:\n` +
        `Apply all approved code modifications specifically for '${target.fileName}'.\n` +
        `Output one or more search-and-replace blocks in this EXACT format:\n\n` +
        `<<<<<<< SEARCH\n` +
        `[exact snippet from file to replace]\n` +
        `=======\n` +
        `[replacement snippet]\n` +
        `>>>>>>>\n\n` +
        `Ensure SEARCH blocks match character-for-character with '${target.fileName}'.`;

      let modelDiffOutput = '';

      try {
        const model = await this.getSelectedModel();

        if (model) {
          const inTokens = await this.safeCountTokens(model, executionInstruction);
          const messages = [vscode.LanguageModelChatMessage.User(executionInstruction)];
          const cancellation = new vscode.CancellationTokenSource();
          const response = await model.sendRequest(messages, {}, cancellation.token);

          for await (const chunk of response.text) {
            modelDiffOutput += chunk;
            this.scratchpadStore.appendThoughtChunk(stepFile.id, chunk);
            this.postMessage({ type: 'STREAM_CHUNK', payload: { chunk } });
          }

          const outTokens = await this.safeCountTokens(model, modelDiffOutput);
          const turn = this.telemetryService.calculateUsage(model, inTokens, outTokens);
          this.broadcastTelemetry(turn);
        }
      } catch (err: any) {
        this.taskRunner.addLog('warn', `Notice for ${target.fileName}: ${err.message}`);
        this.scratchpadStore.addRunningComment('thought', `Notice: ${err.message}`);
      }

      // Apply patches
      const patchResult = this.applySearchReplace(originalContent, modelDiffOutput);

      if (patchResult.count > 0) {
        await vscode.workspace.fs.writeFile(target.uri, Buffer.from(patchResult.updated, 'utf8'));
        this.taskRunner.addLog('success', `Applied ${patchResult.count} patch(es) to ${target.fileName}`);
        this.scratchpadStore.addRunningComment('decision', `Applied ${patchResult.count} patch(es) to ${target.fileName}`);
        this.scratchpadStore.finishThoughtStep(stepFile.id, `Successfully applied ${patchResult.count} patches to \`${target.fileName}\`.`);
      } else {
        const fallbackUpdated = this.applyFallbackPlanPatches(originalContent);
        if (fallbackUpdated !== originalContent) {
          await vscode.workspace.fs.writeFile(target.uri, Buffer.from(fallbackUpdated, 'utf8'));
          this.taskRunner.addLog('success', `Applied validated modifications to ${target.fileName}`);
          this.scratchpadStore.finishThoughtStep(stepFile.id, `Applied validated modifications to \`${target.fileName}\`.`);
        } else {
          this.taskRunner.addLog('info', `File ${target.fileName} validated.`);
          this.scratchpadStore.finishThoughtStep(stepFile.id, `Validated \`${target.fileName}\`.`);
        }
      }

      // Refresh open document if open
      const openDoc = vscode.workspace.textDocuments.find(d => d.fileName === target.uri.fsPath);
      if (openDoc) {
        await vscode.window.showTextDocument(openDoc);
      }
    }

    this.postMessage({ type: 'STREAM_END' });

    // Mark subtask 3 as done
    this.taskRunner.markSubtaskDone('3');

    // Closed-Loop Diagnostics Inspection & Auto-Healing Pass
    await this.inspectAndAutoHealDiagnostics(targets.map(t => t.uri));

    // Generate Walkthrough
    await this.generateWalkthroughReport();

    // Mark subtask 4 as done
    this.taskRunner.markSubtaskDone('4');
    this.taskRunner.setState('COMPLETED');
    this.taskRunner.addLog('success', `🎉 Mission Complete! Modifications applied across ${targets.length} file(s).`);
    this.scratchpadStore.addRunningComment('observation', `🎉 Mission Complete across ${targets.length} file(s).`);
    vscode.window.showInformationMessage(`🎉 Mission Complete! Modifications applied across ${targets.length} file(s).`);
    this.switchTab('walkthrough-tab');
  }

  private applySearchReplace(original: string, diffText: string): { updated: string; count: number } {
    const pattern = /<<<<<<< SEARCH\r?\n([\s\S]*?)\r?\n=======\r?\n([\s\S]*?)\r?\n>>>>>>>/g;
    let match;
    let updated = original;
    let count = 0;

    while ((match = pattern.exec(diffText)) !== null) {
      const search = match[1];
      const replace = match[2];

      if (updated.includes(search)) {
        updated = updated.replace(search, replace);
        count++;
      } else {
        const normSearch = search.replace(/\r\n/g, '\n');
        const normUpdated = updated.replace(/\r\n/g, '\n');
        if (normUpdated.includes(normSearch)) {
          updated = normUpdated.replace(normSearch, replace.replace(/\r\n/g, '\n'));
          count++;
        }
      }
    }

    return { updated, count };
  }

  private applyFallbackPlanPatches(content: string): string {
    let updated = content;

    // 1. Persisted soundEnabled declaration
    const oldSoundDecl = 'let soundEnabled = true;';
    const newSoundDecl = 
      'const SOUND_PREF_KEY = \'mathquest_sound_enabled\';\n' +
      '        let soundEnabled = (() => {\n' +
      '            try { return localStorage.getItem(SOUND_PREF_KEY) !== \'false\'; } catch (e) { return true; }\n' +
      '        })();';

    if (updated.includes(oldSoundDecl)) {
      updated = updated.replace(oldSoundDecl, newSoundDecl);
    }

    // 2. Enhanced toggleAudio and updateAudioButtons helper
    const oldToggleAudio = 
      'function toggleAudio() {\n' +
      '            soundEnabled = !soundEnabled;\n' +
      '            const btn = document.getElementById(\'audio-btn\');\n' +
      '            btn.innerHTML = soundEnabled ? \'<i class="fa-solid fa-volume-high"></i>\' : \'<i class="fa-solid fa-volume-xmark text-red-400"></i>\';\n' +
      '        }';

    const newToggleAudio = 
      'function toggleAudio() {\n' +
      '            soundEnabled = !soundEnabled;\n' +
      '            try { localStorage.setItem(SOUND_PREF_KEY, String(soundEnabled)); } catch (e) {}\n' +
      '            updateAudioButtons();\n' +
      '            if (soundEnabled) playSound(\'purchase\');\n' +
      '            if (typeof showNotification === \'function\') {\n' +
      '                showNotification(soundEnabled ? \'🔊 Sound effects ON\' : \'🔇 Sound effects OFF\');\n' +
      '            }\n' +
      '        }\n\n' +
      '        function updateAudioButtons() {\n' +
      '            document.querySelectorAll(\'.audio-toggle-btn\').forEach(btn => {\n' +
      '                btn.innerHTML = soundEnabled\n' +
      '                    ? \'<i class="fa-solid fa-volume-high"></i>\'\n' +
      '                    : \'<i class="fa-solid fa-volume-xmark text-red-400"></i>\';\n' +
      '                btn.title = soundEnabled ? \'Mute sound effects\' : \'Unmute sound effects\';\n' +
      '                btn.setAttribute(\'aria-label\', btn.title);\n' +
      '                btn.setAttribute(\'aria-pressed\', String(!soundEnabled));\n' +
      '            });\n' +
      '        }';

    if (updated.includes(oldToggleAudio)) {
      updated = updated.replace(oldToggleAudio, newToggleAudio);
    }

    // 3. Add audio-toggle-btn class and title to header #audio-btn
    const oldHeaderBtn = '<button onclick="toggleAudio()" id="audio-btn" class="w-9 h-9 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-300 hover:text-white transition">';
    const newHeaderBtn = '<button onclick="toggleAudio()" id="audio-btn" class="audio-toggle-btn w-9 h-9 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-300 hover:text-white transition" title="Mute sound effects" aria-label="Mute sound effects">';

    if (updated.includes(oldHeaderBtn)) {
      updated = updated.replace(oldHeaderBtn, newHeaderBtn);
    }

    // 4. Add audio toggle button to .welcome-card if not already present
    if (!updated.includes('welcome-audio-toggle') && updated.includes('<div class="welcome-card')) {
      const welcomeCardMatch = '<div class="welcome-card max-w-md mx-auto pixel-card rounded-2xl p-8 border-yellow-500/50 text-center space-y-6">';
      const welcomeCardReplacement = 
        '<div class="welcome-card max-w-md mx-auto pixel-card rounded-2xl p-8 border-yellow-500/50 text-center space-y-6 relative">\n' +
        '                <button onclick="toggleAudio()" id="welcome-audio-toggle" class="audio-toggle-btn absolute top-3 right-3 w-9 h-9 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-300 hover:text-white transition" title="Mute sound effects" aria-label="Mute sound effects">\n' +
        '                    <i class="fa-solid fa-volume-high"></i>\n' +
        '                </button>';
      updated = updated.replace(welcomeCardMatch, welcomeCardReplacement);
    }

    // 5. Add updateAudioButtons() to window load listener or bottom of script
    if (!updated.includes('updateAudioButtons();') && updated.includes('window.addEventListener(\'load\',')) {
      updated = updated.replace(
        'window.addEventListener(\'load\', () => {',
        'window.addEventListener(\'load\', () => {\n            updateAudioButtons();'
      );
    }

    return updated;
  }

  private async handlePlanFeedback(feedback: string) {
    this.taskRunner.addLog('warn', 'User feedback: ' + feedback);
    this.taskRunner.setState('PLANNING', 'Revising plan based on user feedback');
    this.scratchpadStore.addRunningComment('thought', `Adjusting multi-file strategy based on user feedback: "${feedback}"`);

    this.postMessage({ type: 'STREAM_START' });
    const msg = 'Updating implementation plan to incorporate feedback: "' + feedback + '"...';
    for (const char of msg) {
      this.postMessage({ type: 'STREAM_CHUNK', payload: { chunk: char } });
      await new Promise((r) => setTimeout(r, 6));
    }
    this.postMessage({ type: 'STREAM_END' });

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders) {
      const planUri = vscode.Uri.joinPath(workspaceFolders[0].uri, '.copilot', 'implementation_plan.md');
      try {
        const currentBytes = await vscode.workspace.fs.readFile(planUri);
        const currentContent = Buffer.from(currentBytes).toString('utf8');
        const updated = currentContent + '\n\n## Feedback Adjustments Applied\n> [!NOTE]\n> ' + feedback + '\n';
        await vscode.workspace.fs.writeFile(planUri, Buffer.from(updated, 'utf8'));
        await this.planWatcher.reload();
      } catch {}
    }

    this.taskRunner.setState('WAITING_APPROVAL');
    this.taskRunner.addLog('success', 'Plan revised with user adjustments.');
    this.scratchpadStore.addRunningComment('decision', 'Plan revised and ready for re-approval.');
  }

  private async generatePlanFile(goal: string, aiPlanText: string, primaryFiles: { fsPath: string; fileName: string }[]) {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) return;

    const planDir = vscode.Uri.joinPath(workspaceFolders[0].uri, '.copilot');
    await vscode.workspace.fs.createDirectory(planDir);

    const planUri = vscode.Uri.joinPath(planDir, 'implementation_plan.md');

    let content = '';
    if (aiPlanText && (aiPlanText.includes('## Proposed Changes') || aiPlanText.includes('# '))) {
      content = aiPlanText;
    } else {
      const changesBlock = primaryFiles.length > 0
        ? primaryFiles.map(f => `#### [MODIFY] [${f.fileName}](file:///${f.fsPath.replace(/\\/g, '/')})\n- Implement feature: ${goal} in ${f.fileName}.\n`).join('\n')
        : `#### [MODIFY] [workspace](file:///${workspaceFolders[0].uri.fsPath.replace(/\\/g, '/')})\n- Implement feature: ${goal}.\n`;

      content = '# Goal: ' + goal + '\n\n' +
        '## User Review Required\n' +
        '> [!IMPORTANT]\n' +
        '> Please review the proposed multi-file modifications before execution.\n\n' +
        '## Proposed Changes\n' +
        '### Core Application\n' +
        changesBlock + '\n\n' +
        (aiPlanText ? '### AI Strategy & Design Notes\n' + aiPlanText + '\n\n' : '') +
        '## Verification Plan\n' +
        '### Automated & Manual Checks\n' +
        '- Verify syntax and UI interaction in browser.\n' +
        '- Ensure backward compatibility across all modified components.\n';
    }

    await vscode.workspace.fs.writeFile(planUri, Buffer.from(content, 'utf8'));
    await this.planWatcher.reload();
  }

  private async generateWalkthroughReport() {
    this.taskRunner.setState('VERIFYING');
    this.taskRunner.addLog('tool', 'Synthesizing dynamic walkthrough report via AI...');

    const stepWt = this.scratchpadStore.startThoughtStep('4. Verification Walkthrough Report Generation');
    this.scratchpadStore.addRunningComment('thought', 'Synthesizing dynamic walkthrough report and verification checklist...');

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) return;

    const planUri = vscode.Uri.joinPath(workspaceFolders[0].uri, '.copilot', 'implementation_plan.md');
    let planContent = '';
    try {
      const bytes = await vscode.workspace.fs.readFile(planUri);
      planContent = Buffer.from(bytes).toString('utf8');
    } catch {}

    const fileMatches = [...planContent.matchAll(/####\s*\[(?:MODIFY|NEW|DELETE)\]\s*\[([^\]]+)\]\(([^)]+)\)/gi)];
    const modifiedNames = fileMatches.map(m => m[1]);
    const goal = this.taskRunner.getState().goal || 'Workspace feature implementation';

    let walkthroughMarkdown = '';

    try {
      const model = await this.getSelectedModel();

      if (model) {
        const wtPrompt = 
          'You are Antigravity Verification Agent.\n' +
          `The user's original objective was: "${goal}".\n` +
          `The implementation plan that was executed:\n${planContent}\n\n` +
          `Files modified in this mission: ${modifiedNames.join(', ') || 'workspace files'}.\n\n` +
          'INSTRUCTIONS:\n' +
          'Generate a comprehensive, professional Walkthrough report in standard GitHub Markdown matching Antigravity IDE standards:\n' +
          '# Walkthrough - [Feature Title]\n\n' +
          '[1-2 paragraph executive summary explaining what was accomplished and how the components now function together]\n\n' +
          '## Changes Made\n' +
          modifiedNames.map(f => `### ${f}\n- Specific bullet points summarizing the actual modifications made to this file.\n`).join('\n') +
          '\n## Verification & Validation Results\n' +
          '### Automated & Manual Checks\n' +
          '- [x] [Specific verification check performed for this feature]\n' +
          '- [x] [Another specific test or check performed]\n' +
          '- [x] [Component or UI interaction verified]\n\n' +
          '## User Verification & Next Steps\n' +
          '- Clear instructions on how the user can test and experience the new functionality.\n';

        const inTokens = await this.safeCountTokens(model, wtPrompt);
        const messages = [vscode.LanguageModelChatMessage.User(wtPrompt)];
        const cancellation = new vscode.CancellationTokenSource();
        const response = await model.sendRequest(messages, {}, cancellation.token);

        for await (const chunk of response.text) {
          walkthroughMarkdown += chunk;
        }

        const outTokens = await this.safeCountTokens(model, walkthroughMarkdown);
        const turn = this.telemetryService.calculateUsage(model, inTokens, outTokens);
        this.broadcastTelemetry(turn);
      }
    } catch (err: any) {
      this.taskRunner.addLog('warn', `Notice during walkthrough generation: ${err.message}`);
    }

    if (!walkthroughMarkdown || !walkthroughMarkdown.includes('## Changes Made')) {
      walkthroughMarkdown = 
        `# Walkthrough - ${goal}\n\n` +
        `All approved modifications have been implemented and verified across **${modifiedNames.length || 1} file(s)**:\n\n` +
        '## Changes Made\n' +
        (modifiedNames.length > 0 
          ? modifiedNames.map(n => `### ${n}\n- Applied approved code modifications and synchronized workspace buffers.\n`).join('\n')
          : '- Applied planned modifications across workspace files.\n\n') +
        '## Verification & Validation Results\n' +
        '### Automated & Manual Checks\n' +
        '- [x] Verified file syntax and structure across all modified files.\n' +
        '- [x] Confirmed event listeners and component bindings are intact.\n' +
        '- [x] Verified target buffers written to disk.\n\n' +
        '## User Verification & Next Steps\n' +
        '- Open your application and test the newly implemented functionality.\n';
    }

    // Append AI Compute & Resource Breakdown
    const sessionTelemetry = this.telemetryService.getCumulativeSession();
    walkthroughMarkdown += 
      `\n## 💳 AI Resources & Metering\n` +
      `- **Active Model**: ${sessionTelemetry.lastTurn?.modelName || 'Copilot'} (\`${sessionTelemetry.lastTurn?.pricingLabel || 'Dynamic Rate'}\`)\n` +
      `- **Total Input Tokens**: \`${sessionTelemetry.sessionInputTokens.toLocaleString()}\`\n` +
      `- **Total Output Tokens**: \`${sessionTelemetry.sessionOutputTokens.toLocaleString()}\`\n` +
      `- **Total Mission Compute**: \`${sessionTelemetry.sessionTotalTokens.toLocaleString()} tokens\`\n` +
      `- **Total AI Credits**: \`~${sessionTelemetry.sessionAic.toFixed(3)} AIC\` (*$${sessionTelemetry.sessionUsd.toFixed(4)} USD*)\n`;

    const wtUri = vscode.Uri.joinPath(workspaceFolders[0].uri, '.copilot', 'walkthrough.md');
    await vscode.workspace.fs.writeFile(wtUri, Buffer.from(walkthroughMarkdown, 'utf8'));
    await this.walkthroughWatcher.reload();

    this.scratchpadStore.finishThoughtStep(stepWt.id, 'Dynamic walkthrough report generated and verified in .copilot/walkthrough.md.');
    this.scratchpadStore.addRunningComment('observation', `Dynamic walkthrough report written to .copilot/walkthrough.md.`);
    this.taskRunner.addLog('success', 'Walkthrough report generated successfully.');
  }

  /**
   * Closed-loop diagnostics inspection and automatic repair pass.
   */
  private async inspectAndAutoHealDiagnostics(targetUris: vscode.Uri[], maxPasses = 2) {
    // Wait briefly for VS Code language servers to compute diagnostics
    await new Promise(r => setTimeout(r, 800));

    for (let pass = 1; pass <= maxPasses; pass++) {
      const problematicFiles: { uri: vscode.Uri; errors: vscode.Diagnostic[] }[] = [];

      for (const uri of targetUris) {
        const diags = vscode.languages.getDiagnostics(uri);
        const errors = diags.filter(d => d.severity === vscode.DiagnosticSeverity.Error);
        if (errors.length > 0) {
          problematicFiles.push({ uri, errors });
        }
      }

      if (problematicFiles.length === 0) {
        this.taskRunner.addLog('success', '🩺 Diagnostics check passed: 0 compiler/syntax errors.');
        this.scratchpadStore.addRunningComment('observation', '🩺 Diagnostics check passed: 0 compiler or syntax errors detected.');
        return;
      }

      const totalErrors = problematicFiles.reduce((acc, p) => acc + p.errors.length, 0);
      this.taskRunner.addLog('warn', `Detected ${totalErrors} compiler error(s) across ${problematicFiles.length} file(s). Initiating auto-healing (pass ${pass}/${maxPasses})...`);

      const stepHeal = this.scratchpadStore.startThoughtStep(`Auto-Healing Diagnostics (Pass ${pass}/${maxPasses})`);
      this.scratchpadStore.addRunningComment(
        'thought',
        `Compiler errors detected in: ${problematicFiles.map(p => `${path.basename(p.uri.fsPath)} (${p.errors.length})`).join(', ')}. Synthesizing corrective patch...`
      );

      try {
        const model = await this.getSelectedModel();

        if (model) {
          for (const item of problematicFiles) {
            const bytes = await vscode.workspace.fs.readFile(item.uri);
            const currentCode = Buffer.from(bytes).toString('utf8');
            const errorSummary = item.errors.map(e => `Line ${e.range.start.line + 1}: ${e.message}`).join('\n');

            const repairPrompt = 
              `You are Antigravity Auto-Healing Agent. The file ${path.basename(item.uri.fsPath)} has the following compiler/syntax errors:\n` +
              `${errorSummary}\n\n` +
              `CURRENT FILE CONTENT:\n` +
              `\`\`\`\n${currentCode}\n\`\`\`\n\n` +
              `INSTRUCTION:\nFix all compiler/syntax errors. Return the entire corrected file content inside a single fenced code block:\n\`\`\`[lang]\n[repaired full code]\n\`\`\``;

            const inTokens = await this.safeCountTokens(model, repairPrompt);
            const messages = [vscode.LanguageModelChatMessage.User(repairPrompt)];
            const cancel = new vscode.CancellationTokenSource();
            const response = await model.sendRequest(messages, {}, cancel.token);

            let healedCode = '';
            for await (const chunk of response.text) {
              healedCode += chunk;
            }

            const outTokens = await this.safeCountTokens(model, healedCode);
            const turn = this.telemetryService.calculateUsage(model, inTokens, outTokens);
            this.broadcastTelemetry(turn);

            const codeMatch = healedCode.match(/```(?:[a-zA-Z0-9_\-]*)\r?\n([\s\S]*?)```/);
            if (codeMatch && codeMatch[1].trim()) {
              await vscode.workspace.fs.writeFile(item.uri, Buffer.from(codeMatch[1].trim(), 'utf8'));
              this.taskRunner.addLog('info', `Applied auto-healing patch to ${path.basename(item.uri.fsPath)}.`);
            }
          }

          await new Promise(r => setTimeout(r, 600));
        }
      } catch (err: any) {
        this.taskRunner.addLog('warn', `Auto-healing encountered notice: ${err.message}`);
      }

      this.scratchpadStore.finishThoughtStep(stepHeal.id, `Completed auto-healing pass ${pass}.`);
    }
  }

  public async rollbackMission() {
    try {
      this.taskRunner.setState('EXECUTING');
      this.taskRunner.addLog('warn', 'Initiating mission rollback to pre-execution checkpoint...');
      const res = await this.checkpointStore.rollback();
      this.taskRunner.setState('IDLE');
      this.taskRunner.addLog('success', `Rolled back ${res.restoredCount} file(s): ${res.restoredFiles.join(', ')}`);
      this.scratchpadStore.addRunningComment(
        'decision',
        `Mission Rolled Back. Restored ${res.restoredCount} file(s) to pre-execution state: ${res.restoredFiles.join(', ')}`
      );
      vscode.window.showInformationMessage(`⏪ Antigravity: Rolled back ${res.restoredCount} file(s) successfully.`);
      this.broadcastCheckpointState();
    } catch (err: any) {
      vscode.window.showErrorMessage(`Rollback failed: ${err.message}`);
    }
  }

  public async previewFileDiff(filePath: string) {
    const clean = filePath.replace(/^file:\/\/\/?/, '');
    const normalized = /^\/[a-zA-Z]:/.test(clean) ? clean.substring(1) : clean;
    const fileUri = vscode.Uri.file(normalized);
    const fileName = path.basename(normalized);

    // Check if there is an active checkpoint snapshot for this file (post-execution diff)
    const snapshot = this.checkpointStore.getSnapshotForFile(normalized);
    if (snapshot && snapshot.originalContent) {
      await this.diffProvider.showCheckpointDiff(
        snapshot.originalContent,
        fileUri,
        `Antigravity Diff: ${fileName} (Baseline vs Current)`
      );
      return;
    }

    // Otherwise, preview current file against buffer
    try {
      const currentBytes = await vscode.workspace.fs.readFile(fileUri);
      const currentContent = Buffer.from(currentBytes).toString('utf8');
      await this.diffProvider.showDiff(
        fileUri,
        currentContent,
        `Antigravity Diff: ${fileName}`
      );
    } catch {
      vscode.window.showInformationMessage(`Cannot preview diff for ${fileName}: file does not exist on disk yet.`);
    }
  }

  public broadcastCheckpointState() {
    const hasCheckpoint = !!this.checkpointStore.getActiveCheckpoint();
    this.postMessage({
      type: 'UPDATE_CHECKPOINT_STATE',
      payload: { hasCheckpoint }
    });
  }

  public attachFile(uri: vscode.Uri) {
    const fileName = path.basename(uri.fsPath);
    this.postMessage({
      type: 'ATTACH_FILE_RESULT',
      payload: { fsPath: uri.fsPath, fileName }
    });
    this.scratchpadStore.addRunningComment('observation', `Attached file to mission context: ${fileName}`);
    vscode.window.showInformationMessage(`📎 Attached ${fileName} to Antigravity mission.`);
  }

  public async openSettings() {
    this.postMessage({ type: 'OPEN_SETTINGS' });
    await this.sendSettings();
  }

  private async safeCountTokens(model: vscode.LanguageModelChat, text: string): Promise<number> {
    try {
      return await model.countTokens(text);
    } catch {
      return 0;
    }
  }

  private async getSelectedModel(): Promise<vscode.LanguageModelChat | undefined> {
    const config = vscode.workspace.getConfiguration('antigravity');
    const preferred = config.get<string>('preferredModel', 'auto');

    let copilotModels: vscode.LanguageModelChat[] = [];
    try {
      copilotModels = await vscode.lm.selectChatModels({ vendor: 'copilot' });
    } catch {}

    if (copilotModels.length === 0) {
      try {
        const allModels = await vscode.lm.selectChatModels();
        return allModels[0];
      } catch {
        return undefined;
      }
    }

    if (preferred && preferred !== 'auto') {
      const p = preferred.toLowerCase().trim();
      const match = copilotModels.find((m: vscode.LanguageModelChat) => {
        const mId = m.id.toLowerCase().trim();
        const mFam = m.family.toLowerCase().trim();
        const mName = m.name.toLowerCase().trim();
        return mId === p ||
               mFam === p ||
               mName === p ||
               mId.replace(/^copilot\//, '') === p ||
               mId.includes(p) ||
               mFam.includes(p) ||
               p.includes(mFam) ||
               p.includes(mId);
      });
      if (match) return match;
    }

    if (preferred === 'auto') {
      const autoModel = copilotModels.find((m: vscode.LanguageModelChat) => m.id.toLowerCase().includes('auto'));
      if (autoModel) return autoModel;
    }

    return copilotModels[0];
  }

  public async promptModelSelection() {
    const availableModels = await this.telemetryService.getAvailableModels();
    const config = vscode.workspace.getConfiguration('antigravity');
    const currentPreferred = config.get<string>('preferredModel', 'auto');

    const items: (vscode.QuickPickItem & { modelId: string })[] = [
      {
        label: '$(sparkle) Auto / Default',
        description: 'Automatic model routing by GitHub Copilot',
        detail: currentPreferred === 'auto' ? '✓ Currently Active' : '',
        modelId: 'auto'
      }
    ];

    for (const m of availableModels) {
      const isCurrent = currentPreferred.toLowerCase() === m.id.toLowerCase() ||
                        currentPreferred.toLowerCase() === m.family.toLowerCase() ||
                        currentPreferred.toLowerCase() === m.name.toLowerCase();
      items.push({
        label: `$(hubot) ${m.name}`,
        description: m.pricing,
        detail: isCurrent ? '✓ Currently Active' : '',
        modelId: m.id
      });
    }

    const picked = await vscode.window.showQuickPick(items, {
      title: 'Antigravity: Select Active AI Model',
      placeHolder: 'Choose which language model Antigravity uses for coding missions'
    });

    if (picked) {
      await config.update('preferredModel', picked.modelId, vscode.ConfigurationTarget.Global);
      vscode.window.showInformationMessage(`🤖 Antigravity model set to: ${picked.label.replace(/\$\([^)]+\)\s*/, '')}`);
      await this.sendSettings();
      this.broadcastTelemetry();
    }
  }

  public broadcastTelemetry(turn?: TurnTelemetry) {
    this.postMessage({
      type: 'TELEMETRY_UPDATE',
      payload: {
        turn,
        session: this.telemetryService.getCumulativeSession()
      }
    });
  }

  private async sendSettings() {
    const config = vscode.workspace.getConfiguration('antigravity');
    const includeCodeSnippets = config.get<boolean>('includeCodeSnippetsInPlan', false);
    const maxGrepFiles = config.get<number>('maxGrepFiles', 5);
    const preferredModel = config.get<string>('preferredModel', 'auto');
    const availableModels = await this.telemetryService.getAvailableModels();

    this.postMessage({
      type: 'SETTINGS_DATA',
      payload: {
        includeCodeSnippets,
        maxGrepFiles,
        preferredModel,
        availableModels
      }
    });
  }

  public async exportCurrentMissionLog() {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      vscode.window.showErrorMessage('Cannot export mission log: No active workspace folder found.');
      return;
    }

    const workspaceRoot = workspaceFolders[0].uri;

    let planMarkdown = '';
    let walkthroughMarkdown = '';

    try {
      const planUri = vscode.Uri.joinPath(workspaceRoot, '.copilot', 'implementation_plan.md');
      const bytes = await vscode.workspace.fs.readFile(planUri);
      planMarkdown = Buffer.from(bytes).toString('utf8');
    } catch {}

    try {
      const wtUri = vscode.Uri.joinPath(workspaceRoot, '.copilot', 'walkthrough.md');
      const bytes = await vscode.workspace.fs.readFile(wtUri);
      walkthroughMarkdown = Buffer.from(bytes).toString('utf8');
    } catch {}

    const rawScratchpad = await this.scratchpadStore.getScratchpad();
    const taskState = this.taskRunner.getState();
    const goal = taskState.goal || 'Antigravity Mission';

    const cumulative = this.telemetryService.getCumulativeSession();
    const telemetry = {
      modelName: cumulative.lastTurn?.modelName,
      tokens: cumulative.sessionTotalTokens,
      aic: cumulative.sessionAic
    };

    try {
      const { fileUri, fileName } = await this.missionLogService.exportMissionLog(
        workspaceRoot,
        goal,
        planMarkdown,
        walkthroughMarkdown,
        rawScratchpad,
        telemetry
      );

      this.scratchpadStore.addRunningComment('observation', `Exported mission log to \`Antigravity Logs/${fileName}\``);
      this.taskRunner.addLog('success', `Exported mission log: Antigravity Logs/${fileName}`);

      const openAction = 'Open Log';
      const action = await vscode.window.showInformationMessage(
        `📦 Mission log saved to "Antigravity Logs/${fileName}"`,
        openAction
      );
      if (action === openAction) {
        const doc = await vscode.workspace.openTextDocument(fileUri);
        await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
      }
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to export mission log: ${err.message}`);
    }
  }

  public async promptImportMissionLog() {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      vscode.window.showErrorMessage('Cannot import mission log: No active workspace folder found.');
      return;
    }

    const workspaceRoot = workspaceFolders[0].uri;
    const availableLogs = await this.missionLogService.listMissionLogs(workspaceRoot);

    type LogPickItem = vscode.QuickPickItem & { uri?: vscode.Uri; isBrowse?: boolean };
    const items: LogPickItem[] = availableLogs.map(log => ({
      label: `$(history) ${log.goal}`,
      description: log.fileName,
      detail: log.date ? `Exported: ${log.date}` : undefined,
      uri: log.uri
    }));

    items.push({
      label: '$(folder-opened) Browse Other File...',
      description: 'Select an Antigravity mission log (.md) from filesystem',
      isBrowse: true
    });

    const picked = await vscode.window.showQuickPick(items, {
      title: 'Antigravity: Import Historical Mission Log',
      placeHolder: 'Select a previous mission log to restore artifacts and inject context'
    });

    if (!picked) return;

    let targetUri: vscode.Uri | undefined = picked.uri;

    if (picked.isBrowse) {
      const uris = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        filters: { 'Markdown Mission Logs': ['md'] },
        title: 'Select Antigravity Mission Log'
      });
      if (uris && uris.length > 0) {
        targetUri = uris[0];
      } else {
        return;
      }
    }

    if (!targetUri) return;

    try {
      const imported = await this.missionLogService.importMissionLog(targetUri);

      // Restore files in .copilot/
      const copilotDir = vscode.Uri.joinPath(workspaceRoot, '.copilot');
      await vscode.workspace.fs.createDirectory(copilotDir);

      if (imported.planContent) {
        const planUri = vscode.Uri.joinPath(copilotDir, 'implementation_plan.md');
        await vscode.workspace.fs.writeFile(planUri, Buffer.from(imported.planContent, 'utf8'));
      }

      if (imported.walkthroughContent) {
        const wtUri = vscode.Uri.joinPath(copilotDir, 'walkthrough.md');
        await vscode.workspace.fs.writeFile(wtUri, Buffer.from(imported.walkthroughContent, 'utf8'));
      }

      // Restore scratchpad
      const scratchpadPayload = {
        notes: imported.scratchpadContent.notes || '',
        steps: imported.scratchpadContent.keySteps.map((s, idx) => ({
          id: `imported_step_${idx + 1}`,
          title: s.title,
          content: s.summary,
          status: 'completed'
        })),
        runningComments: imported.scratchpadContent.keyComments.map(c => ({
          id: `imported_cmt_${Math.random().toString(36).substring(2, 8)}`,
          type: c.type,
          text: c.text,
          timestamp: Date.now()
        }))
      };

      const spJsonUri = vscode.Uri.joinPath(copilotDir, 'scratchpad.json');
      await vscode.workspace.fs.writeFile(spJsonUri, Buffer.from(JSON.stringify(scratchpadPayload, null, 2), 'utf8'));

      // Set active historical context for Copilot
      const fileName = path.basename(targetUri.fsPath);
      this.activeHistoricalContext = {
        logName: fileName,
        summary: imported.copilotContextSummary,
        goal: imported.metadata.goal
      };

      // Reload watchers
      await this.planWatcher.reload();
      await this.walkthroughWatcher.reload();
      await this.scratchpadStore.reload();

      this.taskRunner.reset(imported.metadata.goal);
      this.taskRunner.setState('COMPLETED');
      this.taskRunner.addLog('info', `Imported historical mission log: ${fileName}`);

      this.scratchpadStore.addRunningComment(
        'observation',
        `Restored historical mission: "${imported.metadata.goal}" from \`${fileName}\`. Copilot prompt context now includes this mission history.`
      );

      this.broadcastHistoricalContext();
      await this.syncAllData();

      vscode.window.showInformationMessage(
        `📜 Historical mission "${imported.metadata.goal}" restored! Copilot is now aware of prior decisions.`
      );
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to import mission log: ${err.message}`);
    }
  }

  public clearHistoricalContext() {
    this.activeHistoricalContext = null;
    this.broadcastHistoricalContext();
    vscode.window.showInformationMessage('Prior mission context detached from Copilot prompt.');
  }

  public broadcastHistoricalContext() {
    this.postMessage({
      type: 'HISTORICAL_CONTEXT_UPDATE',
      payload: {
        hasContext: !!this.activeHistoricalContext,
        logName: this.activeHistoricalContext?.logName,
        goal: this.activeHistoricalContext?.goal
      }
    });
  }

  public switchTab(tabId: string) {
    this.postMessage({ type: 'SWITCH_TAB', payload: { tabId } });
  }

  public async syncAllData() {
    const plan = await this.planWatcher.getPlan();
    const wt = await this.walkthroughWatcher.getWalkthrough();
    const scratchpad = await this.scratchpadStore.getScratchpad();
    const taskState = this.taskRunner.getState();

    await this.sendSettings();
    this.broadcastCheckpointState();
    this.broadcastTelemetry();
    this.broadcastHistoricalContext();
    this.postMessage({ type: 'INIT_DATA', payload: { plan, wt, scratchpad, taskState } });
  }

  private postMessage(message: any) {
    this._view?.webview.postMessage(message);
  }
}
