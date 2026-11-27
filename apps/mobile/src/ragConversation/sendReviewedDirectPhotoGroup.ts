import { AppState } from 'react-native';
import { conversationExecutionNative } from './conversationExecutionNative';
import { createConversationPhotoImageSend } from '../aiFeatures/integration/sendConversationPhotoImage';
import type { conversationDirectPhotoPorts } from './conversationDirectPhotoPorts';

type Ports = typeof conversationDirectPhotoPorts;

/** Own the exact consent decision and revoke any late native start on replacement. */
export function sendReviewedDirectPhotoGroup(input: {
  readonly authorization: NonNullable<
    Awaited<ReturnType<Ports['authorization']>>
  >;
  readonly grant: NonNullable<Awaited<ReturnType<Ports['grant']>>>;
  readonly images: readonly string[];
  readonly prompt: string;
  readonly localReplyId: string;
  readonly controller: AbortController;
  readonly admitted: () => boolean;
  readonly prepare: () => boolean | Promise<boolean>;
  readonly atNativeStart: () => boolean;
  readonly backgroundCurrent?: () => boolean;
}) {
  const {
    authorization,
    grant,
    images,
    prompt,
    localReplyId,
    controller,
    admitted,
    prepare,
    atNativeStart,
    backgroundCurrent,
  } = input;
  const protection =
    images.length > 1 ? conversationExecutionNative() : undefined;
  const active = () =>
    images.length === 1 ||
    (AppState.currentState === 'active' &&
      protection?.bridgeAvailable === true);
  const confirmProtection = async () => {
    if (images.length === 1) return true;
    try {
      if (
        active() &&
        (await protection?.protectedDataAvailable()) === true &&
        active()
      )
        return true;
    } catch {
      // Unknown protection has the same terminal effect as explicit loss.
    }
    controller.abort();
    return false;
  };
  if (!active()) controller.abort();
  return createConversationPhotoImageSend({
    selected: authorization.selected,
    jpegBase64s: images,
    prompt,
    localReplyId,
    signal: controller.signal,
    isCurrent: () => admitted() && (active() || backgroundCurrent?.() === true),
    // Transfer the scene owner only at the synchronous handoff to the
    // existing exact sender, never across a pending protection probe.
    beforeNativeStart: () =>
      active() && admitted() && atNativeStart() && active() && admitted(),
    subscribeInvalidation(listener) {
      const revoke = () => {
        controller.abort();
        listener();
      };
      const stopOwner = authorization.subscribe(revoke);
      const stopGrant = grant.subscribe(revoke);
      return () => {
        stopOwner();
        stopGrant();
      };
    },
    // The exact Settings image grant is the only consent for a stock photo send.
    confirm: async (_decision, signal) => {
      if (!grant.current() || !(await confirmProtection())) return false;
      if (
        signal.aborted ||
        !admitted() ||
        !(await confirmProtection()) ||
        signal.aborted ||
        !admitted() ||
        !active()
      )
        return false;
      // Opening the optional lease awaited native work. No new delivery may
      // start from a stale lock/phase witness, even if a lease was granted.
      return (
        (await prepare()) &&
        active() &&
        (await confirmProtection()) &&
        !signal.aborted &&
        admitted() &&
        active()
      );
    },
  })();
}
