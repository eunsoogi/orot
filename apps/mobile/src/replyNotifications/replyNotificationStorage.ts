import type { SqlDatabase } from '@orot/storage';
import { AppState } from 'react-native';
import type { createConversationArtifactStorage } from '../storage/conversationArtifactStorage';
import { createReplyCompletionConsumer } from './replyCompletionConsumer';
import { createReplyNotificationLedger } from './replyNotificationLedger';
import { nativeReplyNotifications } from './nativeReplyNotifications';
import { replyNotificationInvalidation } from './replyNotificationInvalidation';

type Storage = ReturnType<typeof createConversationArtifactStorage>;

/** Serialize notification work with session removal; saved replies remain committed if notification work fails. */
export function createReplyNotificationStorage(
  storage: Storage,
  database: SqlDatabase,
): Storage {
  const ledger = createReplyNotificationLedger(database);
  const consume = createReplyCompletionConsumer(storage, ledger);
  let recovery: Promise<void> | undefined;
  const prepare = () =>
    (recovery ??= ledger.recover().catch(error => {
      recovery = undefined;
      throw error;
    }));
  const queues = new Map<string, Promise<unknown>>();
  function serial<T>(sessionId: string, work: () => Promise<T>): Promise<T> {
    const prior = queues.get(sessionId) ?? Promise.resolve();
    const next = prior.catch(() => undefined).then(work);
    queues.set(sessionId, next);
    next
      .finally(() => {
        if (queues.get(sessionId) === next) queues.delete(sessionId);
      })
      .catch(() => undefined);
    return next;
  }
  const drainRetries = async () => {
    await prepare();
    for (const requestId of await ledger.retries()) {
      const identity = (await storage.listCompletionIdentities()).find(
        value => value.requestId === requestId,
      );
      if (!identity) {
        await ledger.finish(requestId);
        continue;
      }
      const generation = replyNotificationInvalidation.capture();
      await serial(identity.sessionId, () =>
        consume(requestId, () =>
          replyNotificationInvalidation.isCurrent(generation),
        ),
      );
    }
  };
  // The protected ledger contains only attempted new completions, so recovery never scans historical replies for delivery.
  drainRetries().catch(() => undefined);
  AppState.addEventListener('change', () => {
    drainRetries().catch(() => undefined);
  });
  const remove = async (sessionId: string) => {
    try {
      await nativeReplyNotifications().removeSession(sessionId);
    } catch {
      /* Storage deletion remains available when notifications are unavailable. */
    }
  };
  return {
    ...storage,
    async append(value, signal, version) {
      await storage.append(value, signal, version);
      if (value.status === 'complete') {
        const generation = replyNotificationInvalidation.capture();
        // Await local submission while the producer's existing execution lease is still active.
        try {
          await prepare();
          await serial(value.sessionId, () =>
            consume(value.id, () =>
              replyNotificationInvalidation.isCurrent(generation),
            ),
          );
        } catch {
          /* A notification failure never changes the committed answer. */
        }
      }
    },
    hideSession: (id, version) =>
      serial(id, async () => {
        await remove(id);
        return storage.hideSession(id, version);
      }),
    deleteSession: id =>
      serial(id, async () => {
        await remove(id);
        await storage.deleteSession(id);
      }),
  };
}
