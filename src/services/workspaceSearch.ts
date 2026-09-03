import * as vscode from 'vscode';
import * as path from 'path';

export class WorkspaceSearchService {
  private static readonly EXCLUDE_GLOB = '{**/node_modules/**,**/.git/**,**/dist/**,**/.copilot/**,**/.gemini/**,**/*.vsix,**/package-lock.json}';
  private static readonly STOP_WORDS = new Set([
    'the', 'and', 'for', 'that', 'this', 'with', 'from', 'into', 'over', 'all',
    'across', 'update', 'modify', 'edit', 'change', 'make', 'please', 'help',
    'code', 'file', 'files', 'need', 'want', 'should', 'could', 'would', 'game',
    'some', 'several', 'once', 'using', 'extension', 'antigravity', 'vscode'
  ]);

  /**
   * Discovers relevant files across the workspace by grepping filenames and file content
   * for query tokens.
   */
  public async findRelevantFiles(query: string, maxFiles: number = 6): Promise<vscode.Uri[]> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) return [];

    // Extract search tokens (length >= 3, alphanumeric, non-stopword)
    const rawTokens = query
      .toLowerCase()
      .replace(/[^\w\s\.-]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length >= 3 && !WorkspaceSearchService.STOP_WORDS.has(t));

    if (rawTokens.length === 0) {
      // Fallback: return up to 5 recently touched files in workspace
      const allFiles = await vscode.workspace.findFiles('**/*', WorkspaceSearchService.EXCLUDE_GLOB, 5);
      return allFiles;
    }

    // Step 1: Find candidate files across workspace
    const candidateFiles = await vscode.workspace.findFiles('**/*', WorkspaceSearchService.EXCLUDE_GLOB, 200);

    const scoredFiles: { uri: vscode.Uri; score: number }[] = [];

    for (const uri of candidateFiles) {
      const fileName = path.basename(uri.fsPath).toLowerCase();
      const relativePath = vscode.workspace.asRelativePath(uri).toLowerCase();
      let score = 0;

      // 1. Filename / path match (high weight)
      for (const token of rawTokens) {
        if (fileName.includes(token)) {
          score += 15;
        } else if (relativePath.includes(token)) {
          score += 8;
        }
      }

      // 2. Grep file contents if file extension is readable text
      const ext = path.extname(fileName).toLowerCase();
      const isTextFile = ['.html', '.htm', '.js', '.ts', '.css', '.json', '.md', '.py', '.jsx', '.tsx', '.svg', '.txt'].includes(ext);

      if (isTextFile) {
        try {
          const fileStat = await vscode.workspace.fs.stat(uri);
          // Only inspect files under 500KB for speed
          if (fileStat.size <= 500000) {
            const bytes = await vscode.workspace.fs.readFile(uri);
            const content = Buffer.from(bytes).toString('utf8').toLowerCase();

            for (const token of rawTokens) {
              // Count occurrences up to a max of 5 points per token
              const matches = content.split(token).length - 1;
              if (matches > 0) {
                score += Math.min(matches, 6);
              }
            }
          }
        } catch {
          // Skip unreadable files
        }
      }

      if (score > 0) {
        scoredFiles.push({ uri, score });
      }
    }

    // Sort by score descending and return top matches
    scoredFiles.sort((a, b) => b.score - a.score);
    return scoredFiles.slice(0, maxFiles).map(s => s.uri);
  }

  /**
   * Prompts user with QuickPick to attach any file from the workspace.
   */
  public async pickWorkspaceFile(): Promise<{ fsPath: string; fileName: string } | undefined> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      vscode.window.showInformationMessage('No active workspace folder.');
      return undefined;
    }

    const files = await vscode.workspace.findFiles('**/*', WorkspaceSearchService.EXCLUDE_GLOB, 500);

    const items: vscode.QuickPickItem[] = files.map(f => {
      const relPath = vscode.workspace.asRelativePath(f);
      return {
        label: `$(file) ${path.basename(f.fsPath)}`,
        description: path.dirname(relPath) === '.' ? '' : path.dirname(relPath),
        detail: f.fsPath,
      };
    });

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select a workspace file to attach to context...',
      matchOnDescription: true,
      matchOnDetail: true,
    });

    if (selected && selected.detail) {
      return {
        fsPath: selected.detail,
        fileName: path.basename(selected.detail),
      };
    }

    return undefined;
  }
}
