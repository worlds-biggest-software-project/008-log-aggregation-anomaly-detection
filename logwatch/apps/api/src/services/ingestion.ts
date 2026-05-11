import type { Redis } from 'ioredis';
import type { Pool } from 'pg';
import type { OtelLogRecord } from '@logwatch/shared';
import { loadRedactionRules, applyRedaction } from './redaction.js';

const STREAM_KEY = 'logwatch:ingest:logs';
const MAX_BUFFER_SIZE = 100_000;

interface SamplingRule {
  pattern: string;
  sample_rate: number;
}

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
    const samplingByTenant = new Map<string, SamplingRule[]>();
    await Promise.all(
      tenantIds.map(async (tid) => {
        rulesByTenant.set(tid, await loadRedactionRules(this.pg, tid));
        samplingByTenant.set(tid, await this.loadSamplingRules(tid));
      }),
    );

    const pipeline = this.redis.pipeline();
    let accepted = 0;
    let sampled = 0;

    for (const record of records) {
      const samplingRules = samplingByTenant.get(record.tenant_id) ?? [];
      if (this.shouldSample(record, samplingRules)) {
        sampled++;
        continue;
      }

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
    return { accepted, rejected: sampled };
  }

  private async loadSamplingRules(tenantId: string): Promise<SamplingRule[]> {
    try {
      const result = await this.pg.query(
        "SELECT settings->'sampling_rules' AS rules FROM tenants WHERE id = $1",
        [tenantId],
      );
      const rules = result.rows[0]?.rules;
      return Array.isArray(rules) ? rules : [];
    } catch {
      return [];
    }
  }

  private shouldSample(record: OtelLogRecord, rules: SamplingRule[]): boolean {
    for (const rule of rules) {
      if (rule.pattern && record.body.includes(rule.pattern)) {
        if (Math.random() > rule.sample_rate) {
          return true;
        }
      }
    }
    return false;
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
