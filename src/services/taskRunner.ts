import * as vscode from 'vscode';

export type AgentState = 
  | 'IDLE' 
  | 'RESEARCHING' 
  | 'PLANNING' 
  | 'WAITING_APPROVAL' 
  | 'EXECUTING' 
  | 'VERIFYING' 
  | 'COMPLETED';

export interface TaskLogEntry {
  id: string;
  timestamp: string;
  type: 'info' | 'tool' | 'success' | 'warn' | 'error';
  message: string;
}

export interface TaskState {
  state: AgentState;
  goal: string;
  subtasks: { id: string; title: string; done: boolean }[];
  logs: TaskLogEntry[];
}

export class TaskRunner {
  private currentState: TaskState = {
    state: 'IDLE',
    goal: 'Ready for your next coding mission.',
    subtasks: [
      { id: '1', title: 'Read workspace structure and dependencies', done: false },
      { id: '2', title: 'Generate implementation plan with approval gate', done: false },
      { id: '3', title: 'Execute approved code modifications', done: false },
      { id: '4', title: 'Run verification checks and generate walkthrough', done: false },
    ],
    logs: [
      {
        id: 'init',
        timestamp: new Date().toLocaleTimeString(),
        type: 'info',
        message: 'Antigravity Agent initialized. Standing by for task.',
      }
    ],
  };

  private onStateChangeEmitter = new vscode.EventEmitter<TaskState>();
  public readonly onStateChange = this.onStateChangeEmitter.event;

  public getState(): TaskState {
    return this.currentState;
  }

  public setState(state: AgentState, goal?: string) {
    this.currentState.state = state;
    if (goal) this.currentState.goal = goal;

    if (state === 'PLANNING') {
      this.currentState.subtasks[0].done = true;
    } else if (state === 'WAITING_APPROVAL') {
      this.currentState.subtasks[0].done = true;
      this.currentState.subtasks[1].done = true;
    } else if (state === 'EXECUTING') {
      this.currentState.subtasks[0].done = true;
      this.currentState.subtasks[1].done = true;
    } else if (state === 'COMPLETED') {
      this.currentState.subtasks.forEach(s => s.done = true);
    }

    this.addLog('info', 'Agent state changed to ' + state);
    this.onStateChangeEmitter.fire(this.currentState);
  }

  public updateSubtasks(subtasks: { id: string; title: string; done: boolean }[]) {
    this.currentState.subtasks = subtasks;
    this.onStateChangeEmitter.fire(this.currentState);
  }

  public markSubtaskDone(id: string) {
    const subtask = this.currentState.subtasks.find(s => s.id === id);
    if (subtask) {
      subtask.done = true;
      this.onStateChangeEmitter.fire(this.currentState);
    }
  }

  public addLog(type: TaskLogEntry['type'], message: string) {
    this.currentState.logs.push({
      id: Math.random().toString(36).substring(2, 9),
      timestamp: new Date().toLocaleTimeString(),
      type,
      message,
    });
    if (this.currentState.logs.length > 100) {
      this.currentState.logs.shift();
    }
    this.onStateChangeEmitter.fire(this.currentState);
  }

  public reset(goal: string = 'New Task') {
    this.currentState = {
      state: 'PLANNING',
      goal,
      subtasks: [
        { id: '1', title: 'Read workspace structure and dependencies', done: true },
        { id: '2', title: 'Generate implementation plan with approval gate', done: false },
        { id: '3', title: 'Execute approved code modifications', done: false },
        { id: '4', title: 'Run verification checks and generate walkthrough', done: false },
      ],
      logs: [
        {
          id: Math.random().toString(36).substring(2, 9),
          timestamp: new Date().toLocaleTimeString(),
          type: 'info',
          message: 'Started mission: ' + goal,
        }
      ]
    };
    this.onStateChangeEmitter.fire(this.currentState);
  }

  public dispose() {
    this.onStateChangeEmitter.dispose();
  }
}
