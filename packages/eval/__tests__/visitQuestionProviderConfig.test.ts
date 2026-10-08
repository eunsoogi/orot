import { describe, expect, it } from '@jest/globals';

const {
  getVisitQuestionProviderConfig,
} = require('../../../scripts/evaluation/visit-questions/provider-config.cjs');

describe('visit-question provider selection', () => {
  it('keeps the deterministic adapter as the default', () => {
    expect(getVisitQuestionProviderConfig({})).toEqual({
      mode: 'test-adapter',
      model: 'synthetic-scripted-v1',
      allowRemoteProcessing: false,
    });
  });

  it('rejects an unknown provider mode without attempting network access', () => {
    expect(() => getVisitQuestionProviderConfig({ OROT_VISIT_QUESTION_PROVIDER: 'other' })).toThrow(
      'OROT_VISIT_QUESTION_PROVIDER must be scripted or openai-api.',
    );
  });

  it('requires a key, model, and explicit synthetic remote-processing consent', () => {
    expect(() =>
      getVisitQuestionProviderConfig({
        OROT_VISIT_QUESTION_PROVIDER: 'openai-api',
        OROT_VISIT_QUESTION_MODEL: 'model-test',
      }),
    ).toThrow('OPENAI_API_KEY is required for the OpenAI API provider.');

    expect(() =>
      getVisitQuestionProviderConfig({
        OROT_VISIT_QUESTION_PROVIDER: 'openai-api',
        OPENAI_API_KEY: 'synthetic-test-key',
        OROT_ALLOW_SYNTHETIC_REMOTE_PROCESSING: '1',
      }),
    ).toThrow('OROT_VISIT_QUESTION_MODEL is required for the OpenAI API provider.');

    expect(() =>
      getVisitQuestionProviderConfig({
        OROT_VISIT_QUESTION_PROVIDER: 'openai-api',
        OPENAI_API_KEY: 'synthetic-test-key',
        OROT_VISIT_QUESTION_MODEL: 'model-test',
      }),
    ).toThrow('Set OROT_ALLOW_SYNTHETIC_REMOTE_PROCESSING=1 to send synthetic data.');
  });

  it('returns an explicitly opted-in API configuration without exposing the key in errors', () => {
    const config = getVisitQuestionProviderConfig({
      OROT_VISIT_QUESTION_PROVIDER: 'openai-api',
      OPENAI_API_KEY: 'synthetic-test-key',
      OROT_VISIT_QUESTION_MODEL: 'model-test',
      OROT_ALLOW_SYNTHETIC_REMOTE_PROCESSING: '1',
    });

    expect(config).toMatchObject({
      mode: 'openai-api',
      model: 'model-test',
      allowRemoteProcessing: true,
    });
    expect(JSON.stringify(config)).not.toContain('synthetic-test-key');
    expect(config.apiKey).toBe('synthetic-test-key');
  });
});
