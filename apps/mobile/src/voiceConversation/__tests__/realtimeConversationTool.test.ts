import type { OutboundProcessingRequest } from '@orot/agent-runtime';
import { AppState } from 'react-native';
import { createRealtimeConversationTool } from '../realtimeConversationTool';
import type { ConversationVoiceProps } from '../conversationVoiceDependencies';

jest.mock('../../ragConversation/entryIntentSender', () => ({
  entryIntentSender: (_store: unknown, _id: number, send: unknown) => send,
}));
const request = {
  callId: 'call',
  responseId: 'response',
  toolCallId: 'tool',
  inputItemId: 'input',
};
function fixture() {
  Object.defineProperty(AppState, 'currentState', {
    configurable: true,
    value: 'active',
  });
  const controller = new AbortController();
  const selection = {
    status: 'ready',
    provider: { id: 'chosen' },
    modelId: 'chosen-model',
    recipient: 'Chosen service',
  };
  const confirm = jest.fn(async () => true);
  const confirmResult = jest.fn(
    async (_request: OutboundProcessingRequest) => true,
  );
  const cancel = jest.fn();
  const completion = Promise.resolve({
    status: 'completed',
    answer: '합성 답변',
    identity: {},
  });
  const readCurrentCompletion = jest.fn<Promise<string | null>, []>(
    async () => '합성 답변',
  );
  const send = jest.fn((_id: number, _question: string, _sender: unknown) => ({
    completion,
    cancel,
    readCurrentCompletion,
  }));
  const onSend = jest.fn(async () => ({ status: 'success' }));
  const latest = {
    current: {
      store: {
        sendOwnedPrompt: send,
        getSnapshot: () => ({
          sessions: [{ id: 1, requestActivity: { requestId: 9 } }],
        }),
      },
      sessionId: 1,
      selectionRevision: 0,
      resolveSelectedAi: jest.fn(async () => selection),
      onSend,
      confirmRealtimeResult: confirmResult,
    } as unknown as ConversationVoiceProps,
  };
  const owned = jest.fn();
  const execute = createRealtimeConversationTool({
    latest,
    model: 'gpt-realtime-2.1',
    current: () => true,
    ownsRequest: owned,
    confirm,
  });
  return {
    execute,
    readCurrentCompletion,
    latest,
    confirm,
    confirmResult,
    send,
    onSend,
    owned,
    controller,
    cancel,
  };
}
test('confirms exact recognized speech and routes only a committed answer through fresh recipient consent', async () => {
  const f = fixture();
  const result = await f.execute('인식한 원문', request, f.controller.signal);
  expect(f.confirm).toHaveBeenCalledWith({
    text: '인식한 원문',
    recipient: 'Chosen service',
    model: 'chosen-model',
    signal: f.controller.signal,
  });
  expect(f.send.mock.calls[0][1]).toBe('인식한 원문');
  const approval = f.confirmResult.mock.calls[0][0] as any;
  expect(approval.providerId).toBe('openai-realtime');
  expect(approval.recipient).toBe('OpenAI Realtime API');
  expect(approval.remoteProcessing).toBe(true);
  expect(approval.consentScope).toBeUndefined();
  expect(approval.payload.messages[0].content).toBe(result);
  expect(result).toBe('{"status":"completed","answer":"합성 답변"}');
  expect(f.owned.mock.calls).toEqual([[9], [null, 9]]);
});
test.each(['deny', 'selection', 'background', 'abort'] as const)(
  'does not dispatch after transcript approval loses authority: %s',
  async mode => {
    const f = fixture();
    f.confirm.mockImplementation(async () => {
      if (mode === 'selection') (f.latest.current as any).selectionRevision++;
      if (mode === 'background')
        Object.defineProperty(AppState, 'currentState', {
          configurable: true,
          value: 'background',
        });
      if (mode === 'abort') f.controller.abort();
      return mode !== 'deny';
    });
    expect(
      await f.execute('합성 질문', request, f.controller.signal),
    ).toBeUndefined();
    expect(f.send).not.toHaveBeenCalled();
    expect(f.confirmResult).not.toHaveBeenCalled();
  },
);
test('a different provider after confirmation cannot inherit the recognized-text grant', async () => {
  const f = fixture();
  jest.mocked(f.latest.current.resolveSelectedAi).mockResolvedValueOnce({
    status: 'ready',
    provider: { id: 'first' },
    modelId: 'm',
    recipient: 'First',
  } as never);
  expect(
    await f.execute('합성 질문', request, f.controller.signal),
  ).toBeUndefined();
  expect(f.send).not.toHaveBeenCalled();
});
test.each(['deny', 'mutated', 'recipient', 'background', 'abort'] as const)(
  'does not export or rerun a completed workflow after result confirmation: %s',
  async mode => {
    const f = fixture();
    f.confirmResult.mockImplementation(async (...args: unknown[]) => {
      if (mode === 'mutated')
        (args[0] as any).payload.messages[0].content = 'changed';
      if (mode === 'recipient') (args[0] as any).recipient = 'different';
      if (mode === 'background')
        Object.defineProperty(AppState, 'currentState', {
          configurable: true,
          value: 'background',
        });
      if (mode === 'abort') f.controller.abort();
      return mode !== 'deny';
    });
    expect(
      await f.execute('합성 질문', request, f.controller.signal),
    ).toBeUndefined();
    expect(f.send).toHaveBeenCalledTimes(1);
  },
);
test('oversized recognized speech is rejected rather than silently edited', async () => {
  const f = fixture();
  expect(
    await f.execute('가'.repeat(1001), request, f.controller.signal),
  ).toBeUndefined();
  expect(f.confirm).not.toHaveBeenCalled();
  expect(f.send).not.toHaveBeenCalled();
});

test.each([null, '변경된 합성 답변'])(
  'does not export a deleted or changed completion after consent: %s',
  async answer => {
    const f = fixture();
    f.readCurrentCompletion.mockResolvedValue(answer);
    expect(
      await f.execute('합성 질문', request, f.controller.signal),
    ).toBeUndefined();
    expect(f.confirmResult).toHaveBeenCalledTimes(1);
    expect(f.readCurrentCompletion).toHaveBeenCalledTimes(1);
    expect(f.send).toHaveBeenCalledTimes(1);
  },
);
test('rechecks the cancellation lease after protected completion revalidation', async () => {
  const f = fixture();
  f.readCurrentCompletion.mockImplementation(async () => {
    f.controller.abort();
    return '합성 답변';
  });
  expect(
    await f.execute('합성 질문', request, f.controller.signal),
  ).toBeUndefined();
  expect(f.send).toHaveBeenCalledTimes(1);
});
