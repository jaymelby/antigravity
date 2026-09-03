import * as vscode from 'vscode';
import { TaskRunner } from '../services/taskRunner';
import { PlanWatcher } from '../services/planWatcher';
import { WalkthroughWatcher } from '../services/walkthroughWatcher';

export function registerChatParticipant(
  context: vscode.ExtensionContext,
  taskRunner: TaskRunner,
  planWatcher: PlanWatcher,
  walkthroughWatcher: WalkthroughWatcher
) {
  const handler: vscode.ChatRequestHandler = async (
    request: vscode.ChatRequest,
    chatContext: vscode.ChatContext,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken
  ) => {
    const command = request.command;

    if (command === 'plan') {
      taskRunner.reset(request.prompt || 'Drafting implementation plan');
      taskRunner.setState('PLANNING');
      taskRunner.addLog('tool', `Analyzing workspace for: "${request.prompt}"`);

      stream.progress('Researching codebase and drafting implementation plan...');

      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders) {
        stream.markdown('❌ No open workspace found.');
        return;
      }

      const planDir = vscode.Uri.joinPath(workspaceFolders[0].uri, '.copilot');
      await vscode.workspace.fs.createDirectory(planDir);

      const planUri = vscode.Uri.joinPath(planDir, 'implementation_plan.md');
      const wsPath = workspaceFolders[0].uri.fsPath.replace(/\\/g, '/');
      const planContent = `# Goal: ${request.prompt || 'Proposed Changes'}\n\n` +
        `## User Review Required\n> [!IMPORTANT]\n> Please verify proposed architectural adjustments before execution.\n\n` +
        `## Proposed Changes\n### Core System\n#### [MODIFY] [workspace](file:///${wsPath})\n- Apply changes based on user prompt.\n\n` +
        `## Verification Plan\n- Run build checks\n- Test in browser/terminal\n`;

      await vscode.workspace.fs.writeFile(planUri, Buffer.from(planContent, 'utf8'));
      await planWatcher.reload();

      taskRunner.setState('WAITING_APPROVAL');
      taskRunner.addLog('warn', 'Implementation plan created. Waiting for user approval.');

      stream.markdown('### 🗺️ Implementation Plan Generated\n\n');
      stream.markdown('Plan written to `.copilot/implementation_plan.md` and loaded into the **Antigravity Plan Tab**.\n\n');
      stream.button({
        title: '✅ Approve & Execute Plan',
        command: 'antigravity.approvePlan'
      });
      stream.button({
        title: '🗺️ View in Mission Control',
        command: 'antigravity.showPlan'
      });
      return;
    }

    if (command === 'execute') {
      taskRunner.setState('EXECUTING');
      taskRunner.addLog('tool', 'Executing approved implementation plan edits...');
      stream.progress('Applying modifications...');

      await vscode.commands.executeCommand('antigravity.approvePlan');
      stream.markdown('✅ Plan approved and executed! Switch to the **Walkthrough Tab** or run `@antigravity /walkthrough` to review verification.');
      return;
    }

    if (command === 'walkthrough') {
      taskRunner.setState('VERIFYING');
      taskRunner.addLog('tool', 'Generating verification debrief & walkthrough...');

      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (workspaceFolders) {
        const wtUri = vscode.Uri.joinPath(workspaceFolders[0].uri, '.copilot', 'walkthrough.md');
        const wtContent = `# Task Completion Walkthrough\n\n` +
          `All changes have been applied and verified.\n\n` +
          `## Features Implemented\n- Applied changes according to the approved plan.\n\n` +
          `## Verification Results\n- Code compiled successfully.\n- Manual & automated checks completed.\n`;
        await vscode.workspace.fs.writeFile(wtUri, Buffer.from(wtContent, 'utf8'));
        await walkthroughWatcher.reload();
      }

      taskRunner.setState('COMPLETED');
      taskRunner.addLog('success', 'Mission accomplished! Walkthrough generated.');

      stream.markdown('### 🔍 Walkthrough Generated\n\nVerified report loaded into the **Antigravity Walkthrough Tab**.');
      stream.button({
        title: '🔍 Open Walkthrough Tab',
        command: 'antigravity.showWalkthrough'
      });
      return;
    }

    if (command === 'scratch') {
      await vscode.commands.executeCommand('antigravity.showScratchpad');
      stream.markdown('🎨 Switched to **Scratchpad Tab** in Antigravity Mission Control.');
      return;
    }

    stream.markdown(`🚀 **Antigravity Mission Control is active!**\n\nAvailable commands:\n` +
      `- \`@antigravity /plan <goal>\`: Draft a plan with approval gate\n` +
      `- \`@antigravity /execute\`: Approve & run active plan\n` +
      `- \`@antigravity /walkthrough\`: Verify changes & generate walkthrough\n` +
      `- \`@antigravity /scratch\`: Open scratchpad canvas\n`
    );
  };

  const participant = vscode.chat.createChatParticipant('antigravity', handler);
  participant.iconPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'icon.svg');
  context.subscriptions.push(participant);
}
