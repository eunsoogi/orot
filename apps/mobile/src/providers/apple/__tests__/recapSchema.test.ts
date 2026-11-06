import { recapModelJsonSchema } from '@orot/domain';
import type { JsonObject } from '@orot/model-runtime';
import { serializeAppleRequest } from '../serializeRequest';

it('can represent the Recap output schema for Apple guided generation', () => {
  expect(() =>
    serializeAppleRequest({
      messages: [{ role: 'user', content: 'synthetic' }],
      responseFormat: { name: 'recap', schema: recapModelJsonSchema as JsonObject },
    }),
  ).not.toThrow();
});
