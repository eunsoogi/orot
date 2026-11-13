import { replyPreview } from './replyPreview';

export type ReplyIdentity = {
  requestId: string;
  sessionId: string;
  messageId: string;
  sessionVersion: number;
};

type Ports = {
  isBackground(): boolean;
  isEnabled(): Promise<boolean>;
  isAuthorized(): Promise<boolean>;
  readAnswer(identity: ReplyIdentity): Promise<string | null>;
  claim(requestId: string): Promise<boolean>;
  submit(identity: ReplyIdentity, preview: string): Promise<void>;
};

/** A durable claim consumes foreground completions too, preventing replay on a later launch. */
export function createReplyNotificationCoordinator(ports: Ports) {
  return {
    async consume(identity: ReplyIdentity): Promise<void> {
      if (!(await ports.claim(identity.requestId))) return;
      if (!ports.isBackground() || !(await ports.isEnabled())) return;
      if (!(await ports.isAuthorized())) return;
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
      await ports.submit(identity, preview);
    },
  };
}
