import { replyPreview } from './replyPreview';

export type ReplyIdentity = {
  requestId: string;
  sessionId: string;
  messageId: string;
  sessionVersion: number;
};
export type ReplyNotificationLease = { global: number; session: number };

type Ports = {
  isBackground(): boolean;
  isEnabled(): Promise<boolean>;
  isAuthorized(): Promise<boolean>;
  lease(identity: ReplyIdentity): Promise<ReplyNotificationLease>;
  readAnswer(identity: ReplyIdentity): Promise<string | null>;
  claim(requestId: string, eligible: boolean): Promise<boolean>;
  release(requestId: string): Promise<void>;
  start(requestId: string): Promise<void>;
  finish(requestId: string): Promise<void>;
  submit(
    identity: ReplyIdentity,
    preview: string,
    lease: ReplyNotificationLease,
  ): Promise<'submitted' | 'suppressed' | 'failed'>;
};

/** A durable claim consumes foreground completions too, preventing replay on a later launch. */
export function createReplyNotificationCoordinator(ports: Ports) {
  return {
    async consume(identity: ReplyIdentity): Promise<void> {
      if (!(await ports.claim(identity.requestId, ports.isBackground())))
        return;
      let submissionStarted = false;
      let disposition: 'done' | 'retry' | 'uncertain' = 'done';
      try {
        if (!ports.isBackground() || !(await ports.isEnabled())) return;
        if (!(await ports.isAuthorized())) return;
        const lease = await ports.lease(identity);
        const answer = await ports.readAnswer(identity);
        if (answer === null || !ports.isBackground()) return;
        const preview = replyPreview(answer);
        if (!preview || !(await ports.isAuthorized())) return;
        // Re-read the protected answer after asynchronous checks; native submission must
        // also fence visibility and deletion at its own final delivery boundary.
        if (
          (await ports.readAnswer(identity)) !== answer ||
          !ports.isBackground()
        )
          return;
        await ports.start(identity.requestId);
        submissionStarted = true;
        if ((await ports.submit(identity, preview, lease)) === 'failed')
          disposition = 'retry';
      } catch (error) {
        // An interrupted bridge call may already have reached iOS; never replay an uncertain attempt.
        disposition = submissionStarted ? 'uncertain' : 'retry';
        throw error;
      } finally {
        if (disposition === 'done') await ports.finish(identity.requestId);
        if (disposition === 'retry') await ports.release(identity.requestId);
      }
    },
  };
}
