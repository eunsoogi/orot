import type { ReplyIdentity } from './replyNotificationCoordinator';

type Ports = {
  consume(): Promise<unknown>;
  acknowledge(requestId: string): Promise<void>;
  open(
    identity: ReplyIdentity,
  ): Promise<'opened' | 'missing' | 'deferred' | 'cancelled'>;
  unavailable(): void;
  isCurrent?(): boolean;
  discardInvalid?(): Promise<void>;
};

// Process-local application state prevents a failed acknowledgement from navigating twice.
const applied = new Map<
  string,
  { result: 'opened' | 'missing' | 'cancelled'; explained: boolean }
>();

/** A terminal open, missing reply, or user cancellation is acknowledged without replay. */
export function createReplyDestination(ports: Ports) {
  return async (): Promise<
    'empty' | 'invalid' | 'opened' | 'missing' | 'deferred' | 'cancelled'
  > => {
    const current = ports.isCurrent ?? (() => true);
    if (!current()) return 'deferred';
    const value = await ports.consume();
    if (!current()) return 'deferred';
    if (value == null) return 'empty';
    if (typeof value !== 'object') {
      await ports.discardInvalid?.();
      return 'invalid';
    }
    const target = value as Record<string, unknown>;
    const { requestId, sessionId, messageId, sessionVersion, purpose } = target;
    if (purpose !== undefined && purpose !== 'interruption') {
      await ports.discardInvalid?.();
      return 'invalid';
    }
    if (
      typeof requestId !== 'string' ||
      !requestId ||
      typeof sessionId !== 'string' ||
      !sessionId ||
      typeof messageId !== 'string' ||
      !messageId ||
      typeof sessionVersion !== 'string' ||
      !/^\d+$/.test(sessionVersion)
    ) {
      await ports.discardInvalid?.();
      return 'invalid';
    }
    const version = Number(sessionVersion);
    if (!Number.isSafeInteger(version)) {
      await ports.discardInvalid?.();
      return 'invalid';
    }
    let entry = applied.get(requestId);
    if (!entry) {
      const result = await ports.open({
        requestId,
        sessionId,
        messageId,
        sessionVersion: version,
        ...(purpose === 'interruption' ? { purpose } : {}),
      });
      if (result === 'deferred') return result;
      // A stale owner cannot turn a late cancellation or missing result into an acknowledgement.
      if (!current() && result !== 'opened') return 'deferred';
      entry = { result, explained: false };
      applied.set(requestId, entry);
    }
    if (!current()) return 'deferred';
    if (entry.result === 'missing' && !entry.explained) {
      ports.unavailable();
      entry.explained = true;
    }
    await ports.acknowledge(requestId);
    applied.delete(requestId);
    return entry.result;
  };
}
