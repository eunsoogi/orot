import type { DisplayMessage } from './conversationDisplayMessage';

/** Owned by the mounted route only; never place image bytes in session or storage. */
export type DirectPhotoPresentation = Readonly<{
  sessionId: number;
  requestId: string;
  preview: string;
  previews?: readonly string[];
  pending: boolean;
}>;

export type PublishDirectPhoto = (
  value: DirectPhotoPresentation | { readonly retireRequestId: string } | null,
) => void;

/** A preview decorates an existing live row without assigning a new transcript identity. */
function createDirectPhotoPresentation(
  sessionId: number,
  requestId: string,
  image: string | readonly string[],
): DirectPhotoPresentation {
  const previews = (typeof image === 'string' ? [image] : image).map(
    photo => 'data:image/jpeg;base64,' + photo,
  );
  return {
    sessionId,
    requestId,
    preview: previews[0]!,
    ...(previews.length > 1 ? { previews: Object.freeze(previews) } : {}),
    pending: true,
  };
}

function presentDirectPhoto(
  messages: readonly DisplayMessage[],
  photo: DirectPhotoPresentation | null | undefined,
  sessionId: number | undefined,
): readonly DisplayMessage[] {
  if (!photo || photo.sessionId !== sessionId) return messages;
  const user = messages.find(
    message =>
      message.role === 'user' &&
      message.photoAttached &&
      message.directPhotoTurnId === photo.requestId,
  );
  const preview = {
    directPhotoPreviewData: photo.preview,
    ...(photo.previews ? { directPhotoPreviewGroup: photo.previews } : {}),
  };
  if (user)
    return messages.map(message =>
      message === user ? { ...message, ...preview } : message,
    );
  return messages;
}

/** A pending display is retired immediately by abort, even if the provider is still settling. */
export function beginDirectPhotoPresentation(
  publish: PublishDirectPhoto | undefined,
  signal: AbortSignal,
  sessionId: number,
  requestId: string,
  image: string | readonly string[],
) {
  if (!publish || signal.aborted) return;
  const photo = createDirectPhotoPresentation(sessionId, requestId, image);
  let saved = false;
  const retire = () => publish({ retireRequestId: requestId });
  signal.addEventListener('abort', retire, { once: true });
  publish(photo);
  return {
    complete() {
      if (signal.aborted) return;
      saved = true;
      publish({ ...photo, pending: false });
    },
    dispose(current: boolean) {
      signal.removeEventListener('abort', retire);
      if (current && !saved) retire();
    },
  };
}

/** Limit full-size mounted pixels, not the number of archived photo markers. */
export const maxMountedDirectPhotoPreviewUnits = 32 * 1024 * 1024;

export function updateDirectPhotoPresentations(
  prior: readonly DirectPhotoPresentation[],
  event: Parameters<PublishDirectPhoto>[0],
): readonly DirectPhotoPresentation[] {
  if (!event) return [];
  if ('retireRequestId' in event)
    return prior.filter(item => item.requestId !== event.retireRequestId);
  const next = [
    ...prior.filter(item => item.requestId !== event.requestId),
    event,
  ];
  const unitsFor = (item: DirectPhotoPresentation) =>
    item.previews?.reduce((sum, uri) => sum + uri.length, 0) ??
    item.preview.length;
  let units = next.reduce((sum, item) => sum + unitsFor(item), 0);
  while (next.length > 1 && units > maxMountedDirectPhotoPreviewUnits)
    units -= unitsFor(next.shift()!);
  return next;
}

export function presentDirectPhotos(
  messages: readonly DisplayMessage[],
  photos: readonly DirectPhotoPresentation[],
  sessionId: number | undefined,
): readonly DisplayMessage[] {
  return photos.reduce(
    (prior, photo) => presentDirectPhoto(prior, photo, sessionId),
    messages,
  );
}
