export type RecordingRecipient = {
  readonly providerId: string;
  readonly modelId: string;
  readonly recipient: string;
  readonly remoteProcessing: boolean;
};

export type RecordingClarificationReply = {
  readonly originalQuestion: string;
  readonly recipient: RecordingRecipient;
  readonly exactUserTimestamp: string;
  readonly isCurrent: () => boolean;
  claim(): boolean;
};

type LiveTurn = {
  readonly question: string;
  readonly key?: string;
  current(): boolean;
  protectedCurrent(): Promise<boolean>;
  subscribeInvalidation(invalidate: () => void): () => void;
};
type Receipt = {
  readonly key: string;
  readonly question: string;
  readonly expires: number;
  readonly recipient: RecordingRecipient;
  dispose(): void;
};
const owned = new WeakMap<object, Map<number, Receipt>>();
const iso =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

/** One owner, one scope, and the immediately next live user submission.
 * A reminder or a restored display bubble is never a selector. */
export function recordingClarificationForLiveTurn(
  owner: object,
  id: number,
  turn: LiveTurn,
) {
  let receipts = owned.get(owner);
  if (!receipts) {
    receipts = new Map();
    owned.set(owner, receipts);
  }
  const captured = receipts.get(id);
  captured?.dispose();
  let claimed = false;
  const reply =
    captured &&
    captured.key === turn.key &&
    captured.expires >= Date.now() &&
    turn.current() &&
    turn.question.length <= 1000 &&
    iso.test(turn.question) &&
    Number.isFinite(Date.parse(turn.question))
      ? {
          originalQuestion: captured.question,
          recipient: captured.recipient,
          exactUserTimestamp: turn.question,
          isCurrent: turn.current,
          claim() {
            if (claimed || !turn.current()) return false;
            claimed = true;
            return true;
          },
        }
      : undefined;
  const retention = receipts;
  let staged = false;
  return {
    reply,
    async stage(
      recipient: RecordingRecipient,
      originalQuestion = turn.question,
    ) {
      if (staged || !turn.key || !turn.current()) return false;
      staged = true;
      try {
        if (!(await turn.protectedCurrent()) || !turn.current()) return false;
      } catch {
        return false;
      }
      retention.get(id)?.dispose();
      let stop: (() => void) | undefined;
      let expiry: ReturnType<typeof setTimeout> | undefined;
      const receipt: Receipt = {
        key: turn.key,
        question: originalQuestion,
        recipient: { ...recipient },
        expires: Date.now() + 5 * 60 * 1000,
        dispose() {
          if (retention.get(id) === receipt) retention.delete(id);
          if (expiry !== undefined) clearTimeout(expiry);
          stop?.();
        },
      };
      retention.set(id, receipt);
      try {
        stop = turn.subscribeInvalidation(receipt.dispose);
      } catch {
        receipt.dispose();
        return false;
      }
      if (retention.get(id) !== receipt) {
        stop();
        return false;
      }
      expiry = setTimeout(receipt.dispose, 5 * 60 * 1000);
      return true;
    },
  };
}
