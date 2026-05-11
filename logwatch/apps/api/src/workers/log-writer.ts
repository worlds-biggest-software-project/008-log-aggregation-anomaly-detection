import type { Redis } from 'ioredis';
import type { ClickHouseClient } from '@clickhouse/client';
import type { OtelLogRecord } from '@logwatch/shared';

const STREAM_KEY = 'logwatch:ingest:logs';
const CONSUMER_GROUP = 'log-writers';
const CONSUMER_NAME = `writer-${process.pid}`;
const BATCH_SIZE = 1000;
const BATCH_INTERVAL_MS = 1000;

export class LogWriter {
  private running = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private redis: Redis,
    private clickhouse: ClickHouseClient,
  ) {}

  async start(): Promise<void> {
    this.running = true;

    try {
      await this.redis.xgroup('CREATE', STREAM_KEY, CONSUMER_GROUP, '0', 'MKSTREAM');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (!message.includes('BUSYGROUP')) throw err;
    }

    this.poll();
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private poll(): void {
    if (!this.running) return;

    this.processBatch()
      .catch((err) => {
        console.error('LogWriter batch error:', err);
      })
      .finally(() => {
        if (this.running) {
          this.timer = setTimeout(() => this.poll(), BATCH_INTERVAL_MS);
        }
      });
  }

  private async processBatch(): Promise<void> {
    const results = await this.redis.xreadgroup(
      'GROUP',
      CONSUMER_GROUP,
      CONSUMER_NAME,
      'COUNT',
      String(BATCH_SIZE),
      'BLOCK',
      '500',
      'STREAMS',
      STREAM_KEY,
      '>',
    );

    if (!results || results.length === 0) return;

    const records: OtelLogRecord[] = [];
    const messageIds: string[] = [];

    for (const [, messages] of results) {
      for (const [id, fields] of messages) {
        messageIds.push(id);
        const dataIdx = fields.indexOf('data');
        if (dataIdx !== -1 && fields[dataIdx + 1]) {
          try {
            records.push(JSON.parse(fields[dataIdx + 1]!) as OtelLogRecord);
          } catch {
            console.error('Failed to parse log record from stream:', id);
          }
        }
      }
    }

    if (records.length === 0) return;

    await this.clickhouse.insert({
      table: 'otel_logs',
      values: records.map((r) => ({
        timestamp: r.timestamp,
        observed_timestamp: r.observed_timestamp,
        id: r.id,
        tenant_id: r.tenant_id,
        trace_id: r.trace_id,
        span_id: r.span_id,
        trace_flags: r.trace_flags,
        severity_text: r.severity_text,
        severity_number: r.severity_number,
        body: r.body,
        resource_fingerprint: r.resource_fingerprint,
        resource_string: r.resource_string,
        attributes_string: r.attributes_string,
        attributes_number: r.attributes_number,
        attributes_bool: r.attributes_bool,
        source_type: r.source_type,
        anomaly_score: r.anomaly_score,
        anomaly_detected: r.anomaly_detected,
      })),
      format: 'JSONEachRow',
    });

    if (messageIds.length > 0) {
      await this.redis.xack(STREAM_KEY, CONSUMER_GROUP, ...messageIds);
    }
  }
}
