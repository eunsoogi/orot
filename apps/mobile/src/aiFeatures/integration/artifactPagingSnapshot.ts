import type { ArtifactContinuation } from '../../ragConversation/artifactContinuation';
import type { LocalEvidenceReferenceRegistry } from './evidenceRegistry';
import { artifactCursorState } from './artifactCursorState';

type Catalog = 'summary' | 'conversation';
type Cursor = { token: string; query: string; cursor: string };
export interface ArtifactPagingSnapshot {
  version: 1;
  scope: string;
  catalogs: Array<{ catalog: Catalog; sequence: number; tokens: Cursor[] }>;
  pages: Array<{ catalog: Catalog; page: ArtifactContinuation }>;
  citations: Array<{ evidenceId: string; page: ArtifactContinuation | null }>;
}
const catalogs = ['summary', 'conversation'] as const;
const tokenPattern = (catalog: Catalog) =>
  catalog === 'summary'
    ? /^page-([1-9]\d*)$/u
    : /^conversation-page-([1-9]\d*)$/u;

/** Decode private pagination metadata before installing any state. No grants or source bodies. */
export function decodeArtifactPagingSnapshot(
  value: unknown,
): ArtifactPagingSnapshot {
  const saved = JSON.parse(JSON.stringify(value)) as ArtifactPagingSnapshot;
  const fail = () => {
    throw new Error('Invalid protected artifact paging state.');
  };
  if (
    !saved ||
    saved.version !== 1 ||
    typeof saved.scope !== 'string' ||
    !saved.scope ||
    !Array.isArray(saved.catalogs) ||
    saved.catalogs.length !== 2 ||
    !Array.isArray(saved.pages) ||
    saved.pages.length > 2 ||
    !Array.isArray(saved.citations) ||
    saved.citations.length > 4096
  )
    fail();
  const known = new Map<Catalog, Map<string, Cursor>>();
  for (const row of saved.catalogs) {
    if (
      !row ||
      !catalogs.includes(row.catalog) ||
      known.has(row.catalog) ||
      !Number.isSafeInteger(row.sequence) ||
      row.sequence < 0 ||
      !Array.isArray(row.tokens) ||
      row.tokens.length > 1024
    )
      fail();
    const tokens = new Map<string, Cursor>();
    for (const token of row.tokens) {
      const number =
        token && typeof token.token === 'string'
          ? tokenPattern(row.catalog).exec(token.token)?.[1]
          : undefined;
      if (
        !number ||
        Number(number) > row.sequence ||
        !Number.isSafeInteger(Number(number)) ||
        tokens.has(token.token) ||
        typeof token.query !== 'string' ||
        !token.query ||
        token.query.trim() !== token.query ||
        token.query.length > 240 ||
        typeof token.cursor !== 'string' ||
        !token.cursor ||
        token.cursor.length > 4096
      )
        fail();
      tokens.set(token.token, token);
    }
    known.set(row.catalog, tokens);
  }
  const checkPage = (page: ArtifactContinuation) => {
    if (
      !page ||
      (page.catalog !== undefined &&
        page.catalog !== 'summary' &&
        page.catalog !== 'conversation')
    )
      fail();
    const cursor = known.get(page.catalog ?? 'summary')?.get(page.cursor);
    if (!cursor || cursor.query !== page.query) fail();
  };
  const seenPages = new Set<Catalog>();
  for (const { catalog, page } of saved.pages) {
    if (
      !catalogs.includes(catalog) ||
      seenPages.has(catalog) ||
      (page.catalog ?? 'summary') !== catalog
    )
      fail();
    checkPage(page);
    seenPages.add(catalog);
  }
  const ids = new Set<string>();
  for (const row of saved.citations) {
    if (
      !row ||
      typeof row.evidenceId !== 'string' ||
      !row.evidenceId ||
      ids.has(row.evidenceId)
    )
      fail();
    if (row.page !== null) checkPage(row.page);
    ids.add(row.evidenceId);
  }
  return saved;
}

/** Only the originating live scope may export opaque token mappings. */
export function captureArtifactPagingSnapshot(
  registry: LocalEvidenceReferenceRegistry,
  scope: string,
  pages: ReadonlyMap<Catalog, ArtifactContinuation>,
  citations: ReadonlyMap<string, ArtifactContinuation | null>,
): ArtifactPagingSnapshot {
  return decodeArtifactPagingSnapshot({
    version: 1,
    scope,
    catalogs: catalogs.map(catalog => {
      const state = artifactCursorState(registry, catalog);
      return {
        catalog,
        sequence: state.sequence,
        tokens: [...state.tokens].map(([token, row]) => {
          if (row.scope !== scope)
            throw new Error('Artifact paging scope changed.');
          return { token, query: row.query, cursor: row.cursor };
        }),
      };
    }),
    pages: [...pages].map(([catalog, page]) => ({ catalog, page })),
    citations: [...citations].map(([evidenceId, page]) => ({
      evidenceId,
      page,
    })),
  });
}

/** Caller must first verify protected request/session/version ownership. Rebind only control scope,
 * never query/cursor identity. Install into a fresh registry so live work cannot be overwritten. */
export function restoreArtifactPagingSnapshot(
  registry: LocalEvidenceReferenceRegistry,
  value: unknown,
  newScope: string,
) {
  const saved = decodeArtifactPagingSnapshot(value);
  if (!newScope) throw new Error('Artifact paging owner unavailable.');
  for (const row of saved.catalogs) {
    const current = artifactCursorState(registry, row.catalog);
    if (current.sequence || current.tokens.size)
      throw new Error('Artifact paging owner already in use.');
  }
  for (const row of saved.catalogs) {
    const current = artifactCursorState(registry, row.catalog);
    current.sequence = row.sequence;
    for (const { token, ...cursor } of row.tokens)
      current.tokens.set(token, { ...cursor, scope: newScope });
  }
  return {
    pages: new Map(saved.pages.map(row => [row.catalog, row.page])),
    citations: new Map(saved.citations.map(row => [row.evidenceId, row.page])),
  };
}

/** Protected descriptor ownership must match the currently selected retained request before scope rebinding. */
export function coldArtifactPaging(
  descriptor: import('../../storage/conversationColdResumeDescriptor').ConversationColdResumeDescriptor,
  observer?: import('../../ragConversation/conversationObserver').RagConversationObserver,
) {
  const saved = descriptor.reconstruction.artifactPaging;
  if (saved === undefined) return undefined;
  if (
    !observer?.conversationScope ||
    observer.retentionRequestId !== descriptor.manifest.requestId ||
    observer.retentionSession?.id !== descriptor.manifest.sessionId ||
    observer.retentionSession.version !== descriptor.manifest.sessionVersion
  )
    throw new Error('Cold artifact paging ownership changed.');
  return decodeArtifactPagingSnapshot(saved);
}
