import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotificationService, type AlertPayload } from '../notification.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function makePayload(overrides: Partial<AlertPayload> = {}): AlertPayload {
  return {
    title: 'High Error Rate',
    description: 'Error rate exceeded 5% threshold',
    severity: 'critical',
    anomaly_id: 'anomaly-123',
    rule_name: 'error-rate-spike',
    fired_at: '2026-05-11T10:00:00Z',
    ...overrides,
  };
}

describe('NotificationService', () => {
  let pg: { query: ReturnType<typeof vi.fn> };
  let service: NotificationService;

  beforeEach(() => {
    vi.clearAllMocks();
    pg = { query: vi.fn() };
    service = new NotificationService(pg);
  });

  describe('dispatch() to slack channel', () => {
    it('makes correct fetch call with block kit payload', async () => {
      pg.query.mockResolvedValue({
        rows: [
          {
            id: 'ch-1',
            tenant_id: 'tenant-1',
            name: 'Slack Alerts',
            channel_type: 'slack',
            config: { webhook_url: 'https://hooks.slack.com/services/T00/B00/xxx' },
            is_verified: true,
          },
        ],
      });

      mockFetch.mockResolvedValue({ ok: true, status: 200 });

      const result = await service.dispatch('ch-1', 'tenant-1', makePayload());

      expect(result.success).toBe(true);
      expect(result.channel_id).toBe('ch-1');
      expect(result.channel_type).toBe('slack');

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe('https://hooks.slack.com/services/T00/B00/xxx');
      expect(options.method).toBe('POST');
      expect(options.headers['Content-Type']).toBe('application/json');

      const body = JSON.parse(options.body);
      expect(body.attachments).toHaveLength(1);
      expect(body.attachments[0].color).toBe('danger'); // critical -> danger
      expect(body.attachments[0].blocks).toHaveLength(3);
      expect(body.attachments[0].blocks[0].type).toBe('header');
      expect(body.attachments[0].blocks[0].text.text).toBe('High Error Rate');
    });
  });

  describe('dispatch() to pagerduty channel', () => {
    it('sends correct event payload', async () => {
      pg.query.mockResolvedValue({
        rows: [
          {
            id: 'ch-2',
            tenant_id: 'tenant-1',
            name: 'PagerDuty',
            channel_type: 'pagerduty',
            config: { integration_key: 'pd-key-123' },
            is_verified: true,
          },
        ],
      });

      mockFetch.mockResolvedValue({ ok: true, status: 202 });

      const result = await service.dispatch('ch-2', 'tenant-1', makePayload());

      expect(result.success).toBe(true);
      expect(result.channel_type).toBe('pagerduty');

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe('https://events.pagerduty.com/v2/enqueue');
      expect(options.method).toBe('POST');

      const body = JSON.parse(options.body);
      expect(body.routing_key).toBe('pd-key-123');
      expect(body.event_action).toBe('trigger');
      expect(body.payload.summary).toBe('High Error Rate');
      expect(body.payload.severity).toBe('critical');
      expect(body.payload.source).toBe('logwatch');
      expect(body.payload.custom_details.rule_name).toBe('error-rate-spike');
      expect(body.payload.custom_details.anomaly_id).toBe('anomaly-123');
    });
  });

  describe('dispatch() to webhook channel', () => {
    it('posts payload to configured URL', async () => {
      pg.query.mockResolvedValue({
        rows: [
          {
            id: 'ch-3',
            tenant_id: 'tenant-1',
            name: 'Custom Webhook',
            channel_type: 'webhook',
            config: {
              url: 'https://example.com/webhook',
              headers: { 'X-Api-Key': 'abc123' },
            },
            is_verified: true,
          },
        ],
      });

      mockFetch.mockResolvedValue({ ok: true, status: 200 });

      const result = await service.dispatch('ch-3', 'tenant-1', makePayload());

      expect(result.success).toBe(true);
      expect(result.channel_type).toBe('webhook');

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe('https://example.com/webhook');
      expect(options.method).toBe('POST');
      expect(options.headers['Content-Type']).toBe('application/json');
      expect(options.headers['X-Api-Key']).toBe('abc123');

      const body = JSON.parse(options.body);
      expect(body.event).toBe('alert.fired');
      expect(body.alert.title).toBe('High Error Rate');
      expect(body.alert.severity).toBe('critical');
      expect(body.alert.rule_name).toBe('error-rate-spike');
    });
  });

  describe('error handling', () => {
    it('handles fetch errors gracefully (returns success: false)', async () => {
      pg.query.mockResolvedValue({
        rows: [
          {
            id: 'ch-1',
            tenant_id: 'tenant-1',
            name: 'Slack',
            channel_type: 'slack',
            config: { webhook_url: 'https://hooks.slack.com/fail' },
            is_verified: true,
          },
        ],
      });

      mockFetch.mockRejectedValue(new Error('Network timeout'));

      const result = await service.dispatch('ch-1', 'tenant-1', makePayload());

      expect(result.success).toBe(false);
      expect(result.error).toBe('Network timeout');
      expect(result.channel_id).toBe('ch-1');
    });

    it('handles non-ok HTTP response', async () => {
      pg.query.mockResolvedValue({
        rows: [
          {
            id: 'ch-1',
            tenant_id: 'tenant-1',
            name: 'Slack',
            channel_type: 'slack',
            config: { webhook_url: 'https://hooks.slack.com/fail' },
            is_verified: true,
          },
        ],
      });

      mockFetch.mockResolvedValue({
        ok: false,
        status: 403,
        text: vi.fn().mockResolvedValue('Forbidden'),
      });

      const result = await service.dispatch('ch-1', 'tenant-1', makePayload());

      expect(result.success).toBe(false);
      expect(result.error).toContain('403');
      expect(result.error).toContain('Forbidden');
    });

    it('returns error when channel not found', async () => {
      pg.query.mockResolvedValue({ rows: [] });

      const result = await service.dispatch('nonexistent', 'tenant-1', makePayload());

      expect(result.success).toBe(false);
      expect(result.error).toBe('Notification channel not found');
    });
  });
});
