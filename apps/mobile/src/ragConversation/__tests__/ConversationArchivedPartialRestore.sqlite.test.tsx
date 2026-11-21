import { act, render } from '@testing-library/react-native';
import { createConversationSessions } from '../conversationSessions';
import {
  fixture,
  Transcript,
  at,
  sessionId,
} from '../testSupport/savedHistoryDisplayFixture';

test('real retained partial paints its body, while a request interrupted during retention does not paint uncommitted preview text', async () => {
  const f = await fixture(1, async storage => {
    const partial = {
      id: 'saved-partial',
      sessionId,
      sessionVersion: 0,
      question: 'Original partial question',
      createdAt: at(1),
    };
    await storage.startRequest(partial);
    await storage.append({
      ...partial,
      answer: 'Committed partial body',
      providerId: 'synthetic',
      modelId: 'synthetic',
      status: 'partial',
      sources: [],
      citations: [],
    });
    const interrupted = {
      id: 'waiting-retention',
      sessionId,
      sessionVersion: 0,
      question: 'Original interrupted question',
      createdAt: at(2),
    };
    await storage.startRequest(interrupted);
    const boundary = await storage.invalidatePreview({
      requestId: interrupted.id,
      sessionId,
      sessionVersion: 0,
    });
    const previewLease = {
      requestId: interrupted.id,
      sessionId,
      sessionVersion: 0,
    };
    await expect(
      storage.preparePreview(previewLease, boundary, {
        providerId: 'synthetic',
        modelId: 'synthetic',
        sources: [],
      }),
    ).resolves.toBe(true);
    await expect(
      storage.writePreview(
        previewLease,
        boundary,
        'Raw streaming draft must stay private',
      ),
    ).resolves.toBe(true);
    await storage.interruptRequest(
      interrupted.id,
      sessionId,
      0,
      'interrupted',
      'process-interrupted',
    );
    await storage.writeTaskCard({
      id: 'voice-end:otherwise-saved',
      sessionId,
      sessionVersion: 0,
      createdAt: at(3),
      expectedRevision: null,
      task: { kind: 'voice_end', durationSeconds: 3 },
    });
  });
  const store = createConversationSessions({
    retention: f.retention,
    restoreSession: f.strict,
    restoreSessionPage: f.strict,
    readSavedHistoryDisplay: f.reader,
  });
  const ui = await render(<Transcript store={store} />);
  try {
    let id = 0;
    await act(async () => {
      id = await store.attachExisting(sessionId, 0, at(0));
    });
    expect(ui.getByText('Synthetic saved answer 0')).toBeTruthy();
    expect(ui.getByText('Original partial question')).toBeTruthy();
    expect(ui.getByText('Committed partial body')).toBeTruthy();
    expect(ui.getByText('Original interrupted question')).toBeTruthy();
    expect(ui.queryByText('Raw streaming draft must stay private')).toBeNull();
    expect(ui.queryByText(/이전 답변의 출처를 확인할 수 없어/)).toBeNull();
    const state = store.getSnapshot().sessions.find(row => row.id === id)!;
    expect(state.messages).toEqual([]);
    expect(state.taskCards?.map(card => card.task.kind)).toEqual(['voice_end']);
    expect(f.strict).not.toHaveBeenCalled();
    expect(f.forbidden).not.toHaveBeenCalled();
  } finally {
    await ui.unmount();
    store.dispose();
    f.f.close();
  }
}, 20000);
