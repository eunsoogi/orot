import { describe, expect, it } from '@jest/globals';

const { toLangSmithOutput } = require('../../../scripts/evaluation/visit-questions/privacy');

describe('provider token usage privacy projection', () => {
  const result = { status: 'ready', questions: [] };

  it('serializes complete token totals from the selected API provider only', () => {
    const output = toLangSmithOutput(result, {
      providerMode: 'openai-api',
      latencyMs: 4,
      tokenUsage: { inputTokens: 12, outputTokens: 7, totalTokens: 19 },
      apiKey: 'never-serialize-this',
    });

    expect(output.execution).toEqual({
      providerMode: 'openai-api',
      latencyMs: 4,
      tokenUsage: {
        status: 'measured',
        inputTokens: 12,
        outputTokens: 7,
        totalTokens: 19,
      },
    });
    expect(JSON.stringify(output)).not.toContain('never-serialize-this');
  });

  it('does not estimate missing or inconsistent totals', () => {
    const missing = toLangSmithOutput(result, {
      providerMode: 'openai-api',
      latencyMs: 4,
      tokenUsage: { inputTokens: 12, outputTokens: 7 },
    });
    const inconsistent = toLangSmithOutput(result, {
      providerMode: 'openai-api',
      latencyMs: 4,
      tokenUsage: { inputTokens: 12, outputTokens: 7, totalTokens: 20 },
    });

    expect(missing.execution.tokenUsage.status).toBe('unmeasured');
    expect(inconsistent.execution.tokenUsage.status).toBe('unmeasured');
  });

  it('does not label test-adapter counts as actual provider measurements', () => {
    const output = toLangSmithOutput(result, {
      providerMode: 'test-adapter',
      latencyMs: 4,
      tokenUsage: { inputTokens: 12, outputTokens: 7, totalTokens: 19 },
    });

    expect(output.execution.tokenUsage.status).toBe('unmeasured');
  });
});
