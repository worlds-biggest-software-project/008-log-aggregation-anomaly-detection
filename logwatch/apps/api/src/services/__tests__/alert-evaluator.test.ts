import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AlertEvaluator } from '../alert-evaluator.js';
import type { AlertRule } from '@logwatch/shared';

function makeRule(overrides: Partial<AlertRule> = {}): AlertRule {
  return {
    id: 'rule-1',
    tenant_id: 'tenant-1',
    name: 'Anomaly Alert',
    description: null,
    enabled: true,
    rule_type: 'anomaly',
    condition: {},
    notification_channel_ids: ['ch-1'],
    severity: 'critical',
    evaluation_interval_seconds: 60,
    cooldown_minutes: 15,
    mute_until: null,
    last_evaluated_at: null,
    last_fired_at: null,
    created_by: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('AlertEvaluator', () => {
  let pg: { query: ReturnType<typeof vi.fn> };
  let evaluator: AlertEvaluator;

  beforeEach(() => {
    vi.clearAllMocks();
    pg = { query: vi.fn() };
    evaluator = new AlertEvaluator(pg);
  });

  describe('evaluateRule()', () => {
    it('queries open anomalies for anomaly rule type', async () => {
      pg.query.mockResolvedValue({
        rows: [
          {
            id: 'anomaly-1',
            anomaly_type: 'log_volume_spike',
            severity: 'critical',
            score: 0.95,
          },
        ],
      });

      const rule = makeRule({
        rule_type: 'anomaly',
        condition: { anomaly_type: 'log_volume_spike', severity_gte: 'warning' },
      });

      const result = await evaluator.evaluateRule('tenant-1', rule);

      expect(result.should_fire).toBe(true);
      expect(result.anomaly_id).toBe('anomaly-1');
      expect(result.reason).toContain('critical');
      expect(result.reason).toContain('log_volume_spike');
      expect(result.reason).toContain('0.95');

      // Verify the query targets open anomalies for the tenant
      const [sql, params] = pg.query.mock.calls[0];
      expect(sql).toContain("status = 'open'");
      expect(sql).toContain('tenant_id = $1');
      expect(params[0]).toBe('tenant-1');
    });

    it('returns should_fire: false when no matching anomalies exist', async () => {
      pg.query.mockResolvedValue({ rows: [] });

      const rule = makeRule({ rule_type: 'anomaly' });
      const result = await evaluator.evaluateRule('tenant-1', rule);

      expect(result.should_fire).toBe(false);
      expect(result.reason).toBe('No matching open anomalies found');
    });

    it('returns should_fire: false for unimplemented rule types', async () => {
      const rule = makeRule({ rule_type: 'log_pattern' });
      const result = await evaluator.evaluateRule('tenant-1', rule);

      expect(result.should_fire).toBe(false);
      expect(result.reason).toBe('Rule type not yet implemented');
    });

    it('filters by last_evaluated_at when set', async () => {
      pg.query.mockResolvedValue({ rows: [] });

      const rule = makeRule({
        rule_type: 'anomaly',
        last_evaluated_at: '2026-05-11T09:00:00Z',
      });

      await evaluator.evaluateRule('tenant-1', rule);

      const [sql, params] = pg.query.mock.calls[0];
      expect(sql).toContain('detected_at > $');
      expect(params).toContain('2026-05-11T09:00:00Z');
    });
  });

  describe('checkCooldown()', () => {
    it('returns true when recent event exists within cooldown window', async () => {
      pg.query.mockResolvedValue({ rows: [{ '?column?': 1 }] });

      const result = await evaluator.checkCooldown('tenant-1', 'rule-1', 15);

      expect(result).toBe(true);
      const [sql, params] = pg.query.mock.calls[0];
      expect(sql).toContain('alert_events');
      expect(params).toEqual(['tenant-1', 'rule-1', 15]);
    });

    it('returns false when no recent events', async () => {
      pg.query.mockResolvedValue({ rows: [] });

      const result = await evaluator.checkCooldown('tenant-1', 'rule-1', 15);

      expect(result).toBe(false);
    });
  });

  describe('checkMute()', () => {
    it('returns true when mute_until is in the future', async () => {
      const futureDate = new Date(Date.now() + 3600_000).toISOString(); // 1 hour from now
      const rule = makeRule({ mute_until: futureDate });

      const result = await evaluator.checkMute(rule);

      expect(result).toBe(true);
    });

    it('returns false when mute_until is null', async () => {
      const rule = makeRule({ mute_until: null });

      const result = await evaluator.checkMute(rule);

      expect(result).toBe(false);
    });

    it('returns false when mute_until is in the past', async () => {
      const pastDate = new Date(Date.now() - 3600_000).toISOString(); // 1 hour ago
      const rule = makeRule({ mute_until: pastDate });

      const result = await evaluator.checkMute(rule);

      expect(result).toBe(false);
    });
  });

  describe('markEvaluated()', () => {
    it('updates last_evaluated_at', async () => {
      pg.query.mockResolvedValue({ rows: [] });

      await evaluator.markEvaluated('tenant-1', 'rule-1');

      expect(pg.query).toHaveBeenCalledOnce();
      const [sql, params] = pg.query.mock.calls[0];
      expect(sql).toContain('UPDATE alert_rules');
      expect(sql).toContain('last_evaluated_at = NOW()');
      expect(params).toEqual(['tenant-1', 'rule-1']);
    });
  });
});
