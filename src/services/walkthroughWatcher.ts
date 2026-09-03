import * as vscode from 'vscode';

export interface ParsedWalkthrough {
  exists: boolean;
  rawContent: string;
  title: string;
  summary: string;
  features: string[];
  verificationResults: string[];
  lastModified: number;
}

export class WalkthroughWatcher {
  private watcher?: vscode.FileSystemWatcher;
  private onWalkthroughChangeEmitter = new vscode.EventEmitter<ParsedWalkthrough>();
  public readonly onWalkthroughChange = this.onWalkthroughChangeEmitter.event;

  constructor() {
    this.setupWatcher();
  }

  private setupWatcher() {
    this.watcher = vscode.workspace.createFileSystemWatcher('**/.copilot/walkthrough.md');
    this.watcher.onDidChange(() => this.reload());
    this.watcher.onDidCreate(() => this.reload());
    this.watcher.onDidDelete(() => this.reload());
  }

  public async getWalkthrough(): Promise<ParsedWalkthrough> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      return this.emptyWalkthrough();
    }

    const rootUri = workspaceFolders[0].uri;
    const wtUri = vscode.Uri.joinPath(rootUri, '.copilot', 'walkthrough.md');

    try {
      const bytes = await vscode.workspace.fs.readFile(wtUri);
      const content = Buffer.from(bytes).toString('utf8');
      const stat = await vscode.workspace.fs.stat(wtUri);
      return this.parseWalkthrough(content, stat.mtime);
    } catch {
      return this.emptyWalkthrough();
    }
  }

  public async reload() {
    const wt = await this.getWalkthrough();
    this.onWalkthroughChangeEmitter.fire(wt);
  }

  private emptyWalkthrough(): ParsedWalkthrough {
    return {
      exists: false,
      rawContent: '',
      title: 'No Walkthrough Generated',
      summary: 'No walkthrough found in .copilot/walkthrough.md. Run @antigravity /walkthrough after making changes to generate one.',
      features: [],
      verificationResults: [],
      lastModified: 0,
    };
  }

  private parseWalkthrough(content: string, mtime: number): ParsedWalkthrough {
    const lines = content.split(/\r?\n/);
    let title = 'Walkthrough & Verification';
    const features: string[] = [];
    const verificationResults: string[] = [];
    let summary = '';
    let currentSection = '';

    for (const line of lines) {
      const trimmed = line.trim();

      if (trimmed.startsWith('# ') && title === 'Walkthrough & Verification') {
        title = trimmed.replace(/^#\s+/, '');
        continue;
      }

      if (trimmed.startsWith('## ')) {
        currentSection = trimmed.replace(/^##\s+/, '').toLowerCase();
        continue;
      }

      if ((currentSection.includes('changes') || currentSection.includes('features') || currentSection.includes('implemented')) && (trimmed.startsWith('-') || trimmed.startsWith('*'))) {
        features.push(trimmed.replace(/^[-*]\s+/, ''));
      } else if (currentSection.includes('verif') || currentSection.includes('test')) {
        if (trimmed.startsWith('-') || trimmed.startsWith('*') || /^\d+\./.test(trimmed)) {
          verificationResults.push(trimmed.replace(/^[-*\d.]+\s+/, ''));
        }
      } else if (!currentSection && trimmed && !summary) {
        summary = trimmed;
      }
    }

    return {
      exists: true,
      rawContent: content,
      title,
      summary: summary || 'Post-execution verification debrief.',
      features,
      verificationResults,
      lastModified: mtime,
    };
  }

  public dispose() {
    this.watcher?.dispose();
    this.onWalkthroughChangeEmitter.dispose();
  }
}
