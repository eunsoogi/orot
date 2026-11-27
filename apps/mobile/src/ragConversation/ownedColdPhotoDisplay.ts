import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
} from 'react';
import { isBoundedInlineJPEG } from '@orot/provider-openai';
import { projectTranscript, sentPhotoPreview } from './conversationBubblePaint';
import type { DisplayMessage } from './conversationDisplayMessage';

const idPattern = /^photo-reply:[0-9a-f]{32}$/;
const totalBudget = Math.ceil((4 * 1024 * 1024) / 3) * 4 + 8;
type Preview = string | readonly string[];
type Result = Readonly<{
  photoReplyId: string;
  generation: object;
  jpegs: readonly string[];
}>;

/** Only assign from the active protected native display owner. No implementation
 * is installed by this consumer. Admission metadata must not read image bytes;
 * the owner must abort on any lock, deletion, account, route or lease change,
 * including lock/unlock, and bound total concurrent borrowed render payload. */
export type OwnedColdPhotoDisplay = Readonly<{
  sessionId: number;
  generation: object;
  signal: AbortSignal;
  current: () => boolean;
  admits: (photoReplyId: string) => boolean;
  read: (photoReplyId: string, signal: AbortSignal) => Promise<Result | null>;
}>;

export const OwnedColdPhotoDisplayContext = createContext<
  OwnedColdPhotoDisplay | undefined
>(undefined);

function active(owner: OwnedColdPhotoDisplay | undefined) {
  return !!owner && !owner.signal.aborted && owner.current();
}

function candidate(
  message: DisplayMessage,
  owner: OwnedColdPhotoDisplay | undefined,
) {
  const id = message.archivedDirectPhotoId;
  if (
    !id ||
    !idPattern.test(id) ||
    message.role !== 'user' ||
    !message.savedHistoryDisplayOnly ||
    !message.restoredHistory ||
    !message.photoAttached ||
    !owner ||
    !active(owner) ||
    !owner.admits(id)
  )
    return undefined;
  return id;
}

function useActiveOwner() {
  const owner = useContext(OwnedColdPhotoDisplayContext);
  const current = useSyncExternalStore(
    change => {
      owner?.signal.addEventListener('abort', change, { once: true });
      return () => owner?.signal.removeEventListener('abort', change);
    },
    () => active(owner),
  );
  return current ? owner : undefined;
}

// Can only retain already-enrolled blank markers in the regular viewport.
function useColdPhotoAdmission(sessionId: number | undefined) {
  const owner = useActiveOwner();
  return owner && owner.sessionId === sessionId
    ? (message: DisplayMessage) => candidate(message, owner) !== undefined
    : undefined;
}

export function useOwnedColdPhotoTranscript(
  messages: readonly DisplayMessage[],
  separated: boolean,
  sessionId: number | undefined,
) {
  return projectTranscript(
    messages,
    separated,
    useColdPhotoAdmission(sessionId),
  );
}

function validProjection(
  result: Result | null,
  owner: OwnedColdPhotoDisplay,
  id: string,
) {
  if (
    !result ||
    result.photoReplyId !== id ||
    result.generation !== owner.generation ||
    !Array.isArray(result.jpegs) ||
    result.jpegs.length < 1 ||
    result.jpegs.length > 3
  )
    return;
  const images = [...result.jpegs];
  if (
    !images.every(isBoundedInlineJPEG) ||
    images.reduce((units, image) => units + image.length, 0) > totalBudget
  )
    return;
  return Object.freeze(images.map(jpeg => 'data:image/jpeg;base64,' + jpeg));
}

export function useOwnedColdPhotoPreview(
  message: DisplayMessage,
  sessionId: number | undefined,
): Preview | undefined {
  const activeOwner = useActiveOwner();
  const owner = activeOwner?.sessionId === sessionId ? activeOwner : undefined;
  const warmPreview = sentPhotoPreview(message);
  const id = !warmPreview ? candidate(message, owner) : undefined;
  const [value, setValue] = useState<{
    owner: OwnedColdPhotoDisplay;
    id: string;
    preview: readonly string[];
  }>();
  useEffect(() => {
    setValue(undefined);
    if (!owner || !id) return;
    const request = new AbortController();
    const retire = () => request.abort();
    owner.signal.addEventListener('abort', retire, { once: true });
    const current = () =>
      !request.signal.aborted && active(owner) && owner.admits(id);
    (async () => {
      if (!current()) return;
      const result = await owner.read(id, request.signal);
      if (!current()) return;
      const preview = validProjection(result, owner, id);
      if (preview && current()) setValue({ owner, id, preview });
    })().catch(() => undefined);
    return () => {
      retire();
      owner.signal.removeEventListener('abort', retire);
    };
  }, [id, owner]);
  return (
    warmPreview ??
    (id && owner && value?.owner === owner && value.id === id
      ? value.preview
      : undefined)
  );
}
