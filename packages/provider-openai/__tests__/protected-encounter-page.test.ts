import type { LanguageModelRequest } from '@orot/model-runtime';
import { createProtectedEncounterPageSender } from '../src/protected-encounter-page';

const request: LanguageModelRequest = {
  messages: [
    { role: 'system', content: 'Synthetic instruction' },
    { role: 'user', content: 'Synthetic transcript\n' },
    { role: 'user', content: 'Synthetic citations' },
    { role: 'user', content: 'Synthetic schema' },
  ],
  tools: [],
};
const expected = {
  instruction: 'Synthetic instruction',
  transcript: 'Synthetic transcript\n',
  citations: 'Synthetic citations',
  schema: 'Synthetic schema',
};

test('one exact final-only page uses the pinned account and model without a streamer', async () => {
  const { signal } = new AbortController();
  const invoke = jest.fn(async () => ({ text: 'validated terminal only' }));
  const send = createProtectedEncounterPageSender({
    issuedClientID: 'account',
    selectedModel: 'model',
    isCurrent: () => true,
    invoke,
  });
  await expect(send(request, { signal })).resolves.toEqual({
    ok: true,
    value: {
      text: 'validated terminal only',
      toolCalls: [],
      finishReason: 'complete',
    },
  });
  expect(invoke).toHaveBeenCalledWith('account', 'model', expected, signal);
  await expect(send(request, { signal })).resolves.toMatchObject({ ok: false });
  expect(invoke).toHaveBeenCalledTimes(1);
});

test('malformed or augmented wire never reaches native', async () => {
  const { signal } = new AbortController();
  const invoke = jest.fn();
  const send = createProtectedEncounterPageSender({
    issuedClientID: 'account',
    selectedModel: 'model',
    isCurrent: () => true,
    invoke,
  });
  for (const extra of [
    { ...request, maxOutputTokens: 5 },
    { ...request, messages: request.messages.slice(0, 3) },
    {
      ...request,
      messages: [...request.messages, { role: 'assistant' as const, content: 'History' }],
    },
  ])
    await expect(send(extra, { signal })).resolves.toMatchObject({ ok: false });
  expect(invoke).not.toHaveBeenCalled();
});

test('late terminal after Stop or owner loss cannot return or retry', async () => {
  for (const retired of ['stop', 'owner'] as const) {
    const controller = new AbortController();
    let current = true;
    const invoke = jest.fn(async () => {
      if (retired === 'stop') controller.abort();
      else current = false;
      return { text: 'late answer' };
    });
    const send = createProtectedEncounterPageSender({
      issuedClientID: 'account',
      selectedModel: 'model',
      isCurrent: () => current,
      invoke,
    });
    await expect(send(request, { signal: controller.signal })).resolves.toMatchObject({
      ok: false,
    });
    current = true;
    await expect(send(request, { signal: new AbortController().signal })).resolves.toMatchObject({
      ok: false,
    });
    expect(invoke).toHaveBeenCalledTimes(1);
  }
});
