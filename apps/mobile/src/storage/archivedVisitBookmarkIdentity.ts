import { fingerprintText } from '../aiFeatures/integration/evidenceUtils';

type Identity = Readonly<{
  id: string;
  sessionId: string;
  createdAt: string;
  revision: string;
}>;

export type ArchivedVisitBookmarkIdentity = Identity;

/** Process-local display receipt; neither model data nor a bookmark permission. */
export type ArchivedVisitBookmarkMarker = Readonly<{ key: number }>;
const issued = new WeakMap<
  ArchivedVisitBookmarkMarker,
  Identity & { version: number }
>();
let nextKey = 0;

/** Hash only an already-loaded, bounded archive row, never load any sources for its marker. */
export function archivedVisitRevision(serialized: unknown) {
  return typeof serialized === 'string' && serialized.length <= 256 * 1024
    ? fingerprintText(serialized)
    : undefined;
}

export function bindArchivedVisitBookmark(
  identity: Identity,
  version: number,
): ArchivedVisitBookmarkMarker {
  const marker = Object.freeze({ key: ++nextKey });
  issued.set(marker, Object.freeze({ ...identity, version }));
  return marker;
}

export function archivedVisitBookmarkOriginal(
  marker: ArchivedVisitBookmarkMarker,
  lease: { readonly id: string; readonly version: number },
) {
  const original = issued.get(marker);
  return original?.sessionId === lease.id && original.version === lease.version
    ? original
    : undefined;
}
