import Anthropic from '@anthropic-ai/sdk';

export interface TranslationResult {
  query: string;
  explanation: string;
  prompt_tokens: number;
  completion_tokens: number;
}

export interface SummarizationResult {
  summary: string;
  prompt_tokens: number;
  completion_tokens: number;
}

export class LLMClient {
  private client: Anthropic;
  private model: string;

  constructor(apiKey?: string, model?: string) {
    this.client = new Anthropic({ apiKey: apiKey ?? process.env['ANTHROPIC_API_KEY'] });
    this.model = model ?? process.env['LLM_MODEL'] ?? 'claude-sonnet-4-6';
  }

  async translate(
    question: string,
    schemaContext: string,
    tenantId: string,
  ): Promise<TranslationResult> {
    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 2048,
        system: [
          {
            type: 'text',
            text: [
              'You are a ClickHouse SQL expert for a log aggregation platform.',
              `ALWAYS include \`tenant_id = '${tenantId}'\` in WHERE clauses to enforce tenant isolation.`,
              'Safety rules:',
              '- Only generate SELECT statements.',
              '- NEVER generate INSERT, UPDATE, DELETE, DROP, or ALTER statements.',
              '- Always include a LIMIT clause with a maximum of 1000 rows.',
              '',
              'Respond with JSON only, in this exact format:',
              '{ "query": "SELECT ...", "explanation": "..." }',
              'Do not include any text outside the JSON object.',
            ].join('\n'),
          },
          {
            type: 'text',
            text: schemaContext,
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages: [{ role: 'user', content: question }],
      });

      const text = response.content[0].type === 'text' ? response.content[0].text : '';
      const parsed = JSON.parse(text) as { query: string; explanation: string };

      return {
        query: parsed.query,
        explanation: parsed.explanation,
        prompt_tokens: response.usage.input_tokens,
        completion_tokens: response.usage.output_tokens,
      };
    } catch (error) {
      if (error instanceof Anthropic.APIError) {
        throw new Error(`Anthropic API error (${error.status}): ${error.message}`);
      }
      throw error;
    }
  }

  async summarize(
    question: string,
    results: Record<string, unknown>[],
    rowCount: number,
  ): Promise<SummarizationResult> {
    const sampleResults = results.slice(0, 50);

    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 2048,
        system: [
          {
            type: 'text',
            text: 'You are a log analysis assistant. Summarize query results in plain English. Be concise but highlight key findings, patterns, and any anomalies.',
          },
        ],
        messages: [
          {
            role: 'user',
            content: [
              `Original question: ${question}`,
              `Total rows returned: ${rowCount}`,
              `Sample results (up to 50 rows):`,
              JSON.stringify(sampleResults, null, 2),
            ].join('\n'),
          },
        ],
      });

      const text = response.content[0].type === 'text' ? response.content[0].text : '';

      return {
        summary: text,
        prompt_tokens: response.usage.input_tokens,
        completion_tokens: response.usage.output_tokens,
      };
    } catch (error) {
      if (error instanceof Anthropic.APIError) {
        throw new Error(`Anthropic API error (${error.status}): ${error.message}`);
      }
      throw error;
    }
  }
}
