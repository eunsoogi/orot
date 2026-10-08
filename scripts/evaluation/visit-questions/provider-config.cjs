'use strict';

const SCRIPTED_MODE = 'scripted';
const OPENAI_API_MODE = 'openai-api';

/** Resolves an explicit provider choice and fails closed before any remote request. */
function getVisitQuestionProviderConfig(env) {
  const selectedMode = env.OROT_VISIT_QUESTION_PROVIDER?.trim() || SCRIPTED_MODE;
  if (selectedMode === SCRIPTED_MODE) {
    return {
      mode: 'test-adapter',
      model: 'synthetic-scripted-v1',
      allowRemoteProcessing: false,
    };
  }
  if (selectedMode !== OPENAI_API_MODE) {
    throw new Error('OROT_VISIT_QUESTION_PROVIDER must be scripted or openai-api.');
  }

  const apiKey = env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is required for the OpenAI API provider.');
  }
  const model = env.OROT_VISIT_QUESTION_MODEL?.trim();
  if (!model) {
    throw new Error('OROT_VISIT_QUESTION_MODEL is required for the OpenAI API provider.');
  }
  if (env.OROT_ALLOW_SYNTHETIC_REMOTE_PROCESSING !== '1') {
    throw new Error('Set OROT_ALLOW_SYNTHETIC_REMOTE_PROCESSING=1 to send synthetic data.');
  }

  const config = {
    mode: OPENAI_API_MODE,
    model,
    allowRemoteProcessing: true,
  };
  // Keep the credential out of JSON reports and object spreads while still passing it to fetch.
  Object.defineProperty(config, 'apiKey', { value: apiKey, enumerable: false });
  return config;
}

module.exports = { getVisitQuestionProviderConfig };
