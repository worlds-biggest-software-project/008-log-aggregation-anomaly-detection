import type { ClickHouseClient } from '@clickhouse/client';
import type { Pool } from 'pg';

export interface SamplingRecommendation {
  id: string;
  tenant_id: string;
  service_id: string;
  pattern: string;
  current_volume_daily: number;
  recommended_sample_rate: number;
  estimated_savings_pct: number;
  reasoning: string | null;
  status: string;
  applied_at: string | null;
  applied_by: string | null;
  created_at: string;
}

interface PatternRow {
  service_name: string;
  severity_text: string;
  pattern_prefix: string;
  volume: string;
}

const HEALTH_CHECK_PATTERNS = [
  '/health',
  '/healthz',
  '/ready',
  '/readyz',
  '/livez',
  '/ping',
  'health check',
  'healthcheck',
  'liveness',
  'readiness',
];

export class SamplingService {
  constructor(
    private pg: Pool,
    private ch: ClickHouseClient,
  ) {}

  async generateRecommendations(tenantId: string): Promise<SamplingRecommendation[]> {
    // 1. Query ClickHouse for high-volume log patterns over the last 7 days
    const result = await this.ch.query({
      query: `
        SELECT
          resource_string['service.name'] AS service_name,
          severity_text,
          substring(body, 1, 100) AS pattern_prefix,
          count() AS volume
        FROM otel_logs
        WHERE tenant_id = {tenantId:String}
          AND timestamp >= now() - INTERVAL 7 DAY
        GROUP BY service_name, severity_text, pattern_prefix
        HAVING volume > 10000
        ORDER BY volume DESC
        LIMIT 20
      `,
      query_params: { tenantId },
      format: 'JSONEachRow',
    });

    const patterns = await result.json<PatternRow>();
    const recommendations: SamplingRecommendation[] = [];

    for (const pattern of patterns) {
      try {
        // Look up service_id
        const svcResult = await this.pg.query<{ id: string }>(
          `SELECT id FROM services WHERE tenant_id = $1 AND name = $2 LIMIT 1`,
          [tenantId, pattern.service_name],
        );

        if (svcResult.rows.length === 0) {
          continue;
        }

        const serviceId = svcResult.rows[0]!.id;
        const dailyVolume = Math.round(parseInt(pattern.volume, 10) / 7);
        const severity = pattern.severity_text.toUpperCase();
        const patternLower = pattern.pattern_prefix.toLowerCase();

        // 2. Determine sample rate based on pattern characteristics
        let sampleRate: number;
        let reasoning: string;

        const isHealthCheck = HEALTH_CHECK_PATTERNS.some((hc) => patternLower.includes(hc));

        if (isHealthCheck) {
          sampleRate = 0.05;
          reasoning =
            `Health check pattern detected ("${pattern.pattern_prefix.slice(0, 50)}"). ` +
            `These are high-frequency, low-signal logs that rarely contain actionable information. ` +
            `Recommend keeping only 5% to drastically reduce volume while preserving anomaly visibility.`;
        } else if (severity === 'DEBUG' || severity === 'TRACE') {
          sampleRate = 0.10;
          reasoning =
            `${severity}-level logs from ${pattern.service_name} matching ` +
            `"${pattern.pattern_prefix.slice(0, 50)}" are generating ~${dailyVolume.toLocaleString()} entries/day. ` +
            `Debug/trace logs are typically needed only during active investigation. ` +
            `Recommend sampling at 10% to reduce cost while retaining enough data for debugging.`;
        } else {
          sampleRate = 0.50;
          reasoning =
            `High-volume pattern from ${pattern.service_name} ` +
            `("${pattern.pattern_prefix.slice(0, 50)}") at ~${dailyVolume.toLocaleString()} entries/day. ` +
            `Recommend 50% sampling as a balanced approach to reduce cost while maintaining ` +
            `statistical significance for anomaly detection.`;
        }

        // 3. Calculate estimated savings percentage
        const estimatedSavingsPct = (1 - sampleRate) * 100;

        // 4. Upsert recommendation into sampling_recommendations
        const upsertResult = await this.pg.query<SamplingRecommendation>(
          `INSERT INTO sampling_recommendations (
            tenant_id, service_id, pattern,
            current_volume_daily, recommended_sample_rate,
            estimated_savings_pct, reasoning, status
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')
          ON CONFLICT (tenant_id, service_id, pattern)
            DO UPDATE SET
              current_volume_daily = EXCLUDED.current_volume_daily,
              recommended_sample_rate = EXCLUDED.recommended_sample_rate,
              estimated_savings_pct = EXCLUDED.estimated_savings_pct,
              reasoning = EXCLUDED.reasoning,
              status = CASE
                WHEN sampling_recommendations.status = 'dismissed' THEN 'dismissed'
                ELSE 'pending'
              END
          RETURNING *`,
          [
            tenantId,
            serviceId,
            pattern.pattern_prefix,
            dailyVolume,
            sampleRate,
            estimatedSavingsPct,
            reasoning,
          ],
        );

        recommendations.push(upsertResult.rows[0]!);
      } catch (err) {
        console.error(
          `SamplingService: failed to process pattern "${pattern.pattern_prefix}" ` +
            `for service ${pattern.service_name}:`,
          err,
        );
      }
    }

    return recommendations;
  }

  async applyRecommendation(
    tenantId: string,
    recommendationId: string,
    userId: string,
  ): Promise<void> {
    // 1. Fetch the recommendation
    const recResult = await this.pg.query<SamplingRecommendation>(
      `SELECT * FROM sampling_recommendations
       WHERE id = $1 AND tenant_id = $2`,
      [recommendationId, tenantId],
    );

    if (recResult.rows.length === 0) {
      throw new Error('Recommendation not found');
    }

    const rec = recResult.rows[0]!;

    // 2. Update the recommendation status to 'applied'
    await this.pg.query(
      `UPDATE sampling_recommendations
       SET status = 'applied', applied_at = NOW(), applied_by = $3
       WHERE id = $1 AND tenant_id = $2`,
      [recommendationId, tenantId, userId],
    );

    // 3. Store the sampling rule in tenant settings
    const samplingRule = {
      service_id: rec.service_id,
      pattern: rec.pattern,
      sample_rate: rec.recommended_sample_rate,
      applied_at: new Date().toISOString(),
      recommendation_id: rec.id,
    };

    await this.pg.query(
      `UPDATE tenants
       SET settings = CASE
         WHEN settings IS NULL THEN jsonb_build_object('sampling_rules', jsonb_build_array($2::jsonb))
         WHEN settings->'sampling_rules' IS NULL THEN jsonb_set(settings, '{sampling_rules}', jsonb_build_array($2::jsonb))
         ELSE jsonb_set(settings, '{sampling_rules}', (settings->'sampling_rules') || $2::jsonb)
       END
       WHERE id = $1`,
      [tenantId, JSON.stringify(samplingRule)],
    );
  }

  async dismissRecommendation(
    tenantId: string,
    recommendationId: string,
  ): Promise<void> {
    const result = await this.pg.query(
      `UPDATE sampling_recommendations
       SET status = 'dismissed'
       WHERE id = $1 AND tenant_id = $2
       RETURNING id`,
      [recommendationId, tenantId],
    );

    if (result.rows.length === 0) {
      throw new Error('Recommendation not found');
    }
  }
}
