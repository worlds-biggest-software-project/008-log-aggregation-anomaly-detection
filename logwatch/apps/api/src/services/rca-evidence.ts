import type { ClickHouseClient } from '@clickhouse/client';

export interface RCAEvidence {
  anomaly: {
    id: string;
    anomaly_type: string;
    severity: string;
    title: string;
    description: string;
    window_start: string;
    window_end: string;
    service_name: string;
  };
  related_logs: Array<{
    timestamp: string;
    severity_text: string;
    body: string;
    service_name: string;
  }>;
  related_traces: Array<{
    trace_id: string;
    service_name: string;
    operation_name: string;
    status_code: string;
    duration_ns: number;
  }>;
  recent_deployments: Array<{
    version: string;
    deployer: string;
    deployed_at: string;
    changelog: string;
    service_name: string;
  }>;
  baseline_context: Array<{
    metric_name: string;
    baseline_mean: number;
    baseline_stddev: number;
  }>;
}

export class RCAEvidenceGatherer {
  private pg: any;
  private ch: ClickHouseClient;

  constructor(pg: any, ch: ClickHouseClient) {
    this.pg = pg;
    this.ch = ch;
  }

  async gather(tenantId: string, anomalyId: string): Promise<RCAEvidence> {
    // 1. Fetch the anomaly from PostgreSQL (JOIN services for service_name)
    const anomalyResult = await this.pg.query(
      `SELECT
        a.id, a.anomaly_type, a.severity, a.title, a.description,
        a.window_start, a.window_end, a.service_id,
        s.name AS service_name
      FROM anomalies a
      LEFT JOIN services s ON s.id = a.service_id
      WHERE a.id = $1 AND a.tenant_id = $2`,
      [anomalyId, tenantId],
    );

    if (anomalyResult.rows.length === 0) {
      const err = new Error('Anomaly not found') as Error & { statusCode: number };
      err.statusCode = 404;
      throw err;
    }

    const anomalyRow = anomalyResult.rows[0];
    const windowStart = new Date(anomalyRow.window_start).toISOString();
    const windowEnd = new Date(anomalyRow.window_end).toISOString();

    // 2. Fetch related logs from ClickHouse
    const logsResult = await this.ch.query({
      query: `SELECT
        timestamp,
        severity_text,
        body,
        resource_string['service.name'] as service_name
      FROM otel_logs
      WHERE tenant_id = {tenantId:String}
        AND timestamp >= {windowStart:String}
        AND timestamp <= {windowEnd:String}
      ORDER BY timestamp DESC
      LIMIT 50`,
      query_params: { tenantId, windowStart, windowEnd },
      format: 'JSONEachRow',
    });

    const relatedLogs = await logsResult.json<{
      timestamp: string;
      severity_text: string;
      body: string;
      service_name: string;
    }>();

    // 3. Fetch related traces from ClickHouse
    const tracesResult = await this.ch.query({
      query: `SELECT
        trace_id,
        service_name,
        operation_name,
        status_code,
        duration_ns
      FROM otel_traces
      WHERE tenant_id = {tenantId:String}
        AND start_time >= {windowStart:String}
        AND start_time <= {windowEnd:String}
      LIMIT 20`,
      query_params: { tenantId, windowStart, windowEnd },
      format: 'JSONEachRow',
    });

    const relatedTraces = await tracesResult.json<{
      trace_id: string;
      service_name: string;
      operation_name: string;
      status_code: string;
      duration_ns: number;
    }>();

    // 4. Fetch recent deployments from PostgreSQL
    //    Deployments for the same service in the 24 hours before window_start
    const deploymentsResult = await this.pg.query(
      `SELECT
        d.version, d.deployer, d.deployed_at, d.changelog,
        s.name AS service_name
      FROM deployments d
      LEFT JOIN services s ON s.id = d.service_id
      WHERE d.tenant_id = $1
        AND d.service_id = $2
        AND d.deployed_at >= ($3::timestamptz - interval '24 hours')
        AND d.deployed_at <= $3::timestamptz
      ORDER BY d.deployed_at DESC`,
      [tenantId, anomalyRow.service_id, windowStart],
    );

    // 5. Fetch baselines from PostgreSQL
    const baselinesResult = await this.pg.query(
      `SELECT metric_name, baseline_mean, baseline_stddev
      FROM anomaly_baselines
      WHERE tenant_id = $1 AND service_id = $2`,
      [tenantId, anomalyRow.service_id],
    );

    return {
      anomaly: {
        id: anomalyRow.id,
        anomaly_type: anomalyRow.anomaly_type,
        severity: anomalyRow.severity,
        title: anomalyRow.title,
        description: anomalyRow.description ?? '',
        window_start: windowStart,
        window_end: windowEnd,
        service_name: anomalyRow.service_name ?? '',
      },
      related_logs: relatedLogs,
      related_traces: relatedTraces,
      recent_deployments: deploymentsResult.rows.map((row: any) => ({
        version: row.version,
        deployer: row.deployer ?? '',
        deployed_at: new Date(row.deployed_at).toISOString(),
        changelog: row.changelog ?? '',
        service_name: row.service_name ?? '',
      })),
      baseline_context: baselinesResult.rows.map((row: any) => ({
        metric_name: row.metric_name,
        baseline_mean: row.baseline_mean,
        baseline_stddev: row.baseline_stddev,
      })),
    };
  }
}
