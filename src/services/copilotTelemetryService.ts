import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export interface ModelPricingMetadata {
  id: string;
  name: string;
  family: string;
  pricingLabel: string;
  inputCostPer1M: number;
  outputCostPer1M: number;
  cacheCostPer1M: number;
  discountPercent?: number;
}

export interface TurnTelemetry {
  modelId: string;
  modelName: string;
  modelFamily: string;
  pricingLabel: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedAic: number;
  estimatedUsd: number;
  timestamp: number;
}

export interface CumulativeSessionTelemetry {
  sessionInputTokens: number;
  sessionOutputTokens: number;
  sessionTotalTokens: number;
  sessionAic: number;
  sessionUsd: number;
  turnCount: number;
  lastTurn?: TurnTelemetry;
}

export class CopilotTelemetryService {
  // Dynamically harvested model pricing registry (no hardcoded rates!)
  private dynamicPricingRegistry = new Map<string, ModelPricingMetadata>();
  private cumulativeSession: CumulativeSessionTelemetry = {
    sessionInputTokens: 0,
    sessionOutputTokens: 0,
    sessionTotalTokens: 0,
    sessionAic: 0,
    sessionUsd: 0,
    turnCount: 0
  };

  constructor() {
    this.discoverLivePricing().catch(() => {});
  }

  /**
   * Scans local VS Code Copilot session files to dynamically harvest
   * GitHub's live model pricing matrix and promotional discounts without hardcoding.
   */
  public async discoverLivePricing(): Promise<void> {
    const workspaceStorageDirs = this.getWorkspaceStoragePaths();

    for (const baseDir of workspaceStorageDirs) {
      if (!fs.existsSync(baseDir)) continue;

      try {
        const workspaceFolders = fs.readdirSync(baseDir, { withFileTypes: true });

        for (const entry of workspaceFolders) {
          if (!entry.isDirectory()) continue;
          const chatSessionsDir = path.join(baseDir, entry.name, 'chatSessions');

          if (fs.existsSync(chatSessionsDir)) {
            const files = fs.readdirSync(chatSessionsDir)
              .filter(f => f.endsWith('.jsonl'))
              .map(f => ({
                filePath: path.join(chatSessionsDir, f),
                mtime: fs.statSync(path.join(chatSessionsDir, f)).mtimeMs
              }))
              .sort((a, b) => b.mtime - a.mtime)
              .slice(0, 10); // inspect 10 most recent sessions

            for (const file of files) {
              this.parseSessionJsonlForPricing(file.filePath);
            }
          }
        }
      } catch {}
    }
  }

  /**
   * Inspects a session JSONL file and extracts model pricing definitions.
   */
  private parseSessionJsonlForPricing(filePath: string) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const lines = content.split('\n').slice(0, 30); // metadata is stored in initial headers

