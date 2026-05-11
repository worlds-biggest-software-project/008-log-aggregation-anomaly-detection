import type { ClickHouseClient } from '@clickhouse/client';
import type { Pool } from 'pg';

interface LogVolumeRow {
  tenant_id: string;
  service_name: string;
  date: string;
  log_count: string;
  log_bytes: string;
}

interface TraceVolumeRow {
  tenant_id: string;
  service_name: string;
  date: string;
  trace_count: string;
  trace_bytes: string;
}

const COST_PER_GB_USD = 0.50;
const BYTES_PER_GB = 1_073_741_824;

export class UsageTracker {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private pg: Pool,
    private ch: ClickHouseClient,
  ) {}

  start(intervalMs: number = 3_600_000): void {
    console.log(`UsageTracker: starting with ${intervalMs}ms interval`);
    // Run immediately, then on interval
    this._tick().catch((err) => {
      console.error('UsageTracker: initial tick error:', err);
    });
    this.timer = setInterval(() => {
      this._tick().catch((err) => {
        console.error('UsageTracker: tick error:', err);
      });
    }, intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      console.log('UsageTracker: stopped');
    }
  }

  async _tick(): Promise<void> {
    // Query yesterday and today so we catch late-arriving data
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const startDate = yesterday.toISOString().slice(0, 10);

    // 1. Aggregate log volumes from ClickHouse
    const logResult = await this.ch.query({
      query: `
        SELECT
          tenant_id,
          resource_string['service.name'] AS service_name,
          toDate(timestamp) AS date,
          count() AS log_count,
          sum(length(body)) AS log_bytes
        FROM otel_logs
        WHERE timestamp >= {startDate:String}
        GROUP BY tenant_id, service_name, date
      `,
      query_params: { startDate },
      format: 'JSONEachRow',
    });
    const logRows = await logResult.json<LogVolumeRow>();

    // 2. Aggregate trace volumes from ClickHouse
    const traceResult = await this.ch.query({
      query: `
        SELECT
          tenant_id,
          service_name,
          toDate(start_time) AS date,
          count() AS trace_count,
          sum(length(operation_name)) AS trace_bytes
        FROM otel_traces
        WHERE start_time >= {startDate:String}
        GROUP BY tenant_id, service_name, date
      `,
      query_params: { startDate },
      format: 'JSONEachRow',
    });
    const traceRows = await traceResult.json<TraceVolumeRow>();

    // Build a map keyed by (tenant_id, service_name, date)
    const usageMap = new Map<
      string,
      {
        tenant_id: string;
        service_name: string;
        date: string;
        log_count: number;
        log_bytes: number;
        trace_count: number;
        trace_bytes: number;
      }
    >();

    const makeKey = (tenantId: string, serviceName: string, date: string) =>
      `${tenantId}|${serviceName}|${date}`;

    for (const row of logRows) {
      const key = makeKey(row.tenant_id, row.service_name, row.date);
      usageMap.set(key, {
        tenant_id: row.tenant_id,
        service_name: row.service_name,
        date: row.date,
        log_count: parseInt(row.log_count, 10),
        log_bytes: parseInt(row.log_bytes, 10),
        trace_count: 0,
        trace_bytes: 0,
      });
    }

    for (const row of traceRows) {
      const key = makeKey(row.tenant_id, row.service_name, row.date);
      const existing = usageMap.get(key);
      if (existing) {
        existing.trace_count = parseInt(row.trace_count, 10);
        existing.trace_bytes = parseInt(row.trace_bytes, 10);
      } else {
        usageMap.set(key, {
          tenant_id: row.tenant_id,
          service_name: row.service_name,
          date: row.date,
          log_count: 0,
          log_bytes: 0,
          trace_count: parseInt(row.trace_count, 10),
          trace_bytes: parseInt(row.trace_bytes, 10),
        });
      }
    }

    // 3. Look up service IDs and upsert into ingest_usage
    let upsertedCount = 0;

    for (const usage of usageMap.values()) {
      try {
        // Look up service_id from PostgreSQL
        const svcResult = await this.pg.query<{ id: string }>(
          `SELECT id FROM services WHERE tenant_id = $1 AND name = $2 LIMIT 1`,
          [usage.tenant_id, usage.service_name],
        );

        if (svcResult.rows.length === 0) {
          // Service not registered yet — skip
          continue;
        }

        const serviceId = svcResult.rows[0]!.id;
        const totalBytes = usage.log_bytes + usage.trace_bytes;
        const estimatedCostUsd = (totalBytes / BYTES_PER_GB) * COST_PER_GB_USD;

        // Upsert into ingest_usage
        await this.pg.query(
          `INSERT INTO ingest_usage (
            tenant_id, service_id, date,
            log_count, log_bytes, trace_count, trace_bytes,
            estimated_cost_usd
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          ON CONFLICT (tenant_id, service_id, date)
          DO UPDATE SET
            log_count = EXCLUDED.log_count,
            log_bytes = EXCLUDED.log_bytes,
            trace_count = EXCLUDED.trace_count,
            trace_bytes = EXCLUDED.trace_bytes,
            estimated_cost_usd = EXCLUDED.estimated_cost_usd`,
          [
            usage.tenant_id,
            serviceId,
            usage.date,
            usage.log_count,
            usage.log_bytes,
            usage.trace_count,
            usage.trace_bytes,
            estimatedCostUsd,
          ],
        );

        upsertedCount++;
      } catch (err) {
        console.error(
          `UsageTracker: failed to upsert usage for tenant ${usage.tenant_id}, ` +
            `service ${usage.service_name}, date ${usage.date}:`,
          err,
        );
      }
    }

    if (upsertedCount > 0) {
      console.log(`UsageTracker: upserted ${upsertedCount} usage records`);
    }
  }
}
