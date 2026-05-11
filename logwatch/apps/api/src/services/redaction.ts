import type { Pool } from 'pg';
import type { RedactionRule } from '@logwatch/shared';

const BUILTIN_PATTERNS: Record<string, string> = {
  credit_card: '\\b\\d{4}[- ]?\\d{4}[- ]?\\d{4}[- ]?\\d{4}\\b',
  email: '\\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Z|a-z]{2,}\\b',
  bearer_token: '(?i)bearer\\s+[A-Za-z0-9\\-._~+/]+=*',
};

interface CompiledRule {
  regex: RegExp;
  replacement: string;
  applies_to: 'body' | 'attributes' | 'all';
}

const ruleCache = new Map<string, { rules: CompiledRule[]; cachedAt: number }>();
const CACHE_TTL_MS = 60_000;

export async function loadRedactionRules(
  pool: Pool,
  tenantId: string,
): Promise<CompiledRule[]> {
  const cached = ruleCache.get(tenantId);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    return cached.rules;
  }

  const result = await pool.query<RedactionRule>(
    'SELECT * FROM redaction_rules WHERE tenant_id = $1 AND enabled = true',
    [tenantId],
  );

  const compiled = result.rows
    .map((rule) => {
      const pattern =
        rule.rule_type === 'builtin' ? BUILTIN_PATTERNS[rule.pattern] : rule.pattern;
      if (!pattern) return null;
      try {
        return {
          regex: new RegExp(pattern, 'g'),
          replacement: rule.replacement,
          applies_to: rule.applies_to,
        };
      } catch {
        return null;
      }
    })
    .filter((r): r is CompiledRule => r !== null);

  ruleCache.set(tenantId, { rules: compiled, cachedAt: Date.now() });
  return compiled;
}

export function applyRedaction(
  body: string,
  attributes: Record<string, string>,
  rules: CompiledRule[],
): { body: string; attributes: Record<string, string> } {
  let redactedBody = body;
  const redactedAttrs = { ...attributes };

  for (const rule of rules) {
    if (rule.applies_to === 'body' || rule.applies_to === 'all') {
      redactedBody = redactedBody.replace(rule.regex, rule.replacement);
      rule.regex.lastIndex = 0;
    }

    if (rule.applies_to === 'attributes' || rule.applies_to === 'all') {
      for (const key of Object.keys(redactedAttrs)) {
        redactedAttrs[key] = redactedAttrs[key]!.replace(rule.regex, rule.replacement);
        rule.regex.lastIndex = 0;
      }
    }
  }

  return { body: redactedBody, attributes: redactedAttrs };
}

export function invalidateCache(tenantId: string): void {
  ruleCache.delete(tenantId);
}
