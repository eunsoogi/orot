import { serializeAppleRecapRequest } from '../serializeRequest';
import { appleRecapProvider, appleFoundationModelsProvider } from '../index';

it('selects the Recap transformation profile for plain text only', () => {
  expect(
    serializeAppleRecapRequest({
      messages: [{ role: 'user', content: 'synthetic' }],
    }),
  ).toMatchObject({
    mode: 'text',
    profile: 'recap-transformation',
  });
  expect(() =>
    serializeAppleRecapRequest({
      messages: [{ role: 'user', content: 'synthetic' }],
      responseFormat: { name: 'recap', schema: { type: 'object' } },
    }),
  ).toThrow();
  expect(() =>
    serializeAppleRecapRequest({
      messages: [{ role: 'user', content: 'synthetic' }],
      tools: [{ name: 'lookup', inputSchema: { type: 'object' } }],
    }),
  ).toThrow();
});

it('keeps the selected provider identity while disabling guided tools and streaming', () => {
  const recap = appleRecapProvider();
  expect(recap.id).toBe(appleFoundationModelsProvider.id);
  expect(recap.capabilities).toMatchObject({
    streaming: false,
    structuredOutput: false,
    toolCalling: false,
  });
  expect(appleFoundationModelsProvider.capabilities).toMatchObject({
    streaming: true,
    structuredOutput: true,
    toolCalling: true,
  });
});
