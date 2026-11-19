import { createConversationSessions } from '../conversationSessions';
import { sendConversationMessage } from '../conversationVisitDispatch';
import { registerConversationRequestObservation } from '../conversationRequestObservation';
import { ragConversationFailure } from '../../aiFeatures/integration/ragConversationFailure';
import { AiProviderSelectionError } from '../../aiFeatures/integration/provider';

test('distinguishes a rejected request from the selected-provider failure without recording input', async () => {
  const stages: string[] = [];
  const stop = registerConversationRequestObservation(stage =>
    stages.push(stage),
  );
  const store = createConversationSessions();
  const id = store.getSnapshot().activeId;
  const send = jest.fn(async () =>
    ragConversationFailure(
      new AiProviderSelectionError('selection-required'),
      new AbortController().signal,
      'selection',
    ),
  );
  try {
    await sendConversationMessage(store, id, send);
    expect(stages).toEqual(['dispatch', 'request-rejected']);
    expect(send).not.toHaveBeenCalled();
    stages.length = 0;
    store.setDraft(id, 'synthetic private question');
    await sendConversationMessage(store, id, send);
    expect(stages).toEqual([
      'dispatch',
      'request-accepted',
      'sender-invoked',
      'selection-required',
      'provider-configuration',
    ]);
    expect(JSON.stringify(stages)).not.toContain('synthetic private question');
    expect(store.getSnapshot().sessions[0]?.error).toContain('AI 서비스 설정');
    stop();
    stages.length = 0;
    await sendConversationMessage(store, id, send);
    expect(stages).toEqual([]);
  } finally {
    stop();
    store.dispose();
  }
});
