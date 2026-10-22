import type { LanguageModelRequest } from '@orot/model-runtime';
import { createExecutionConsentRegistry } from '../../agent/execution/consentRegistry';
import { createRememberedInferenceConfirmation } from '../../agent/execution/rememberedInferenceConsent';
import { createHash } from '../../agent/execution/consentHashTestSupport';
import { classifyCalendarEvents } from '../classificationWorkflow';
import {
  event,
  input,
  makeProvider,
  workflowResponse,
} from '../classificationWorkflowTestFixtures';

test('one permission covers different calendar batches and a later classification run', async () => {
  const digests = new Set<string>();
  const confirm = jest.fn(async () => true);
  const consent = () =>
    createExecutionConsentRegistry(
      createRememberedInferenceConfirmation(confirm, {
        digest: async value => createHash('sha256').update(value).digest('hex'),
        receipts: {
          has: async key => digests.has(key),
          save: async (key, valid) => {
            if (valid()) digests.add(key);
          },
          clear: async () => {
            digests.clear();
          },
        },
      }),
    );
  const generate = jest.fn(async (request: LanguageModelRequest) =>
    workflowResponse(request),
  );
  const events = Array.from({ length: 9 }, (_, i) => event(i));
  for (let run = 0; run < 2; run++) {
    const result = await classifyCalendarEvents(
      input(events, { provider: makeProvider(generate), consent: consent() }),
    );
    expect(result.status).toBe('complete');
    expect(result.completedBatches).toBe(2);
  }
  expect(generate).toHaveBeenCalledTimes(4);
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(digests.size).toBe(1);
});
