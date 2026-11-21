import { act, render } from '@testing-library/react-native';
import { createConversationSessions } from '../conversationSessions';
import {
  fixture,
  Transcript,
  at,
  sessionId,
} from '../testSupport/savedHistoryDisplayFixture';
import { conversationHistoryPayload } from '../conversationHistoryPayload';

test('actual app paging paints ordinary saved text without making it inference context', async () => {
  const f = await fixture(12);
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
    expect(f.strict).not.toHaveBeenCalled();
    expect(f.forbidden).not.toHaveBeenCalled();
    expect(ui.queryByText('Synthetic saved answer 11')).toBeTruthy();
    expect(ui.queryByText('Synthetic saved answer 0')).toBeNull();
    await act(async () => {
      await store.loadOlderHistory(id);
    });
    const state = store.getSnapshot().sessions.find(row => row.id === id)!;
    expect(state.savedHistoryDisplay?.map(item => item.row.id)).toEqual(
      Array.from({ length: 12 }, (_, i) => `turn-${i}`),
    );
    expect(state.messages).toEqual([]);
    expect(conversationHistoryPayload(state.messages, 'next')).toEqual([]);
    expect(f.strict).not.toHaveBeenCalled();
    expect(f.forbidden).not.toHaveBeenCalled();
    // Dropping or changing owner clears the private projection, not just its actions.
    await act(async () => store.invalidateAll());
    expect(ui.queryByText('Synthetic saved answer 11')).toBeNull();
    expect(
      store.getSnapshot().sessions.some(row => !!row.savedHistoryDisplay),
    ).toBe(false);
  } finally {
    await ui.unmount();
    store.dispose();
    f.f.close();
  }
}, 20000);

test('a held real database display does not publish after route ownership changes', async () => {
  const f = await fixture(1);
  let entered = () => {};
  let release = () => {};
  const held = new Promise<void>(done => {
    release = done;
  });
  const ready = new Promise<void>(done => {
    entered = done;
  });
  let permitted = true;
  const store = createConversationSessions({
    retention: f.retention,
    restoreSession: f.strict,
    restoreSessionPage: f.strict,
    readSavedHistoryDisplay: async (...args) => {
      const result = await f.reader(...args);
      entered();
      await held;
      return result;
    },
  });
  const ui = await render(<Transcript store={store} />);
  try {
    let opening: Promise<number> | undefined;
    await act(async () => {
      opening = store
        .attachExisting(sessionId, 0, at(0), true, () => permitted)
        .catch(() => -1);
      await ready;
    });
    expect(
      ui.getByRole('progressbar', { name: '이전 대화를 불러오는 중이에요' })
        .props.animating,
    ).toBe(true);
    expect(ui.queryByText('Synthetic saved answer 0')).toBeNull();
    permitted = false;
    await act(async () => {
      release();
      await opening;
    });
    expect(ui.queryByText('Synthetic saved answer 0')).toBeNull();
    expect(
      store.getSnapshot().sessions.some(row => !!row.savedHistoryDisplay),
    ).toBe(false);
    expect(f.strict).not.toHaveBeenCalled();
  } finally {
    release();
    await ui.unmount();
    store.dispose();
    f.f.close();
  }
}, 20000);
