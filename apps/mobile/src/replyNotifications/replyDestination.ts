import type { ReplyIdentity } from './replyNotificationCoordinator';

type Ports = {
  consume(): Promise<unknown>;
  acknowledge(requestId: string): Promise<void>;
  open(identity: ReplyIdentity): Promise<'opened' | 'missing' | 'deferred'>;
  unavailable(): void;
};

/** The persisted inbox is acknowledged only after navigation or an explicit missing-reply explanation. */
export function createReplyDestination(ports: Ports) {
  return async (): Promise<
    'empty' | 'invalid' | 'opened' | 'missing' | 'deferred'
  > => {
    const value = await ports.consume();
    if (value == null) return 'empty';
    if (typeof value !== 'object') return 'invalid';
    const target = value as Record<string, unknown>;
    const { requestId, sessionId, messageId, sessionVersion } = target;
    if (
      typeof requestId !== 'string' ||
      !requestId ||
      typeof sessionId !== 'string' ||
      !sessionId ||
      typeof messageId !== 'string' ||
      !messageId ||
      typeof sessionVersion !== 'string' ||
      !/^\d+$/.test(sessionVersion)
    )
      return 'invalid';
    const version = Number(sessionVersion);
    if (!Number.isSafeInteger(version)) return 'invalid';
    const result = await ports.open({
      requestId,
      sessionId,
      messageId,
      sessionVersion: version,
    });
    if (result === 'deferred') return result;
    if (result === 'missing') ports.unavailable();
    await ports.acknowledge(requestId);
    return result;
  };
}
