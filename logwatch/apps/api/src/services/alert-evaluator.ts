import type { AlertRule } from '@logwatch/shared';

export interface EvaluationResult {
  should_fire: boolean;
  anomaly_id?: string;
  reason: string;
}

const SEVERITY_ORDER: Record<string, number> = {
  info: 0,
  warning: 1,
  critical: 2,
};

export class AlertEvaluator {
  constructor(private pg: any) {}

  async evaluateRule(tenantId: string, rule: AlertRule): Promise<EvaluationResult> {
    switch (rule.rule_type) {
      case 'anomaly':
        return this.evaluateAnomalyRule(tenantId, rule);
      case 'log_pattern':
      case 'metric_threshold':
      case 'log_absence':
        return { should_fire: false, reason: 'Rule type not yet implemented' };
      default:
        return { should_fire: false, reason: `Unknown rule type: ${rule.rule_type}` };
    }
  }

  async checkCooldown(
    tenantId: string,
    ruleId: string,
    cooldownMinutes: number,
  ): Promise<boolean> {
    const result = await this.pg.query(
      `SELECT 1 FROM alert_events
       WHERE tenant_id = $1
         AND alert_rule_id = $2
         AND fired_at > NOW() - ($3 || ' minutes')::INTERVAL
       LIMIT 1`,
      [tenantId, ruleId, cooldownMinutes],
    );
    return result.rows.length > 0;
  }

  async checkMute(rule: AlertRule): Promise<boolean> {
    if (!rule.mute_until) return false;
    return new Date(rule.mute_until) > new Date();
  }

  async recordEvent(
    tenantId: string,
    ruleId: string,
    anomalyId: string | null,
    notificationResults: any[],
  ): Promise<string> {
    const insertResult = await this.pg.query(
      `INSERT INTO alert_events (tenant_id, alert_rule_id, anomaly_id, status, fired_at, notification_results)
       VALUES ($1, $2, $3, 'firing', NOW(), $4)
       RETURNING id`,
      [tenantId, ruleId, anomalyId, JSON.stringify(notificationResults)],
    );

    await this.pg.query(
      `UPDATE alert_rules
       SET last_fired_at = NOW(), last_evaluated_at = NOW(), updated_at = NOW()
       WHERE tenant_id = $1 AND id = $2`,
      [tenantId, ruleId],
    );

    return insertResult.rows[0].id;
  }

  async markEvaluated(tenantId: string, ruleId: string): Promise<void> {
    await this.pg.query(
      `UPDATE alert_rules
       SET last_evaluated_at = NOW(), updated_at = NOW()
       WHERE tenant_id = $1 AND id = $2`,
      [tenantId, ruleId],
    );
  }

  private async evaluateAnomalyRule(
    tenantId: string,
    rule: AlertRule,
  ): Promise<EvaluationResult> {
    const conditions = ['tenant_id = $1', "status = 'open'"];
    const params: unknown[] = [tenantId];
    let idx = 2;

    // Time window: only consider anomalies after last evaluation (or last hour)
    if (rule.last_evaluated_at) {
      conditions.push(`detected_at > $${idx++}`);
      params.push(rule.last_evaluated_at);
    } else {
      conditions.push(`detected_at > NOW() - INTERVAL '1 hour'`);
    }

    // Match anomaly type if specified
    if (rule.condition.anomaly_type) {
      conditions.push(`anomaly_type = $${idx++}`);
      params.push(rule.condition.anomaly_type);
    }

    // Severity filter: only include anomalies at or above the threshold
    if (rule.condition.severity_gte) {
      const threshold = SEVERITY_ORDER[rule.condition.severity_gte] ?? 0;
      const matchingSeverities = Object.entries(SEVERITY_ORDER)
        .filter(([, level]) => level >= threshold)
        .map(([name]) => name);

      if (matchingSeverities.length > 0) {
        const placeholders = matchingSeverities.map((_, i) => `$${idx + i}`).join(', ');
        conditions.push(`severity IN (${placeholders})`);
        params.push(...matchingSeverities);
        idx += matchingSeverities.length;
      }
    }

    const where = conditions.join(' AND ');

    // Order by severity descending (critical first) then by score
    const result = await this.pg.query(
      `SELECT id, anomaly_type, severity, score
       FROM anomalies
       WHERE ${where}
       ORDER BY
         CASE severity
           WHEN 'critical' THEN 2
           WHEN 'warning' THEN 1
           WHEN 'info' THEN 0
         END DESC,
         score DESC
       LIMIT 1`,
      params,
    );

    if (result.rows.length === 0) {
      return { should_fire: false, reason: 'No matching open anomalies found' };
    }

    const anomaly = result.rows[0];
    return {
      should_fire: true,
      anomaly_id: anomaly.id,
      reason: `Matched ${anomaly.severity} ${anomaly.anomaly_type} anomaly (score: ${anomaly.score})`,
    };
  }
}
