import type { AlertRule } from '@logwatch/shared';
import type { AlertEvaluator } from '../services/alert-evaluator.js';

export class AlertScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private pg: any,
    private notificationService: any,
    private evaluator: AlertEvaluator,
  ) {}

  start(intervalMs: number = 30_000): void {
    console.log(`AlertScheduler: starting with ${intervalMs}ms interval`);
    this.timer = setInterval(() => {
      this._tick().catch((err) => {
        console.error('AlertScheduler: tick error:', err);
      });
    }, intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      console.log('AlertScheduler: stopped');
    }
  }

  async _tick(): Promise<void> {
    // Fetch all enabled rules that are due for evaluation.
    // This is a trusted server-side worker — no RLS; tenant_id is passed downstream.
    const result = await this.pg.query(
      `SELECT * FROM alert_rules
       WHERE enabled = true
         AND (mute_until IS NULL OR mute_until < NOW())
         AND (
           last_evaluated_at IS NULL
           OR last_evaluated_at + (evaluation_interval_seconds || ' seconds')::INTERVAL < NOW()
         )`,
    );

    const rules: AlertRule[] = result.rows;
    let evaluatedCount = 0;
    let firedCount = 0;

    for (const rule of rules) {
      try {
        // Double-check mute window (covers edge case of mute_until set after query)
        const isMuted = await this.evaluator.checkMute(rule);
        if (isMuted) {
          await this.evaluator.markEvaluated(rule.tenant_id, rule.id);
          evaluatedCount++;
          continue;
        }

        // Evaluate the rule against current data
        const evaluation = await this.evaluator.evaluateRule(rule.tenant_id, rule);

        if (evaluation.should_fire) {
          // Check cooldown before firing
          const inCooldown = await this.evaluator.checkCooldown(
            rule.tenant_id,
            rule.id,
            rule.cooldown_minutes,
          );

          if (!inCooldown) {
            // Dispatch notifications to all configured channels
            const notificationResults = await this.dispatchNotifications(rule, evaluation);

            // Record the alert event
            await this.evaluator.recordEvent(
              rule.tenant_id,
              rule.id,
              evaluation.anomaly_id ?? null,
              notificationResults,
            );
            firedCount++;
          }
        }

        // Always mark as evaluated
        await this.evaluator.markEvaluated(rule.tenant_id, rule.id);
        evaluatedCount++;
      } catch (err) {
        console.error(
          `AlertScheduler: failed to evaluate rule ${rule.id} for tenant ${rule.tenant_id}:`,
          err,
        );
      }
    }

    if (evaluatedCount > 0 || firedCount > 0) {
      console.log(`AlertScheduler: evaluated ${evaluatedCount} rules, fired ${firedCount} alerts`);
    }
  }

  private async dispatchNotifications(
    rule: AlertRule,
    evaluation: { should_fire: boolean; anomaly_id?: string; reason: string },
  ): Promise<any[]> {
    const results: any[] = [];

    const payload = {
      title: `Alert: ${rule.name}`,
      description: evaluation.reason,
      severity: rule.severity,
      anomaly_id: evaluation.anomaly_id,
      rule_name: rule.name,
      fired_at: new Date().toISOString(),
    };

    for (const channelId of rule.notification_channel_ids) {
      try {
        const sendResult = await this.notificationService.dispatch(
          channelId,
          rule.tenant_id,
          payload,
        );
        results.push(sendResult);
      } catch (err) {
        console.error(
          `AlertScheduler: failed to send notification to channel ${channelId}:`,
          err,
        );
        results.push({
          channel_id: channelId,
          success: false,
          error: err instanceof Error ? err.message : String(err),
          sent_at: new Date().toISOString(),
        });
      }
    }

    return results;
  }
}