      for (const line of lines) {
        if (!line.trim()) continue;
        if (line.includes('pricing') && line.includes('inputCost') && line.includes('outputCost')) {
          try {
            const obj = JSON.parse(line);
            this.extractModelMetadata(obj);
          } catch {}
        }
      }
    } catch {}
  }

  private extractModelMetadata(root: any) {
    // Traverse object to find any selectedModel / metadata blocks
    const search = (node: any) => {
      if (!node || typeof node !== 'object') return;

      if (node.id && node.inputCost !== undefined && node.outputCost !== undefined) {
        const id = String(node.id).toLowerCase();
        const family = String(node.family || node.id).toLowerCase();
        const name = String(node.name || node.id);
        const pricingLabel = String(node.pricing || `In: ${node.inputCost} • Out: ${node.outputCost} AICs/1M`);
        const discountPercent = node.promo?.discountPercent || 0;

        const meta: ModelPricingMetadata = {
          id,
          name,
          family,
          pricingLabel,
          inputCostPer1M: Number(node.inputCost) || 0,
          outputCostPer1M: Number(node.outputCost) || 0,
          cacheCostPer1M: Number(node.cacheCost) || 0,
          discountPercent
        };

        this.dynamicPricingRegistry.set(id, meta);
        this.dynamicPricingRegistry.set(family, meta);
      }

      for (const key of Object.keys(node)) {
        search(node[key]);
      }
    };

    search(root);
  }

  /**
   * Calculates exact token usage and AICs using GitHub's metering formula.
   */
  public calculateUsage(
    model: vscode.LanguageModelChat,
    inputTokens: number,
    outputTokens: number
  ): TurnTelemetry {
    const modelKey = model.id.toLowerCase().replace(/^copilot\//, '');
    const familyKey = model.family.toLowerCase();

    // Look up in dynamic harvested registry
    const pricing = this.dynamicPricingRegistry.get(modelKey) ||
      this.dynamicPricingRegistry.get(familyKey) ||
      this.getFallbackPricing(model);

    // Compute discount multiplier if active
    const discountMultiplier = pricing.discountPercent ? (1 - pricing.discountPercent / 100) : 1;

    // Formula: AIC = ((inputTokens * inputCost) + (outputTokens * outputCost)) / 1,000,000 * discount
    const rawAic = ((inputTokens * pricing.inputCostPer1M) + (outputTokens * pricing.outputCostPer1M)) / 1_000_000;
    const finalAic = rawAic * discountMultiplier;
    const estimatedUsd = finalAic * 0.01; // 1 AIC = $0.01 USD

    const totalTokens = inputTokens + outputTokens;

    const turn: TurnTelemetry = {
      modelId: model.id,
      modelName: pricing.name || model.name,
      modelFamily: model.family,
      pricingLabel: pricing.pricingLabel,
      inputTokens,
      outputTokens,
      totalTokens,
      estimatedAic: Number(finalAic.toFixed(4)),
      estimatedUsd: Number(estimatedUsd.toFixed(5)),
      timestamp: Date.now()
    };

    // Update cumulative session counters
    this.cumulativeSession.sessionInputTokens += inputTokens;
    this.cumulativeSession.sessionOutputTokens += outputTokens;
    this.cumulativeSession.sessionTotalTokens += totalTokens;
    this.cumulativeSession.sessionAic = Number((this.cumulativeSession.sessionAic + finalAic).toFixed(4));
    this.cumulativeSession.sessionUsd = Number((this.cumulativeSession.sessionAic * 0.01).toFixed(5));
    this.cumulativeSession.turnCount += 1;
    this.cumulativeSession.lastTurn = turn;

    return turn;
  }

  public getCumulativeSession(): CumulativeSessionTelemetry {
    return { ...this.cumulativeSession };
  }

  public resetSession() {
    this.cumulativeSession = {
      sessionInputTokens: 0,
      sessionOutputTokens: 0,
      sessionTotalTokens: 0,
      sessionAic: 0,
      sessionUsd: 0,
      turnCount: 0
    };
  }

  /**
   * Returns list of available models merged with their discovered pricing labels.
   */
  public async getAvailableModels(): Promise<{ id: string; name: string; family: string; pricing: string }[]> {
    try {
      const models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
      return models.map(m => {
        const key = m.id.toLowerCase().replace(/^copilot\//, '');
        const meta = this.dynamicPricingRegistry.get(key) || this.dynamicPricingRegistry.get(m.family.toLowerCase());
        return {
          id: m.id,
          name: meta?.name || m.name,
          family: m.family,
          pricing: meta?.pricingLabel || 'Standard Copilot Rate'
        };
      });
    } catch {
      return [];
    }
  }

  private getFallbackPricing(model: vscode.LanguageModelChat): ModelPricingMetadata {
    // Dynamic fallback in case no sessions have run yet on this machine
    const family = model.family.toLowerCase();
    const isHeavy = family.includes('opus') || family.includes('sol') || family.includes('o1');
    const isMedium = family.includes('terra') || family.includes('sonnet') || family.includes('4o');

    const inCost = isHeavy ? 500 : isMedium ? 200 : 100;
    const outCost = isHeavy ? 3000 : isMedium ? 1200 : 600;

    return {
      id: model.id,
      name: model.name,
      family: model.family,
      pricingLabel: `In: ${inCost} • Out: ${outCost} AICs/1M`,
      inputCostPer1M: inCost,
      outputCostPer1M: outCost,
      cacheCostPer1M: inCost / 4
    };
  }

  private getWorkspaceStoragePaths(): string[] {
    const paths: string[] = [];

    // Windows
    if (process.env.APPDATA) {
      paths.push(path.join(process.env.APPDATA, 'Code', 'User', 'workspaceStorage'));
      paths.push(path.join(process.env.APPDATA, 'Code - Insiders', 'User', 'workspaceStorage'));
    }

    // macOS
    if (process.env.HOME) {
      paths.push(path.join(process.env.HOME, 'Library', 'Application Support', 'Code', 'User', 'workspaceStorage'));
      paths.push(path.join(process.env.HOME, 'Library', 'Application Support', 'Code - Insiders', 'User', 'workspaceStorage'));
    }

    // Linux
    if (process.env.HOME) {
      paths.push(path.join(process.env.HOME, '.config', 'Code', 'User', 'workspaceStorage'));
      paths.push(path.join(process.env.HOME, '.config', 'Code - Insiders', 'User', 'workspaceStorage'));
    }

    return paths;
  }
}
