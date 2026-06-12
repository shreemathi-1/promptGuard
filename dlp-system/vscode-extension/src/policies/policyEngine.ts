import { Detection, ScanResult } from '../scanner';
import { ConfigManager }          from '../config/configManager';
import * as fs                    from 'fs';
import * as path                  from 'path';

export type PolicyAction = 'BLOCK' | 'WARN' | 'MASK' | 'ALLOW';

export interface PolicyRule {
  id:          string;
  name:        string;
  description: string;
  enabled:     boolean;
  conditions: {
    categories?: string[];
    severities?: string[];
    ruleIds?:    string[];
    minCount?:   number;
  };
  action: PolicyAction;
}

export interface PolicyDecision {
  action:          PolicyAction;
  matchedRules:    PolicyRule[];
  detections:      Detection[];
  requiresMasking: boolean;
  requiresConfirm: boolean;
  message:         string;
}

export class PolicyEngine {
  private policies:  PolicyRule[];
  private config:    ConfigManager;

  constructor(config: ConfigManager) {
    this.config    = config;
    this.policies  = this.loadPolicies();
  }

  /**
   * Evaluates a scan result against all active policies.
   * Returns the most restrictive decision across all matched rules.
   */
  evaluate(result: ScanResult): PolicyDecision {
    if (!this.config.get<boolean>('enabled')) {
      return this.makeDecision('ALLOW', [], result.detections, '');
    }

    if (result.detectionCount === 0) {
      return this.makeDecision('ALLOW', [], [], 'No sensitive data detected.');
    }

    const ACTION_RANK: Record<PolicyAction, number> = {
      BLOCK: 4, WARN: 3, MASK: 2, ALLOW: 1,
    };

    let worstAction: PolicyAction = 'ALLOW';
    const matchedRules: PolicyRule[] = [];

    for (const policy of this.policies) {
      if (!policy.enabled) continue;

      if (this.matchesCondition(policy, result)) {
        matchedRules.push(policy);
        if (ACTION_RANK[policy.action] > ACTION_RANK[worstAction]) {
          worstAction = policy.action;
        }
      }
    }

    if (matchedRules.length === 0) {
      // No policy matched — default to WARN if detections exist
      return this.makeDecision(
        'WARN',
        [],
        result.detections,
        `${result.detectionCount} sensitive item(s) found — no policy matched. Proceeding with warning.`
      );
    }

    const message = this.buildMessage(worstAction, matchedRules, result);

    return this.makeDecision(worstAction, matchedRules, result.detections, message);
  }

  /**
   * Checks if a scan result satisfies a policy's conditions.
   */
  private matchesCondition(policy: PolicyRule, result: ScanResult): boolean {
    const { conditions } = policy;
    const { detections } = result;

    // Category filter
    if (conditions.categories && conditions.categories.length > 0) {
      const hasMatch = detections.some(d =>
        conditions.categories!.includes(d.category)
      );
      if (!hasMatch) return false;
    }

    // Severity filter
    if (conditions.severities && conditions.severities.length > 0) {
      const hasMatch = detections.some(d =>
        conditions.severities!.includes(d.severity)
      );
      if (!hasMatch) return false;
    }

    // Specific rule ID filter
    if (conditions.ruleIds && conditions.ruleIds.length > 0) {
      const hasMatch = detections.some(d =>
        conditions.ruleIds!.includes(d.ruleId)
      );
      if (!hasMatch) return false;
    }

    // Minimum detection count
    if (conditions.minCount !== undefined) {
      if (result.detectionCount < conditions.minCount) return false;
    }

    return true;
  }

  private makeDecision(
    action:       PolicyAction,
    matchedRules: PolicyRule[],
    detections:   Detection[],
    message:      string
  ): PolicyDecision {
    return {
      action,
      matchedRules,
      detections,
      requiresMasking: action === 'MASK',
      requiresConfirm: action === 'WARN' || action === 'BLOCK',
      message,
    };
  }

