import type { Redis } from 'ioredis';
import type { ClickHouseClient } from '@clickhouse/client';
import type { TraceSpan } from '@logwatch/shared';

const STREAM_KEY = 'logwatch:ingest:traces';
const CONSUMER_GROUP = 'trace-writers';
const CONSUMER_NAME = `writer-${process.pid}`;
const BATCH_SIZE = 1000;
const BATCH_INTERVAL_MS = 1000;

export class TraceWriter {
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
        console.error('TraceWriter batch error:', err);
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

    const records: TraceSpan[] = [];
    const messageIds: string[] = [];

    for (const [, messages] of results as [string, [string, string[]][]][]) {
      for (const [id, fields] of messages) {
        messageIds.push(id);
        const dataIdx = fields.indexOf('data');
        if (dataIdx !== -1 && fields[dataIdx + 1]) {
          try {
            records.push(JSON.parse(fields[dataIdx + 1]!) as TraceSpan);
          } catch {
            console.error('Failed to parse trace span from stream:', id);
          }
        }
      }
    }

    if (records.length === 0) return;

    await this.clickhouse.insert({
      table: 'otel_traces',
      values: records.map((r) => ({
        start_time: r.start_time,
        end_time: r.end_time,
        duration_ns: r.duration_ns,
        tenant_id: r.tenant_id,
        trace_id: r.trace_id,
        span_id: r.span_id,
        parent_span_id: r.parent_span_id,
        operation_name: r.operation_name,
        service_name: r.service_name,
        span_kind: r.span_kind,
        status_code: r.status_code,
        status_message: r.status_message,
        resource_string: r.resource_string,
        span_attributes_string: r.span_attributes_string,
        span_attributes_number: r.span_attributes_number,
        span_attributes_bool: r.span_attributes_bool,
        events_name: r.events_name,
        events_timestamp: r.events_timestamp,
        events_attributes: r.events_attributes,
        links_trace_id: r.links_trace_id,
        links_span_id: r.links_span_id,
      })),
      format: 'JSONEachRow',
    });

    if (messageIds.length > 0) {
      await this.redis.xack(STREAM_KEY, CONSUMER_GROUP, ...messageIds);
    }
  }
}
