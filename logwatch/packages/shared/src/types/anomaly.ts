export type AnomalyType = 'volume_spike' | 'novel_pattern' | 'error_rate' | 'latency';
export type AnomalySeverity = 'critical' | 'warning' | 'info';
export type AnomalyStatus = 'open' | 'acknowledged' | 'resolved' | 'false_positive';
export type UserFeedback = 'helpful' | 'not_helpful' | 'false_positive';
export type ModelType = 'logbert' | 'statistical_rcf' | 'llm_semantic' | 'isolation_forest';
export type ModelStatus = 'training' | 'ready' | 'failed' | 'retired';

export interface Anomaly {
  id: string;
  tenant_id: string;
  service_id: string | null;
  model_id: string | null;
  anomaly_type: AnomalyType;
  severity: AnomalySeverity;
  score: number;
  title: string;
  description: string | null;
  detected_at: string;
  window_start: string;
  window_end: string;
  sample_log_ids: string[];
  related_trace_ids: string[];
  status: AnomalyStatus;
  resolved_at: string | null;
  resolved_by: string | null;
  user_feedback: UserFeedback | null;
  created_at: string;
}

export interface AnomalyModel {
  id: string;
  tenant_id: string;
  service_id: string | null;
  model_type: ModelType;
  model_version: string;
  status: ModelStatus;
  config: Record<string, unknown>;
  artifact_path: string | null;
  training_started_at: string | null;
  training_completed_at: string | null;
  training_log_count: number | null;
  precision_score: number | null;
  recall_score: number | null;
  f1_score: number | null;
  false_positive_rate: number | null;
  created_at: string;
}

export interface AnomalyBaseline {
  id: string;
  tenant_id: string;
  service_id: string;
  metric_name: string;
  baseline_mean: number;
  baseline_stddev: number;
  baseline_p50: number | null;
  baseline_p95: number | null;
  baseline_p99: number | null;
  hourly_pattern: Record<string, number> | null;
  dow_pattern: Record<string, number> | null;
  sample_count: number;
  last_updated_at: string;
}

export interface RcaReport {
  id: string;
  tenant_id: string;
  anomaly_id: string | null;
  summary: string;
  probable_cause: string | null;
  confidence: number | null;
  evidence: RcaEvidence[];
  related_service_ids: string[];
  helpful: boolean | null;
  feedback_notes: string | null;
  generated_at: string;
}

export interface RcaEvidence {
  type: 'log_pattern' | 'trace' | 'deployment' | 'metric_change';
  description: string;
  reference_id: string;
}
