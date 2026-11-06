import { recapModelJsonSchema } from '@orot/domain';
import { serializeAppleRequest } from '../serializeRequest';

it('can represent the Recap output schema for Apple guided generation', () => {
  expect(() =>
    serializeAppleRequest({
      messages: [{ role: 'user', content: 'synthetic' }],
      responseFormat: { name: 'recap', schema: recapModelJsonSchema },
    }),
  ).not.toThrow();
});
