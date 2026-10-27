import { describe, expect, it } from '@jest/globals';
import { createSyntheticVisitQuestionFixture } from '../src';

const {
  compareSyntheticCase,
} = require('../../../scripts/evaluation/visit-questions/comparison-harness.cjs');
const {
  createScriptedProvider,
  responseFor,
} = require('../../../scripts/evaluation/visit-questions/scripted-provider.cjs');
const {
  createOpenAITestFetch,
} = require('../../../scripts/evaluation/visit-questions/openai-test-adapter.cjs');

const fixture = createSyntheticVisitQuestionFixture('orot-visit-questions-eval-v1');
const testCase = fixture.cases[0];
const environment = {
  OROT_VISIT_QUESTION_PROVIDER: 'openai-api',
  OROT_VISIT_QUESTION_MODEL: 'synthetic-comparison-model',
  OROT_ALLOW_SYNTHETIC_REMOTE_PROCESSING: '1',
  OPENAI_API_KEY: 'synthetic-comparison-key',
};

describe('comparison provider boundary', () => {
  it('uses identical model controls and accounts for actual response counters on every path', async () => {
    const requests: any[] = [];
    const graphCalls: any[] = [];
    const scripted = createScriptedProvider(testCase);
    const graphFetch = createOpenAITestFetch(scripted.provider, graphCalls);
    const fetchImpl = async (url: string, options: any) => {
      const body = JSON.parse(options.body);
      requests.push(body);
      if (!body.messages.some((item: any) => item.content?.includes('\nEvidence: '))) {
        return graphFetch(url, options);
      }
      const evidenceLine = body.messages
        .find((item: any) => item.role === 'user')
        .content.split('\n')
        .find((line: string) => line.startsWith('Evidence: '));
      const items = JSON.parse(evidenceLine.slice('Evidence: '.length));
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: responseFor(testCase, items) }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
        }),
      };
    };
    const result = await compareSyntheticCase(testCase, fixture, { environment, fetchImpl });
    expect(result.paths.map((row: any) => row.executionStatus)).toEqual([
      'completed',
      'completed',
      'completed',
    ]);
    expect(requests).toHaveLength(5);
    expect(
      requests.every((request) => request.model === environment.OROT_VISIT_QUESTION_MODEL),
    ).toBe(true);
    expect(
      requests.every(
        (request) =>
          request.temperature === undefined && request.max_completion_tokens === undefined,
      ),
    ).toBe(true);
    expect(result.paths.map((row: any) => row.metrics.token_usage.totalTokens)).toEqual([
      18, 18, 54,
    ]);
    expect(result.paths.every((row: any) => row.metrics.citation_support === 1)).toBe(true);
    expect(JSON.stringify(result)).not.toContain(environment.OPENAI_API_KEY);
  });

  it('retains provider failures on every path without turning missing quality or usage into zero', async () => {
    const fetchImpl = async () => ({ ok: false, status: 401 });
    const result = await compareSyntheticCase(testCase, fixture, { environment, fetchImpl });
    expect(result.paths.every((row: any) => row.executionStatus === 'failed')).toBe(true);
    expect(result.paths.every((row: any) => row.metrics.citation_support === null)).toBe(true);
    expect(result.paths.every((row: any) => row.metrics.token_usage.status === 'unmeasured')).toBe(
      true,
    );
    expect(result.regressions.every((row: any) => row.executionFailed)).toBe(true);
  });
});
