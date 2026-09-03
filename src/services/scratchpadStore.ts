import * as vscode from 'vscode';

export interface ThoughtStep {
  id: string;
  timestamp: string;
  title: string;
  content: string;
  status: 'thinking' | 'done';
}

export interface RunningComment {
  id: string;
  timestamp: string;
  tag: 'thought' | 'observation' | 'decision' | 'tool';
  message: string;
}

export interface ScratchpadData {
  chainOfThought: ThoughtStep[];
  runningComments: RunningComment[];
  activeThought?: string;
  notesMarkdown: string;
  canvasHeight: number;
  drawingDataUrl: string;
  updatedAt: number;
}

export class ScratchpadStore {
  private currentData: ScratchpadData = this.defaultData();
  private onScratchpadChangeEmitter = new vscode.EventEmitter<ScratchpadData>();
  public readonly onScratchpadChange = this.onScratchpadChangeEmitter.event;

  constructor() {
    this.loadFromDisk();
  }

  private async loadFromDisk(): Promise<void> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) return;

    const fileUri = vscode.Uri.joinPath(workspaceFolders[0].uri, '.copilot', 'scratchpad.json');
    try {
      const bytes = await vscode.workspace.fs.readFile(fileUri);
      const parsed = JSON.parse(Buffer.from(bytes).toString('utf8'));
      this.currentData = {
        ...this.defaultData(),
        ...parsed,
        chainOfThought: parsed.chainOfThought || [],
        runningComments: parsed.runningComments || [],
      };
      this.onScratchpadChangeEmitter.fire(this.currentData);
    } catch {
      // Default initialized
    }
  }

  public async getScratchpad(): Promise<ScratchpadData> {
    return this.currentData;
  }

  public async reload(): Promise<void> {
    await this.loadFromDisk();
  }

  public startThoughtStep(title: string): ThoughtStep {
    const step: ThoughtStep = {
      id: Math.random().toString(36).substring(2, 9),
      timestamp: new Date().toLocaleTimeString(),
      title,
      content: '',
      status: 'thinking',
    };
    this.currentData.chainOfThought.push(step);
    this.currentData.activeThought = title;
    this.notifyAndSave();
    return step;
  }

  public appendThoughtChunk(stepId: string, chunk: string): void {
    const step = this.currentData.chainOfThought.find(s => s.id === stepId);
    if (step) {
      step.content += chunk;
      this.onScratchpadChangeEmitter.fire(this.currentData);
    }
  }

  public finishThoughtStep(stepId: string, finalContent?: string): void {
    const step = this.currentData.chainOfThought.find(s => s.id === stepId);
    if (step) {
      if (finalContent !== undefined) {
        step.content = finalContent;
      }
      step.status = 'done';
      this.currentData.activeThought = undefined;
      this.notifyAndSave();
    }
  }

  public addRunningComment(tag: RunningComment['tag'], message: string): RunningComment {
    const comment: RunningComment = {
      id: Math.random().toString(36).substring(2, 9),
      timestamp: new Date().toLocaleTimeString(),
      tag,
      message,
    };
    this.currentData.runningComments.push(comment);
    if (this.currentData.runningComments.length > 50) {
      this.currentData.runningComments.shift();
    }
    this.notifyAndSave();
    return comment;
  }

  public setNotesMarkdown(notesMarkdown: string): void {
    this.currentData.notesMarkdown = notesMarkdown;
    this.notifyAndSave();
  }

  public clearScratchpad(): void {
    this.currentData.chainOfThought = [];
    this.currentData.runningComments = [];
    this.currentData.activeThought = undefined;
    this.notifyAndSave();
  }

  public async saveScratchpad(data: Partial<ScratchpadData>): Promise<void> {
    this.currentData = {
      ...this.currentData,
      ...data,
      updatedAt: Date.now(),
    };
    await this.notifyAndSave();
  }

  private async notifyAndSave(): Promise<void> {
    this.currentData.updatedAt = Date.now();
    this.onScratchpadChangeEmitter.fire(this.currentData);

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) return;

    try {
      const dirUri = vscode.Uri.joinPath(workspaceFolders[0].uri, '.copilot');
      await vscode.workspace.fs.createDirectory(dirUri);

      // 1. JSON state
      const jsonUri = vscode.Uri.joinPath(dirUri, 'scratchpad.json');
      await vscode.workspace.fs.writeFile(
        jsonUri,
        Buffer.from(JSON.stringify(this.currentData, null, 2), 'utf8')
      );

      // 2. Markdown scratchpad
      const mdUri = vscode.Uri.joinPath(dirUri, 'scratchpad.md');
      const mdContent = this.exportMarkdown();
      await vscode.workspace.fs.writeFile(mdUri, Buffer.from(mdContent, 'utf8'));
    } catch {
      // Ignore background file write errors
    }
  }

  public exportMarkdown(): string {
    let md = '# Agent Scratchpad & Chain of Thought\n\n';
    md += `_Last Updated: ${new Date(this.currentData.updatedAt).toLocaleString()}_\n\n`;

    if (this.currentData.chainOfThought.length > 0) {
      md += '## 🧠 Chain of Thought (Thinking Process)\n\n';
      for (const step of this.currentData.chainOfThought) {
        const icon = step.status === 'done' ? '✅' : '⏳';
        md += `### ${icon} [${step.timestamp}] ${step.title}\n\n`;
        if (step.content) {
          md += step.content + '\n\n';
        }
      }
    }

    if (this.currentData.runningComments.length > 0) {
      md += '## ⚡ Running Agent Commentary & Observations\n\n';
      for (const comment of this.currentData.runningComments) {
        md += `- **[${comment.timestamp}] [${comment.tag.toUpperCase()}]**: ${comment.message}\n`;
      }
      md += '\n';
    }

    if (this.currentData.notesMarkdown) {
      md += '## 📝 Scratchpad Working Notes\n\n';
      md += this.currentData.notesMarkdown + '\n';
    }

    return md;
  }

  private defaultData(): ScratchpadData {
    return {
      chainOfThought: [
        {
          id: 'cot-init',
          timestamp: new Date().toLocaleTimeString(),
          title: 'Agent Scratchpad Ready',
          content: 'The scratchpad will stream live reasoning steps, thoughts, and discoveries as tasks execute.',
          status: 'done',
        }
      ],
      runningComments: [
        {
          id: 'rc-init',
          timestamp: new Date().toLocaleTimeString(),
          tag: 'thought',
          message: 'Initialized Antigravity scratchpad. Standing by to record reasoning and context.',
        }
      ],
      activeThought: undefined,
      canvasHeight: 340,
      drawingDataUrl: '',
      notesMarkdown: '# Working Notes & Hypotheses\n\n- Discovered components, state variables, and execution plans appear here.',
      updatedAt: Date.now(),
    };
  }

  public dispose() {
    this.onScratchpadChangeEmitter.dispose();
  }
}
