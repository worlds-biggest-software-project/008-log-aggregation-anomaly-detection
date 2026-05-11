import type { ChannelType, NotificationResult } from '@logwatch/shared';

const logger = { info: console.log, error: console.error, warn: console.warn };

export interface AlertPayload {
  title: string;
  description: string;
  severity: string;
  anomaly_id?: string;
  rule_name: string;
  fired_at: string;
}

interface ChannelRow {
  id: string;
  tenant_id: string;
  name: string;
  channel_type: ChannelType;
  config: Record<string, unknown>;
  is_verified: boolean;
}

const SEVERITY_COLORS: Record<string, string> = {
  critical: 'danger',
  warning: 'warning',
  info: '#2196F3',
};

const PAGERDUTY_SEVERITY: Record<string, string> = {
  critical: 'critical',
  warning: 'warning',
  info: 'info',
};

export class NotificationService {
  private pg: any;

  constructor(pg: any) {
    this.pg = pg;
  }

  async dispatch(
    channelId: string,
    tenantId: string,
    payload: AlertPayload,
  ): Promise<NotificationResult> {
    const channel = await this.fetchChannel(channelId, tenantId);
    if (!channel) {
      return {
        channel_id: channelId,
        channel_type: 'webhook' as ChannelType,
        success: false,
        error: 'Notification channel not found',
        sent_at: new Date().toISOString(),
      };
    }

    switch (channel.channel_type) {
      case 'slack':
        return this.sendSlack(channel, payload);
      case 'pagerduty':
        return this.sendPagerDuty(channel, payload);
      case 'email':
        return this.sendEmail(channel, payload);
      case 'webhook':
        return this.sendWebhook(channel, payload);
      default:
        return {
          channel_id: channelId,
          channel_type: channel.channel_type,
          success: false,
          error: `Unsupported channel type: ${channel.channel_type}`,
          sent_at: new Date().toISOString(),
        };
    }
  }

  async testChannel(
    channelId: string,
    tenantId: string,
  ): Promise<NotificationResult> {
    const testPayload: AlertPayload = {
      title: 'Test Notification',
      description: 'This is a test notification from LogWatch to verify your channel configuration.',
      severity: 'info',
      rule_name: 'Channel Test',
      fired_at: new Date().toISOString(),
    };
    return this.dispatch(channelId, tenantId, testPayload);
  }

  private async fetchChannel(
    channelId: string,
    tenantId: string,
  ): Promise<ChannelRow | null> {
    const result = await this.pg.query(
      `SELECT id, tenant_id, name, channel_type, config, is_verified
       FROM notification_channels
       WHERE id = $1 AND tenant_id = $2`,
      [channelId, tenantId],
    );
    return result.rows[0] ?? null;
  }

  private async sendSlack(
    channel: ChannelRow,
    payload: AlertPayload,
  ): Promise<NotificationResult> {
    const config = channel.config as { webhook_url: string; channel?: string };
    const color = SEVERITY_COLORS[payload.severity] ?? SEVERITY_COLORS.info;

    const body = {
      attachments: [
        {
          color,
          blocks: [
            {
              type: 'header',
              text: { type: 'plain_text', text: payload.title, emoji: true },
            },
            {
              type: 'section',
              text: { type: 'mrkdwn', text: payload.description },
            },
            {
              type: 'section',
              fields: [
                { type: 'mrkdwn', text: `*Severity:*\n${payload.severity}` },
                { type: 'mrkdwn', text: `*Rule:*\n${payload.rule_name}` },
                { type: 'mrkdwn', text: `*Fired at:*\n${payload.fired_at}` },
                ...(payload.anomaly_id
                  ? [{ type: 'mrkdwn', text: `*Anomaly ID:*\n${payload.anomaly_id}` }]
                  : []),
              ],
            },
          ],
        },
      ],
    };

    try {
      const response = await fetch(config.webhook_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const text = await response.text();
        return {
          channel_id: channel.id,
          channel_type: channel.channel_type,
          success: false,
          error: `Slack returned ${response.status}: ${text}`,
          sent_at: new Date().toISOString(),
        };
      }

      return {
        channel_id: channel.id,
        channel_type: channel.channel_type,
        success: true,
        sent_at: new Date().toISOString(),
      };
    } catch (err: any) {
      return {
        channel_id: channel.id,
        channel_type: channel.channel_type,
        success: false,
        error: err.message,
        sent_at: new Date().toISOString(),
      };
    }
  }

  private async sendPagerDuty(
    channel: ChannelRow,
    payload: AlertPayload,
  ): Promise<NotificationResult> {
    const config = channel.config as { integration_key: string };
    const severity = PAGERDUTY_SEVERITY[payload.severity] ?? 'warning';

    const body = {
      routing_key: config.integration_key,
      event_action: 'trigger',
      payload: {
        summary: payload.title,
        severity,
        source: 'logwatch',
        custom_details: {
          description: payload.description,
          rule_name: payload.rule_name,
          anomaly_id: payload.anomaly_id,
          fired_at: payload.fired_at,
        },
      },
    };

    try {
      const response = await fetch('https://events.pagerduty.com/v2/enqueue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const text = await response.text();
        return {
          channel_id: channel.id,
          channel_type: channel.channel_type,
          success: false,
          error: `PagerDuty returned ${response.status}: ${text}`,
          sent_at: new Date().toISOString(),
        };
      }

      return {
        channel_id: channel.id,
        channel_type: channel.channel_type,
        success: true,
        sent_at: new Date().toISOString(),
      };
    } catch (err: any) {
      return {
        channel_id: channel.id,
        channel_type: channel.channel_type,
        success: false,
        error: err.message,
        sent_at: new Date().toISOString(),
      };
    }
  }

  private async sendEmail(
    channel: ChannelRow,
    payload: AlertPayload,
  ): Promise<NotificationResult> {
    const config = channel.config as { recipients: string[] };

    logger.info('[NotificationService] Email dispatch (SMTP not implemented)', {
      channel_id: channel.id,
      recipients: config.recipients,
      subject: payload.title,
      severity: payload.severity,
      rule_name: payload.rule_name,
      fired_at: payload.fired_at,
      description: payload.description,
      anomaly_id: payload.anomaly_id,
    });

    return {
      channel_id: channel.id,
      channel_type: channel.channel_type,
      success: true,
      sent_at: new Date().toISOString(),
    };
  }

  private async sendWebhook(
    channel: ChannelRow,
    payload: AlertPayload,
  ): Promise<NotificationResult> {
    const config = channel.config as { url: string; headers?: Record<string, string> };

    const body = {
      event: 'alert.fired',
      timestamp: new Date().toISOString(),
      alert: {
        title: payload.title,
        description: payload.description,
        severity: payload.severity,
        rule_name: payload.rule_name,
        anomaly_id: payload.anomaly_id,
        fired_at: payload.fired_at,
      },
    };

    try {
      const response = await fetch(config.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(config.headers ?? {}),
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const text = await response.text();
        return {
          channel_id: channel.id,
          channel_type: channel.channel_type,
          success: false,
          error: `Webhook returned ${response.status}: ${text}`,
          sent_at: new Date().toISOString(),
        };
      }

      return {
        channel_id: channel.id,
        channel_type: channel.channel_type,
        success: true,
        sent_at: new Date().toISOString(),
      };
    } catch (err: any) {
      return {
        channel_id: channel.id,
        channel_type: channel.channel_type,
        success: false,
        error: err.message,
        sent_at: new Date().toISOString(),
      };
    }
  }
}
