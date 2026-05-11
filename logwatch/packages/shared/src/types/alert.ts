export type ChannelType = 'slack' | 'pagerduty' | 'email' | 'webhook';
export type RuleType = 'anomaly' | 'log_pattern' | 'metric_threshold' | 'log_absence';
export type AlertEventStatus = 'firing' | 'resolved';

export interface NotificationChannel {
  id: string;
  tenant_id: string;
  name: string;
  channel_type: ChannelType;
  config: SlackConfig | PagerDutyConfig | EmailConfig | WebhookConfig;
  is_verified: boolean;
  created_at: string;
}

export interface SlackConfig {
  webhook_url: string;
  channel?: string;
}

export interface PagerDutyConfig {
  integration_key: string;
}

export interface EmailConfig {
  recipients: string[];
}

export interface WebhookConfig {
  url: string;
  headers?: Record<string, string>;
}

export interface AlertRule {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  enabled: boolean;
  rule_type: RuleType;
  condition: AlertCondition;
  notification_channel_ids: string[];
  severity: string;
  evaluation_interval_seconds: number;
  cooldown_minutes: number;
  mute_until: string | null;
  last_evaluated_at: string | null;
  last_fired_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface AlertCondition {
  anomaly_type?: string;
  severity_gte?: string;
  query_type?: string;
  query?: string;
  operator?: string;
  threshold?: number;
  pattern?: string;
  absence_window_minutes?: number;
}

export interface AlertEvent {
  id: string;
  tenant_id: string;
  alert_rule_id: string;
  anomaly_id: string | null;
  status: AlertEventStatus;
  fired_at: string;
  resolved_at: string | null;
  notification_results: NotificationResult[];
  created_at: string;
}

export interface NotificationResult {
  channel_id: string;
  channel_type: ChannelType;
  success: boolean;
  error?: string;
  sent_at: string;
}
