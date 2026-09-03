import * as vscode from 'vscode';
import * as path from 'path';

export interface PlanFileItem {
  type: 'NEW' | 'MODIFY' | 'DELETE' | 'UNKNOWN';
  filePath: string;
  fileName: string;
}

export interface ParsedPlan {
  exists: boolean;
  rawContent: string;
  title: string;
  summary: string;
  userReviewRequired: string[];
  openQuestions: string[];
  files: PlanFileItem[];
  verificationSteps: string[];
  lastModified: number;
}

export class PlanWatcher {
  private watcher?: vscode.FileSystemWatcher;
  private onPlanChangeEmitter = new vscode.EventEmitter<ParsedPlan>();
  public readonly onPlanChange = this.onPlanChangeEmitter.event;

  constructor() {
    this.setupWatcher();
  }

  private setupWatcher() {
    this.watcher = vscode.workspace.createFileSystemWatcher('**/.copilot/implementation_plan.md');
    this.watcher.onDidChange(() => this.reload());
    this.watcher.onDidCreate(() => this.reload());
    this.watcher.onDidDelete(() => this.reload());
  }

  public async getPlan(): Promise<ParsedPlan> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      return this.emptyPlan();
    }

    const rootUri = workspaceFolders[0].uri;
    const planUri = vscode.Uri.joinPath(rootUri, '.copilot', 'implementation_plan.md');

    try {
      const bytes = await vscode.workspace.fs.readFile(planUri);
      const content = Buffer.from(bytes).toString('utf8');
      const stat = await vscode.workspace.fs.stat(planUri);
      return this.parsePlanMarkdown(content, stat.mtime);
    } catch {
      return this.emptyPlan();
    }
  }

  public async reload() {
    const plan = await this.getPlan();
    this.onPlanChangeEmitter.fire(plan);
  }

  private emptyPlan(): ParsedPlan {
    return {
      exists: false,
      rawContent: '',
      title: 'No Active Implementation Plan',
      summary: 'No plan found in .copilot/implementation_plan.md. Use @antigravity /plan in Copilot Chat to generate one.',
      userReviewRequired: [],
      openQuestions: [],
      files: [],
      verificationSteps: [],
      lastModified: 0,
    };
  }

  private parsePlanMarkdown(content: string, mtime: number): ParsedPlan {
    const lines = content.split(/\r?\n/);
    let title = 'Implementation Plan';
    const userReviewRequired: string[] = [];
    const openQuestions: string[] = [];
    const files: PlanFileItem[] = [];
    const verificationSteps: string[] = [];
    let summary = '';
    let currentSection = '';

    for (const line of lines) {
      const trimmed = line.trim();

      if (trimmed.startsWith('# ') && title === 'Implementation Plan') {
        title = trimmed.replace(/^#\s+/, '');
        continue;
      }

      if (trimmed.startsWith('## ')) {
        currentSection = trimmed.replace(/^##\s+/, '').toLowerCase();
        continue;
      }

      if (currentSection.includes('user review') && trimmed.startsWith('>')) {
        const text = trimmed.replace(/^>\s*(\[!IMPORTANT\]|\[!WARNING\]|\[!NOTE\])?\s*/i, '');
        if (text) userReviewRequired.push(text);
      } else if (currentSection.includes('open question') && (trimmed.startsWith('-') || trimmed.startsWith('*'))) {
        const text = trimmed.replace(/^[-*]\s+/, '');
        if (text) openQuestions.push(text);
      } else if (currentSection.includes('verification') && (trimmed.startsWith('-') || trimmed.startsWith('*') || /^\d+\./.test(trimmed))) {
        const text = trimmed.replace(/^[-*\d.]+\s+/, '');
        if (text) verificationSteps.push(text);
      } else if (trimmed.includes('####') || (trimmed.startsWith('-') && trimmed.includes('['))) {
        const fileMatch = line.match(/\[(NEW|MODIFY|DELETE)\]\s*\[?([^\]\(\)]+)\]?(?:\((file:\/\/\/[^\)]+|[^\)]+)\))?/i);
        if (fileMatch) {
          const type = fileMatch[1].toUpperCase() as 'NEW' | 'MODIFY' | 'DELETE';
          const rawPath = fileMatch[3] || fileMatch[2];
          const cleanPath = rawPath.replace(/^file:\/\/\/?/, '');
          const fileName = path.basename(cleanPath);
          files.push({
            type,
            filePath: cleanPath,
            fileName: fileName || fileMatch[2],
          });
        }
      } else if (!currentSection && trimmed && !summary) {
        summary = trimmed;
      }
    }

    return {
      exists: true,
      rawContent: content,
      title,
      summary: summary || 'Implementation plan for proposed workspace changes.',
      userReviewRequired,
      openQuestions,
      files,
      verificationSteps,
      lastModified: mtime,
    };
  }

  public dispose() {
    this.watcher?.dispose();
    this.onPlanChangeEmitter.dispose();
  }
}
