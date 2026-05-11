import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IngestionService, BackpressureError } from '../ingestion.js';
import type { OtelLogRecord } from '@logwatch/shared';

vi.mock('../redaction.js', () => ({
  loadRedactionRules: vi.fn().mockResolvedValue([]),
  applyRedaction: vi.fn((body: string, attrs: Record<string, string>, _rules: unknown[]) => ({
    body,
    attributes: attrs,
  })),
}));

import { loadRedactionRules, applyRedaction } from '../redaction.js';

function makeRecord(overrides: Partial<OtelLogRecord> = {}): OtelLogRecord {
  return {
    timestamp: new Date().toISOString(),
    observed_timestamp: new Date().toISOString(),
    id: 'rec-1',
    tenant_id: 'tenant-1',
    trace_id: '00000000000000000000000000000001',
    span_id: '0000000000000001',
    trace_flags: 1,
    severity_text: 'INFO',
    severity_number: 9,
    body: 'Test log message',
    resource_fingerprint: 'fp-1',
    resource_string: {},
    attributes_string: { key: 'value' },
    attributes_number: {},
    attributes_bool: {},
    source_type: 'otlp',
    anomaly_score: 0,
    anomaly_detected: false,
    service_name: 'test-service',
    host_name: 'localhost',
    ...overrides,
  };
}

describe('IngestionService', () => {
  let redis: {
    xlen: ReturnType<typeof vi.fn>;
    pipeline: ReturnType<typeof vi.fn>;
  };
  let pg: { query: ReturnType<typeof vi.fn> };
  let service: IngestionService;

  const mockPipeline = {
    xadd: vi.fn().mockReturnThis(),
    exec: vi.fn().mockResolvedValue([]),
  };

  beforeEach(() => {
    vi.clearAllMocks();

    redis = {
      xlen: vi.fn().mockResolvedValue(0),
      pipeline: vi.fn(() => mockPipeline),
    };

    pg = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
    };

    service = new IngestionService(redis as any, pg as any);
  });

  it('accepts records and writes to Redis pipeline', async () => {
    const records = [makeRecord(), makeRecord({ id: 'rec-2' })];

    const result = await service.ingest(records);

    expect(result.accepted).toBe(2);
    expect(result.rejected).toBe(0);
    expect(redis.pipeline).toHaveBeenCalledOnce();
    expect(mockPipeline.xadd).toHaveBeenCalledTimes(2);
    expect(mockPipeline.exec).toHaveBeenCalledOnce();

    // Verify xadd was called with correct stream key and JSON data
    const firstCall = mockPipeline.xadd.mock.calls[0];
    expect(firstCall[0]).toBe('logwatch:ingest:logs');
    expect(firstCall[1]).toBe('*');
    expect(firstCall[2]).toBe('data');
    expect(JSON.parse(firstCall[3])).toMatchObject({ id: 'rec-1' });
  });

  it('throws BackpressureError when buffer is full', async () => {
    redis.xlen.mockResolvedValue(100_000);

    await expect(service.ingest([makeRecord()])).rejects.toThrow(BackpressureError);
    await expect(service.ingest([makeRecord()])).rejects.toThrow('Ingestion buffer full');
    expect(redis.pipeline).not.toHaveBeenCalled();
  });

  it('applies sampling rules - records matching pattern with random > sample_rate get sampled out', async () => {
    // Return sampling rules for tenant-1
    pg.query.mockResolvedValue({
      rows: [{ rules: [{ pattern: 'health', sample_rate: 0.1 }] }],
    });

    // Mock Math.random to return 0.5, which is > 0.1, so the record should be sampled out
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5);

    const records = [
      makeRecord({ body: 'health check OK' }),
      makeRecord({ id: 'rec-2', body: 'User login event' }),
    ];

    const result = await service.ingest(records);

    // The health check record should be sampled out (body contains 'health' and 0.5 > 0.1)
    // The login event should be accepted
    expect(result.accepted).toBe(1);
    expect(result.rejected).toBe(1);

    randomSpy.mockRestore();
  });

  it('does not sample when Math.random <= sample_rate', async () => {
    pg.query.mockResolvedValue({
      rows: [{ rules: [{ pattern: 'health', sample_rate: 0.8 }] }],
    });

    // Mock Math.random to return 0.5, which is <= 0.8, so the record should NOT be sampled out
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5);

    const records = [makeRecord({ body: 'health check OK' })];
    const result = await service.ingest(records);

    expect(result.accepted).toBe(1);
    expect(result.rejected).toBe(0);

    randomSpy.mockRestore();
  });

  it('applies redaction rules', async () => {
    const redactionRules = [
      { regex: /secret/g, replacement: '[REDACTED]', applies_to: 'all' as const },
    ];
    vi.mocked(loadRedactionRules).mockResolvedValue(redactionRules);
    vi.mocked(applyRedaction).mockReturnValue({
      body: 'This is [REDACTED] data',
      attributes: { key: '[REDACTED]' },
    });

    const records = [makeRecord({ body: 'This is secret data' })];
    const result = await service.ingest(records);

    expect(result.accepted).toBe(1);
    expect(loadRedactionRules).toHaveBeenCalledWith(pg, 'tenant-1');
    expect(applyRedaction).toHaveBeenCalledWith(
      'This is secret data',
      { key: 'value' },
      redactionRules,
    );

    // Verify the redacted data was written to the pipeline
    const xaddData = JSON.parse(mockPipeline.xadd.mock.calls[0][3]);
    expect(xaddData.body).toBe('This is [REDACTED] data');
  });

  it('getBufferSize() returns xlen result', async () => {
    redis.xlen.mockResolvedValue(42);

    const size = await service.getBufferSize();

    expect(size).toBe(42);
    expect(redis.xlen).toHaveBeenCalledWith('logwatch:ingest:logs');
  });
});