  private buildMessage(
    action:       PolicyAction,
    matchedRules: PolicyRule[],
    result:       ScanResult
  ): string {
    const categories = [...new Set(result.detections.map(d => d.category))].join(', ');
    const ruleNames  = matchedRules.map(r => r.name).join(', ');

    switch (action) {
      case 'BLOCK':
        return `🚫 BLOCKED: This prompt contains ${result.detectionCount} sensitive item(s) [${categories}] and violates policy "${ruleNames}". Sending is not permitted.`;
      case 'WARN':
        return `⚠️ WARNING: ${result.detectionCount} sensitive item(s) detected [${categories}]. Policy "${ruleNames}" requires confirmation before sending.`;
      case 'MASK':
        return `🔐 AUTO-MASKED: ${result.detectionCount} sensitive item(s) [${categories}] have been automatically redacted per policy "${ruleNames}".`;
      default:
        return '';
    }
  }

  /**
   * Loads policies from policy file or falls back to built-in defaults.
   */
  private loadPolicies(): PolicyRule[] {
    const policyFilePath = this.config.get<string>('policyFile');

    if (policyFilePath) {
      try {
        const resolvedPath = path.resolve(policyFilePath);
        const raw          = fs.readFileSync(resolvedPath, 'utf8');
        const parsed       = JSON.parse(raw) as { policies: PolicyRule[] };
        if (Array.isArray(parsed.policies)) {
          return parsed.policies;
        }
      } catch (err: any) {
        console.error('[DLP] Failed to load policy file:', err.message);
      }
    }

    return DEFAULT_POLICIES;
  }

  /**
   * Reloads policies from disk (call when config changes).
   */
  reload(): void {
    this.policies = this.loadPolicies();
  }

  getPolicies(): PolicyRule[] {
    return this.policies;
  }
}

// ── Default built-in policies ─────────────────────────────────────────────────

export const DEFAULT_POLICIES: PolicyRule[] = [
  {
    id:          'block-private-keys',
    name:        'Block Private Keys',
    description: 'Hard block on any private key material',
    enabled:     true,
    conditions:  { categories: ['PRIVATE_KEY'] },
    action:      'BLOCK',
  },
  {
    id:          'block-critical-keys',
    name:        'Block Critical API Keys',
    description: 'Hard block on AWS, OpenAI, GitHub keys',
    enabled:     true,
    conditions:  {
      ruleIds: ['aws-access-key', 'aws-secret-key', 'openai-key', 'github-pat'],
    },
    action: 'BLOCK',
  },
  {
    id:          'block-db-credentials',
    name:        'Block Database Credentials',
    description: 'Block database connection strings with embedded passwords',
    enabled:     true,
    conditions:  { ruleIds: ['db-connection-string'] },
    action:      'BLOCK',
  },
  {
    id:          'warn-api-keys',
    name:        'Warn on API Keys',
    description: 'Prompt confirmation for any detected API key',
    enabled:     true,
    conditions:  { categories: ['API_KEY'], severities: ['HIGH', 'CRITICAL'] },
    action:      'WARN',
  },
  {
    id:          'mask-credentials',
    name:        'Auto-Mask Credentials',
    description: 'Automatically redact password and secret assignments',
    enabled:     true,
    conditions:  { categories: ['CREDENTIAL'] },
    action:      'MASK',
  },
  {
    id:          'warn-tokens',
    name:        'Warn on Tokens',
    description: 'Warn on JWT or Bearer tokens',
    enabled:     true,
    conditions:  { categories: ['TOKEN'] },
    action:      'WARN',
  },
  {
    id:          'mask-email',
    name:        'Mask Emails',
    description: 'Auto-mask email addresses',
    enabled:     true,
    conditions:  { categories: ['EMAIL'] },
    action:      'MASK',
  },
  {
    id:          'warn-financial',
    name:        'Warn on Financial Data',
    description: 'Warn when credit card or financial data is detected',
    enabled:     true,
    conditions:  { categories: ['FINANCIAL'] },
    action:      'WARN',
  },
  {
    id:          'warn-entropy',
    name:        'Warn on High-Entropy Strings',
    description: 'Warn when a probable secret is detected via entropy analysis',
    enabled:     true,
    conditions:  { ruleIds: ['entropy-detector'] },
    action:      'WARN',
  },
];