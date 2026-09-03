import * as vscode from 'vscode';

export class AntigravityDiffProvider implements vscode.TextDocumentContentProvider {
  public static readonly scheme = 'antigravity-diff';

  private onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
  public readonly onDidChange = this.onDidChangeEmitter.event;

  // Stores in-memory virtual document contents keyed by uri.toString()
  private documents = new Map<string, string>();

  public provideTextDocumentContent(uri: vscode.Uri): string {
    return this.documents.get(uri.toString()) || '';
  }

  public setDocumentContent(uri: vscode.Uri, content: string) {
    this.documents.set(uri.toString(), content);
    this.onDidChangeEmitter.fire(uri);
  }

  public clear(uri: vscode.Uri) {
    this.documents.delete(uri.toString());
  }

  /**
   * Opens a native side-by-side VS Code Diff Editor between original content and proposed content.
   */
  public async showDiff(
    originalUri: vscode.Uri,
    proposedContent: string,
    title: string
  ): Promise<void> {
    const virtualUri = vscode.Uri.parse(
      `${AntigravityDiffProvider.scheme}://preview/${encodeURIComponent(originalUri.fsPath)}`
    );

    this.setDocumentContent(virtualUri, proposedContent);

    await vscode.commands.executeCommand('vscode.diff', originalUri, virtualUri, title, {
      preview: true,
      preserveFocus: false
    });
  }

  /**
   * Opens a diff comparing pre-execution checkpoint content vs the current file on disk.
   */
  public async showCheckpointDiff(
    checkpointContent: string,
    currentDiskUri: vscode.Uri,
    title: string
  ): Promise<void> {
    const virtualUri = vscode.Uri.parse(
      `${AntigravityDiffProvider.scheme}://checkpoint/${encodeURIComponent(currentDiskUri.fsPath)}`
    );

    this.setDocumentContent(virtualUri, checkpointContent);

    // Baseline (virtual checkpoint) on the left, modified (disk) on the right
    await vscode.commands.executeCommand('vscode.diff', virtualUri, currentDiskUri, title, {
      preview: true,
      preserveFocus: false
    });
  }
}
