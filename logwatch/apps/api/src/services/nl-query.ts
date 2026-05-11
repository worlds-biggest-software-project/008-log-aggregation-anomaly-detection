import type { ClickHouseClient } from '@clickhouse/client';
import type { LLMClient, TranslationResult } from './llm-client.js';

export interface NLQueryParams {
  question: string;
  tenantId: string;
  userId: string;
  pg: any;
  ch: ClickHouseClient;
}

export interface NLQueryResult {
  id: string;
  question: string;
  translated_query: string;
  explanation: string;
  results: Record<string, unknown>[];
  result_count: number;
  result_summary: string;
  execution_time_ms: number;
  prompt_tokens: number;
  completion_tokens: number;
}

const DANGEROUS_KEYWORDS = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE)\b/i;

export class NLQueryService {
  constructor(private llmClient: LLMClient) {}

  getSchemaContext(): string {
    return [
      'ClickHouse table schema for log queries:',
      '',
      'CREATE TABLE otel_logs (',
      '    timestamp            DateTime64(9),    -- Log timestamp with nanosecond precision',
      '    observed_timestamp   DateTime64(9),    -- When the log was observed/collected',
      '    id                   UUID,             -- Unique log record ID (auto-generated)',
      '    tenant_id            LowCardinality(String),  -- Tenant identifier for multi-tenancy isolation',
      '    trace_id             String,           -- Distributed trace ID',
      '    span_id              String,           -- Span ID within a trace',
      '    trace_flags          UInt8,            -- W3C trace flags',
      '    severity_text        LowCardinality(String),  -- Log level as text',
      '    severity_number      UInt8,            -- Numeric severity (1-24)',
      '    body                 String,           -- Log message body',
      '    resource_fingerprint String,           -- Hash of resource attributes',
      '    resource_string      Map(LowCardinality(String), String),  -- Resource attributes (e.g. service.name, host.name)',
      '    attributes_string    Map(LowCardinality(String), String),  -- String log attributes',
      '    attributes_number    Map(LowCardinality(String), Float64), -- Numeric log attributes',
      '    attributes_bool      Map(LowCardinality(String), Bool),    -- Boolean log attributes',
      '    source_type          LowCardinality(String),  -- Source type of the log',
      '    anomaly_score        Float32 DEFAULT 0.0,     -- ML-assigned anomaly score (0.0–1.0)',
      '    anomaly_detected     Bool DEFAULT false,      -- Whether an anomaly was flagged',
      '    service_name         String MATERIALIZED resource_string[\'service.name\'],  -- Materialized service name',
      '    host_name            String MATERIALIZED resource_string[\'host.name\']      -- Materialized host name',
      ')',
      'ENGINE = MergeTree',
      'PARTITION BY (tenant_id, toDate(timestamp))',
      'ORDER BY (tenant_id, resource_fingerprint, severity_number, timestamp)',
      '',
      'Query tips:',
      '- Use `hasToken(body, \'keyword\')` for full-text search on the body field.',
      '- Use `resource_string[\'service.name\']` or the materialized `service_name` column to filter by service.',
      '- severity_text values: TRACE, DEBUG, INFO, WARN, ERROR, FATAL',
      '- Use `toDate(timestamp)` for date filtering; timestamps are DateTime64(9).',
      '- Always include LIMIT (max 1000).',
    ].join('\n');
  }

  validateQuery(query: string): { valid: boolean; error?: string } {
    const trimmed = query.trim();

    if (!/^SELECT\b/i.test(trimmed)) {
      return { valid: false, error: 'Query must start with SELECT' };
    }

    if (DANGEROUS_KEYWORDS.test(trimmed)) {
      return { valid: false, error: 'Query contains forbidden statements (INSERT, UPDATE, DELETE, DROP, ALTER, TRUNCATE, or CREATE)' };
    }

    if (!/\bLIMIT\b/i.test(trimmed)) {
      return { valid: false, error: 'Query must include a LIMIT clause' };
    }

    if (!/tenant_id/i.test(trimmed)) {
      return { valid: false, error: 'Query must contain a tenant_id filter' };
    }

    return { valid: true };
  }

  async translateAndExecute(params: NLQueryParams): Promise<NLQueryResult> {
    const { question, tenantId, userId, pg, ch } = params;

    // Step 1: Create a record with status='translating'
    const insertResult = await pg.query(
      `INSERT INTO nl_queries (tenant_id, user_id, question, status)
       VALUES ($1, $2, $3, 'translating')
       RETURNING id`,
      [tenantId, userId, question],
    );
    const recordId: string = insertResult.rows[0].id;

    let translation: TranslationResult;
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;

    try {
      // Step 2: Translate the question to SQL
      const schemaContext = this.getSchemaContext();
      translation = await this.llmClient.translate(question, schemaContext, tenantId);
      totalPromptTokens += translation.prompt_tokens;
      totalCompletionTokens += translation.completion_tokens;

      // Step 3: Validate the generated query
      const validation = this.validateQuery(translation.query);
      if (!validation.valid) {
        await pg.query(
          `UPDATE nl_queries SET status = 'failed', error_message = $1, completed_at = NOW() WHERE id = $2`,
          [validation.error, recordId],
        );
        throw new Error(`Generated query failed validation: ${validation.error}`);
      }

      // Step 4: Update record with translated query
      await pg.query(
        `UPDATE nl_queries SET translated_query = $1, status = 'executing' WHERE id = $2`,
        [translation.query, recordId],
      );

      // Step 5: Execute the query against ClickHouse with a timeout
      const startTime = Date.now();
      const chResult = await ch.query({
        query: translation.query,
        format: 'JSONEachRow',
        clickhouse_settings: {
          max_execution_time: 30,
        },
      });
      const results = await chResult.json<Record<string, unknown>>();
      const executionTimeMs = Date.now() - startTime;

      // Step 7: Update record with execution results
      await pg.query(
        `UPDATE nl_queries
         SET status = 'summarizing', result_count = $1, execution_time_ms = $2
         WHERE id = $3`,
        [results.length, executionTimeMs, recordId],
      );

      // Step 8: Summarize the results
      const summarization = await this.llmClient.summarize(question, results, results.length);
      totalPromptTokens += summarization.prompt_tokens;
      totalCompletionTokens += summarization.completion_tokens;

      // Step 9: Update record to completed
      await pg.query(
        `UPDATE nl_queries
         SET status = 'completed', result_summary = $1,
             prompt_tokens = $2, completion_tokens = $3, completed_at = NOW()
         WHERE id = $4`,
        [summarization.summary, totalPromptTokens, totalCompletionTokens, recordId],
      );

      // Step 10: Return the full result
      return {
        id: recordId,
        question,
        translated_query: translation.query,
        explanation: translation.explanation,
        results,
        result_count: results.length,
        result_summary: summarization.summary,
        execution_time_ms: executionTimeMs,
        prompt_tokens: totalPromptTokens,
        completion_tokens: totalCompletionTokens,
      };
    } catch (error) {
      // On any error: update record status='failed', then rethrow
      const errorMessage = error instanceof Error ? error.message : String(error);
      await pg.query(
        `UPDATE nl_queries SET status = 'failed', error_message = $1, completed_at = NOW() WHERE id = $2`,
        [errorMessage, recordId],
      ).catch(() => {
        // Swallow update errors to avoid masking the original error
      });
      throw error;
    }
  }
}
