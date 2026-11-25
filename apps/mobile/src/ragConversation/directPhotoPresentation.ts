import type { DisplayMessage } from './conversationDisplayMessage';

/** Owned by the mounted route only; never place image bytes in session or storage. */
export type DirectPhotoPresentation = Readonly<{
  sessionId: number;
  requestId: string;
  displayId: number;
  submittedAt: string;
  prompt: string;
  preview: string;
  pending: boolean;
}>;

export type PublishDirectPhoto = (
  value: DirectPhotoPresentation | null,
) => void;

let nextDisplayId = Number.MAX_SAFE_INTEGER;

/** This display-only ID comes from the high end of the safe-integer range,
 * apart from increasing live IDs and negative restored-history IDs. */
function createDirectPhotoPresentation(
  sessionId: number,
  requestId: string,
  prompt: string,
  image: string,
): DirectPhotoPresentation {
  return {
    sessionId,
    requestId,
    displayId: nextDisplayId--,
    submittedAt: new Date().toISOString(),
    prompt,
    preview: 'data:image/jpeg;base64,' + image,
    pending: true,
  };
}

export function presentDirectPhoto(
  messages: readonly DisplayMessage[],
  photo: DirectPhotoPresentation | null | undefined,
  sessionId: number | undefined,
): readonly DisplayMessage[] {
  if (!photo || photo.sessionId !== sessionId) return messages;
  const user = messages.find(
    message =>
      message.role === 'user' &&
      message.photoAttached &&
      message.voiceTimelineOrder?.id === photo.requestId,
  );
  const preview = { directPhotoPreviewData: photo.preview };
  if (user)
    return messages.map(message =>
      message === user
        ? { ...message, id: photo.displayId, ...preview }
        : message,
    );
  if (!photo.pending) return messages;
  return [
    ...messages,
    {
      id: photo.displayId,
      role: 'user',
      content: photo.prompt,
      photoAttached: true,
      delivery: { submittedAt: photo.submittedAt },
      deliveryPending: true,
      ...preview,
    },
  ];
}

/** A pending display is retired immediately by abort, even if the provider is still settling. */
export function beginDirectPhotoPresentation(
  publish: PublishDirectPhoto | undefined,
  signal: AbortSignal,
  sessionId: number,
  requestId: string,
  prompt: string,
  image: string,
) {
  if (!publish || signal.aborted) return;
  const photo = createDirectPhotoPresentation(
    sessionId,
    requestId,
    prompt,
    image,
  );
  let saved = false;
  const retire = () => publish(null);
  signal.addEventListener('abort', retire, { once: true });
  publish(photo);
  return {
    complete() {
      if (signal.aborted) return;
      saved = true;
      publish({ ...photo, prompt: '', pending: false });
    },
    dispose(current: boolean) {
      signal.removeEventListener('abort', retire);
      if (current && !saved) retire();
    },
  };
}
