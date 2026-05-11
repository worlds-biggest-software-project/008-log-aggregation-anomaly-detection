import Anthropic from '@anthropic-ai/sdk';

export interface ThresholdAdjustment {
  metric_name: string;
  current_threshold: number;
  recommended_threshold: number;
  adjustment_reason: string;
  confidence: number;
}

export interface ServiceContext {
  service_name: string;
  environment: string;
  baseline_days: number;
}

export interface ThresholdExplanation {
  metric_name: string;
  current_threshold: number;
  recommended_threshold: number;
  explanation: string; // plain-language explanation
  prompt_tokens: number;
  completion_tokens: number;
}

export class ThresholdExplainer {
  private client: Anthropic;
  private model: string;

  constructor(apiKey?: string, model?: string) {
    this.client = new Anthropic({ apiKey: apiKey ?? process.env['ANTHROPIC_API_KEY'] });
    this.model = model ?? process.env['LLM_MODEL'] ?? 'claude-sonnet-4-6';
  }

  async explain(
    adjustments: ThresholdAdjustment[],
    serviceContext: ServiceContext,
  ): Promise<ThresholdExplanation[]> {
    if (adjustments.length === 0) {
      return [];
    }

    const systemPrompt = [
      'You are an observability expert explaining alert threshold changes to engineering teams.',
      'For each threshold adjustment, provide a clear, non-technical explanation of why the change is recommended and what it means for alerting behavior.',
      '',
      'Respond with JSON only. Return an array of objects, each with:',
      '{ "metric_name": "...", "explanation": "..." }',
      '',
      'Guidelines:',
      '- Keep explanations concise (2-3 sentences).',
      '- Use plain language that a non-SRE engineer can understand.',
      '- Explain the practical impact: will they see more or fewer alerts?',
      '- Do not include any text outside the JSON array.',
    ].join('\n');

    const userMessage = this.buildUserMessage(adjustments, serviceContext);

    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 2048,
        system: [{ type: 'text', text: systemPrompt }],
        messages: [{ role: 'user', content: userMessage }],
      });

      const text = response.content[0].type === 'text' ? response.content[0].text : '';
      const parsed = JSON.parse(text) as Array<{ metric_name: string; explanation: string }>;

      const promptTokens = response.usage.input_tokens;
      const completionTokens = response.usage.output_tokens;

      // Merge parsed explanations with adjustment data
      return adjustments.map((adj) => {
        const match = parsed.find((p) => p.metric_name === adj.metric_name);
        return {
          metric_name: adj.metric_name,
          current_threshold: adj.current_threshold,
          recommended_threshold: adj.recommended_threshold,
          explanation: match?.explanation ?? adj.adjustment_reason,
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
        };
      });
    } catch (error) {
      if (error instanceof Anthropic.APIError) {
        throw new Error(`Anthropic API error (${error.status}): ${error.message}`);
      }
      throw error;
    }
  }

  private buildUserMessage(
    adjustments: ThresholdAdjustment[],
    context: ServiceContext,
  ): string {
    const sections: string[] = [];

    sections.push(`## Service Context`);
    sections.push(`- Service: ${context.service_name}`);
    sections.push(`- Environment: ${context.environment}`);
    sections.push(`- Baseline period: ${context.baseline_days} days`);
    sections.push('');
    sections.push('## Threshold Adjustments');

    for (const adj of adjustments) {
      sections.push('');
      sections.push(`### ${adj.metric_name}`);
      sections.push(`- Current threshold: ${adj.current_threshold}`);
      sections.push(`- Recommended threshold: ${adj.recommended_threshold}`);
      sections.push(`- Reason: ${adj.adjustment_reason}`);
      sections.push(`- Confidence: ${(adj.confidence * 100).toFixed(0)}%`);
    }

    return sections.join('\n');
  }
}
