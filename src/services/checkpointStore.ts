import * as vscode from 'vscode';
import * as path from 'path';

export interface FileSnapshot {
  fsPath: string;
  fileName: string;
  originalContent: string;
}

export interface MissionCheckpoint {
  id: string;
  timestamp: number;
  goal: string;
  files: FileSnapshot[];
}

export class CheckpointStore {
  private activeCheckpoint: MissionCheckpoint | null = null;
  private checkpointHistory: MissionCheckpoint[] = [];

  constructor() {}

  /**
   * Captures a pre-execution snapshot of all target files before modifying them.
   */
  public async createCheckpoint(goal: string, fileUris: vscode.Uri[]): Promise<MissionCheckpoint> {
    const files: FileSnapshot[] = [];

    for (const uri of fileUris) {
      try {
        const bytes = await vscode.workspace.fs.readFile(uri);
        const originalContent = Buffer.from(bytes).toString('utf8');
        files.push({
          fsPath: uri.fsPath,
          fileName: path.basename(uri.fsPath),
          originalContent
        });
      } catch (err) {
        // New file that does not yet exist on disk
        files.push({
          fsPath: uri.fsPath,
          fileName: path.basename(uri.fsPath),
          originalContent: '' // empty indicates file was newly created
        });
      }
    }

    const checkpoint: MissionCheckpoint = {
      id: `chk_${Date.now()}`,
      timestamp: Date.now(),
      goal,
      files
    };

    this.activeCheckpoint = checkpoint;
    this.checkpointHistory.unshift(checkpoint);

    // Persist checkpoint to disk under .copilot/checkpoints/
    await this.persistCheckpointToDisk(checkpoint);

    return checkpoint;
  }

  /**
   * Restores all files in the active checkpoint back to their pre-execution state.
   */
  public async rollback(checkpointId?: string): Promise<{ restoredCount: number; restoredFiles: string[] }> {
    const target = checkpointId
      ? this.checkpointHistory.find(c => c.id === checkpointId) || this.activeCheckpoint
      : this.activeCheckpoint;

    if (!target) {
      throw new Error('No active mission checkpoint available to rollback.');
    }

    const restoredFiles: string[] = [];

    for (const file of target.files) {
      const uri = vscode.Uri.file(file.fsPath);
      if (file.originalContent === '') {
        // If file didn't exist before the mission, delete it
        try {
          await vscode.workspace.fs.delete(uri, { recursive: false, useTrash: true });
          restoredFiles.push(`${file.fileName} (removed newly created file)`);
        } catch {}
      } else {
        // Restore pre-execution buffer
        await vscode.workspace.fs.writeFile(uri, Buffer.from(file.originalContent, 'utf8'));
        restoredFiles.push(file.fileName);
      }
    }

    return {
      restoredCount: restoredFiles.length,
      restoredFiles
    };
  }

  public getActiveCheckpoint(): MissionCheckpoint | null {
    return this.activeCheckpoint;
  }

  public getSnapshotForFile(fsPath: string): FileSnapshot | undefined {
    if (!this.activeCheckpoint) return undefined;
    const normalized = fsPath.toLowerCase();
    return this.activeCheckpoint.files.find(f => f.fsPath.toLowerCase() === normalized);
  }

  public clearActiveCheckpoint() {
    this.activeCheckpoint = null;
  }

  private async persistCheckpointToDisk(checkpoint: MissionCheckpoint) {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) return;

    try {
      const checkpointDir = vscode.Uri.joinPath(
        workspaceFolders[0].uri,
        '.copilot',
        'checkpoints',
        checkpoint.id
      );
      await vscode.workspace.fs.createDirectory(checkpointDir);

      const metaUri = vscode.Uri.joinPath(checkpointDir, 'checkpoint.json');
      const metaJson = JSON.stringify(
        {
          id: checkpoint.id,
          timestamp: checkpoint.timestamp,
          goal: checkpoint.goal,
          files: checkpoint.files.map(f => ({ fsPath: f.fsPath, fileName: f.fileName }))
        },
        null,
        2
      );
      await vscode.workspace.fs.writeFile(metaUri, Buffer.from(metaJson, 'utf8'));

      // Save snapshots of the individual files
      for (const file of checkpoint.files) {
        if (file.originalContent) {
          const backupUri = vscode.Uri.joinPath(checkpointDir, file.fileName);
          await vscode.workspace.fs.writeFile(backupUri, Buffer.from(file.originalContent, 'utf8'));
        }
      }
    } catch {}
  }
}
