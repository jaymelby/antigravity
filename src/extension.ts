import * as vscode from 'vscode';
import { AntigravityViewProvider } from './webview/AntigravityViewProvider';
import { PlanWatcher } from './services/planWatcher';
import { WalkthroughWatcher } from './services/walkthroughWatcher';
import { ScratchpadStore } from './services/scratchpadStore';
import { TaskRunner } from './services/taskRunner';
import { registerChatParticipant } from './chat/chatParticipant';

export function activate(context: vscode.ExtensionContext) {
  console.log('Antigravity Mission Control extension is now active!');

  const planWatcher = new PlanWatcher();
  const walkthroughWatcher = new WalkthroughWatcher();
  const scratchpadStore = new ScratchpadStore();
  const taskRunner = new TaskRunner();

  const provider = new AntigravityViewProvider(
    context.extensionUri,
    planWatcher,
    walkthroughWatcher,
    scratchpadStore,
    taskRunner
  );

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(AntigravityViewProvider.viewType, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    })
  );

  registerChatParticipant(context, taskRunner, planWatcher, walkthroughWatcher);

  context.subscriptions.push(
    vscode.commands.registerCommand('antigravity.openControlCenter', async () => {
      await vscode.commands.executeCommand('antigravity.controlCenter.focus');
    }),

    vscode.commands.registerCommand('antigravity.showPlan', async () => {
      await vscode.commands.executeCommand('antigravity.controlCenter.focus');
      provider.switchTab('plan-tab');
    }),

    vscode.commands.registerCommand('antigravity.showScratchpad', async () => {
      await vscode.commands.executeCommand('antigravity.controlCenter.focus');
      provider.switchTab('scratchpad-tab');
    }),

    vscode.commands.registerCommand('antigravity.showWalkthrough', async () => {
      await vscode.commands.executeCommand('antigravity.controlCenter.focus');
      provider.switchTab('walkthrough-tab');
    }),

    vscode.commands.registerCommand('antigravity.approvePlan', async () => {
      taskRunner.setState('EXECUTING');
      taskRunner.addLog('success', 'Implementation plan approved by user! Proceeding to execute edits.');
      vscode.window.showInformationMessage('🚀 Plan approved! Antigravity is executing changes...');
    }),

    vscode.commands.registerCommand('antigravity.attachFileToContext', async (uri: vscode.Uri) => {
      if (uri) {
        await vscode.commands.executeCommand('antigravity.controlCenter.focus');
        provider.attachFile(uri);
      }
    }),

    vscode.commands.registerCommand('antigravity.openSettings', async () => {
      await vscode.commands.executeCommand('antigravity.controlCenter.focus');
      provider.openSettings();
    }),

    vscode.commands.registerCommand('antigravity.rollbackMission', async () => {
      await provider.rollbackMission();
    }),

    vscode.commands.registerCommand('antigravity.selectModel', async () => {
      await provider.promptModelSelection();
    })
  );

  context.subscriptions.push(planWatcher, walkthroughWatcher, taskRunner);
}

export function deactivate() {}
