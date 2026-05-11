import type { ClickHouseClient } from '@clickhouse/client';
import type { Pool } from 'pg';
import { upsertService } from '../services/service-registry.js';

interface EdgeRow {
  tenant_id: string;
  source_service: string;
  parent_service: string;
  call_count: number;
  avg_duration_ms: number;
  error_rate: number;
}

export class GraphBuilder {
  private running = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private clickhouse: ClickHouseClient,
    private pg: Pool,
    private intervalMs = 300_000, // 5 minutes
  ) {}

  async start(): Promise<void> {
    this.running = true;
    this.schedule();
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private schedule(): void {
    if (!this.running) return;

    this.buildGraph()
      .catch((err) => {
        console.error('GraphBuilder cycle error:', err);
      })
      .finally(() => {
        if (this.running) {
          this.timer = setTimeout(() => this.schedule(), this.intervalMs);
        }
      });
  }

  private async buildGraph(): Promise<void> {
    const query = `
      SELECT
        tenant_id,
        service_name AS source_service,
        parent_service,
        count() AS call_count,
        avg(duration_ns) / 1e6 AS avg_duration_ms,
        countIf(status_code = 'ERROR') / count() AS error_rate
      FROM (
        SELECT
          s.tenant_id,
          s.service_name,
          s.parent_span_id,
          s.duration_ns,
          s.status_code,
          p.service_name AS parent_service
        FROM otel_traces s
        INNER JOIN otel_traces p
          ON s.tenant_id = p.tenant_id
          AND s.parent_span_id = p.span_id
          AND p.start_time >= now() - INTERVAL 1 DAY
        WHERE s.start_time >= now() - INTERVAL 1 DAY
          AND s.parent_span_id != ''
          AND s.service_name != p.service_name
      ) sub
      GROUP BY tenant_id, source_service, parent_service
    `;

    const resultSet = await this.clickhouse.query({ query, format: 'JSONEachRow' });
    const edges = await resultSet.json<EdgeRow>();

    for (const edge of edges) {
      try {
        const [sourceId, targetId] = await Promise.all([
          upsertService(this.pg, edge.tenant_id, edge.source_service),
          upsertService(this.pg, edge.tenant_id, edge.parent_service),
        ]);

        await this.pg.query(
          `INSERT INTO service_dependencies (
            tenant_id, source_service_id, target_service_id,
            dependency_type, discovered_from,
            call_count_24h, avg_duration_ms, error_rate_24h, last_seen_at
          )
          VALUES ($1, $2, $3, 'calls', 'traces', $4, $5, $6, now())
          ON CONFLICT (tenant_id, source_service_id, target_service_id)
          DO UPDATE SET
            call_count_24h = EXCLUDED.call_count_24h,
            avg_duration_ms = EXCLUDED.avg_duration_ms,
            error_rate_24h = EXCLUDED.error_rate_24h,
            last_seen_at = now()`,
          [edge.tenant_id, sourceId, targetId, edge.call_count, edge.avg_duration_ms, edge.error_rate],
        );
      } catch (err) {
        console.error(
          `GraphBuilder: failed to upsert edge ${edge.source_service} -> ${edge.parent_service} ` +
            `for tenant ${edge.tenant_id}:`,
          err,
        );
      }
    }
  }
}
