import type { Redis } from 'ioredis';
import type { Pool } from 'pg';
import type { OtelLogRecord } from '@logwatch/shared';
import { loadRedactionRules, applyRedaction } from './redaction.js';

const STREAM_KEY = 'logwatch:ingest:logs';
const MAX_BUFFER_SIZE = 100_000;

export class IngestionService {
  constructor(
    private redis: Redis,
    private pg: Pool,
  ) {}

  async ingest(records: OtelLogRecord[]): Promise<{ accepted: number; rejected: number }> {
    const bufferLen = await this.redis.xlen(STREAM_KEY);
    if (bufferLen >= MAX_BUFFER_SIZE) {
      throw new BackpressureError('Ingestion buffer full');
    }

    const tenantIds = [...new Set(records.map((r) => r.tenant_id))];
    const rulesByTenant = new Map<string, Awaited<ReturnType<typeof loadRedactionRules>>>();
    await Promise.all(
      tenantIds.map(async (tid) => {
        rulesByTenant.set(tid, await loadRedactionRules(this.pg, tid));
      }),
    );

    const pipeline = this.redis.pipeline();
    let accepted = 0;

    for (const record of records) {
      const rules = rulesByTenant.get(record.tenant_id) ?? [];
      if (rules.length > 0) {
        const { body, attributes } = applyRedaction(
          record.body,
          record.attributes_string,
          rules,
        );
        record.body = body;
        record.attributes_string = attributes;
      }

      pipeline.xadd(STREAM_KEY, '*', 'data', JSON.stringify(record));
      accepted++;
    }

    await pipeline.exec();
    return { accepted, rejected: 0 };
  }

  async getBufferSize(): Promise<number> {
    return this.redis.xlen(STREAM_KEY);
  }
}

export class BackpressureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackpressureError';
  }
}
