import Anthropic from '@anthropic-ai/sdk';
import type { RCAEvidence } from './rca-evidence.js';

export interface RCAResult {
  narrative: string;
  probable_cause: string;
  confidence: number;
  prompt_tokens: number;
  completion_tokens: number;
}

export class RCAGenerator {
  private client: Anthropic;
  private model: string;

  constructor(apiKey?: string, model?: string) {
    this.client = new Anthropic({ apiKey: apiKey ?? process.env['ANTHROPIC_API_KEY'] });
    this.model = model ?? process.env['LLM_MODEL'] ?? 'claude-sonnet-4-6';
  }

  async generate(evidence: RCAEvidence): Promise<RCAResult> {
    const systemPrompt = [
      'You are a Site Reliability Engineer analyzing a production incident.',
      'Given the evidence below, write a root-cause analysis report.',
      '',
      'Respond with JSON only, in this exact format:',
      '{ "narrative": "...", "probable_cause": "...", "confidence": 0.0-1.0 }',
      '',
      'Guidelines:',
      '- "narrative" should be a detailed root-cause analysis (2-5 paragraphs).',
      '- "probable_cause" should be a single sentence summarizing the most likely cause.',
      '- "confidence" should be a number between 0.0 and 1.0 reflecting how confident you are in the analysis.',
      '- Consider recent deployments as a potential cause.',
      '- Reference specific log entries, traces, and baseline deviations in your analysis.',
      '- Do not include any text outside the JSON object.',
    ].join('\n');

    const userMessage = this.buildEvidenceMessage(evidence);

    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 4096,
        system: [{ type: 'text', text: systemPrompt }],
        messages: [{ role: 'user', content: userMessage }],
      });

      const text = response.content[0].type === 'text' ? response.content[0].text : '';
      const parsed = JSON.parse(text) as {
        narrative: string;
        probable_cause: string;
        confidence: number;
      };

      return {
        narrative: parsed.narrative,
        probable_cause: parsed.probable_cause,
        confidence: Math.max(0, Math.min(1, parsed.confidence)),
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

  private buildEvidenceMessage(evidence: RCAEvidence): string {
    const sections: string[] = [];

    // Anomaly details
    sections.push('## Anomaly Details');
    sections.push(`- Type: ${evidence.anomaly.anomaly_type}`);
    sections.push(`- Severity: ${evidence.anomaly.severity}`);
    sections.push(`- Title: ${evidence.anomaly.title}`);
    sections.push(`- Description: ${evidence.anomaly.description}`);
    sections.push(`- Service: ${evidence.anomaly.service_name}`);
    sections.push(`- Window: ${evidence.anomaly.window_start} to ${evidence.anomaly.window_end}`);

    // Log samples
    sections.push('');
    sections.push('## Related Log Entries');
    if (evidence.related_logs.length === 0) {
      sections.push('No related logs found in the anomaly window.');
    } else {
      for (const log of evidence.related_logs.slice(0, 30)) {
        sections.push(`[${log.timestamp}] [${log.severity_text}] [${log.service_name}] ${log.body}`);
      }
    }

    // Trace data
    sections.push('');
    sections.push('## Related Traces');
    if (evidence.related_traces.length === 0) {
      sections.push('No related traces found in the anomaly window.');
    } else {
      for (const trace of evidence.related_traces) {
        const durationMs = (trace.duration_ns / 1e6).toFixed(2);
        sections.push(`- Trace ${trace.trace_id}: ${trace.service_name}/${trace.operation_name} status=${trace.status_code} duration=${durationMs}ms`);
      }
    }

    // Recent deployments
    sections.push('');
    sections.push('## Recent Deployments (24h before anomaly)');
    if (evidence.recent_deployments.length === 0) {
      sections.push('No deployments found in the 24 hours before this anomaly.');
    } else {
      for (const dep of evidence.recent_deployments) {
        sections.push(`- ${dep.service_name} v${dep.version} deployed at ${dep.deployed_at} by ${dep.deployer}`);
        if (dep.changelog) {
          sections.push(`  Changelog: ${dep.changelog}`);
        }
      }
    }

    // Baseline metrics
    sections.push('');
    sections.push('## Baseline Metrics');
    if (evidence.baseline_context.length === 0) {
      sections.push('No baseline metrics available for this service.');
    } else {
      for (const baseline of evidence.baseline_context) {
        sections.push(`- ${baseline.metric_name}: mean=${baseline.baseline_mean.toFixed(4)}, stddev=${baseline.baseline_stddev.toFixed(4)}`);
      }
    }

    return sections.join('\n');
  }
}
