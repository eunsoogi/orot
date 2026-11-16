import { conversationHistoryRecoveryProps } from '../conversationHistoryRecoveryProps';
import { createEmptyConversation } from '../conversationEmptySession';

function store() {
  return {
    loadOlderHistory: jest.fn(async () => {}),
    synchronizeModel: jest.fn(async () => {}),
    retryRestore: jest.fn(async () => {}),
  };
}
test('page and restore retry preserve the exact displayed session owner', async () => {
  const target = store();
  const session = {
    ...createEmptyConversation(42),
    historyHasMore: true,
    historyLoading: false,
    historyLoadFailed: true,
    restoreFailed: true,
  };
  const props = conversationHistoryRecoveryProps(session, target);
  expect(props).toMatchObject({
    historyHasMore: true,
    historyLoading: false,
    historyLoadFailed: true,
    restoreFailed: true,
  });
  await props.onLoadOlderHistory();
  props.onRetryRestore();
  expect(target.loadOlderHistory).toHaveBeenCalledWith(42);
  expect(target.retryRestore).toHaveBeenCalledWith(42);
  expect(target.synchronizeModel).not.toHaveBeenCalled();
});
test('failed model selection retries selection instead of restoring the old session', () => {
  const target = store();
  const props = conversationHistoryRecoveryProps(
    { ...createEmptyConversation(42), modelSelectionFailed: true },
    target,
  );
  expect(props.restoreFailed).toBe(true);
  props.onRetryRestore();
  expect(target.synchronizeModel).toHaveBeenCalledWith(true);
  expect(target.retryRestore).not.toHaveBeenCalled();
});
