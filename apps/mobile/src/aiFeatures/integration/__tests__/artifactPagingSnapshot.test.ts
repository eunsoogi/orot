import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { artifactCursorState } from '../artifactCursorState';
import {
  captureArtifactPagingSnapshot,
  decodeArtifactPagingSnapshot,
  restoreArtifactPagingSnapshot,
} from '../artifactPagingSnapshot';

function fixture() {
  const registry = new LocalEvidenceReferenceRegistry();
  const state = artifactCursorState(registry, 'summary');
  state.sequence = 3;
  state.tokens.set('page-3', {
    query: 'synthetic',
    cursor: 'private-row-cursor',
    scope: 'old-owner',
  });
  return captureArtifactPagingSnapshot(
    registry,
    'old-owner',
    new Map([['summary', { query: 'synthetic', cursor: 'page-3' }]]),
    new Map([['opaque-evidence', { query: 'synthetic', cursor: 'page-3' }]]),
  );
}

test('detaches tokens and chooser state, then rebinds only the verified scope', () => {
  const saved = fixture();
  const registry = new LocalEvidenceReferenceRegistry();
  const restored = restoreArtifactPagingSnapshot(registry, saved, 'new-owner');
  saved.catalogs[0].tokens[0].cursor = 'changed-after-restoration';
  expect(artifactCursorState(registry, 'summary').tokens.get('page-3')).toEqual(
    {
      scope: 'new-owner',
      query: 'synthetic',
      cursor: 'private-row-cursor',
    },
  );
  expect(restored.pages.get('summary')).toEqual({
    query: 'synthetic',
    cursor: 'page-3',
  });
  expect(restored.citations.get('opaque-evidence')).toEqual(
    restored.pages.get('summary'),
  );
  expect(() =>
    restoreArtifactPagingSnapshot(registry, fixture(), 'new-owner'),
  ).toThrow('already in use');
});

test.each(['query', 'catalog', 'sequence', 'duplicate', 'unknownCitation'])(
  'rejects inconsistent protected paging: %s without installing partial state',
  variant => {
    const saved = fixture();
    if (variant === 'query')
      saved.pages[0].page = { query: 'another query', cursor: 'page-3' };
    if (variant === 'catalog')
      saved.pages[0].page = {
        query: 'synthetic',
        cursor: 'page-3',
        catalog: 'conversation',
      };
    if (variant === 'sequence') saved.catalogs[0].sequence = 2;
    if (variant === 'duplicate')
      saved.catalogs[0].tokens.push(saved.catalogs[0].tokens[0]);
    if (variant === 'unknownCitation')
      saved.citations[0].page = { query: 'synthetic', cursor: 'page-99' };
    const registry = new LocalEvidenceReferenceRegistry();
    expect(() =>
      restoreArtifactPagingSnapshot(registry, saved, 'new-owner'),
    ).toThrow();
    expect(artifactCursorState(registry, 'summary').tokens.size).toBe(0);
    expect(artifactCursorState(registry, 'conversation').tokens.size).toBe(0);
  },
);

test('never exports tokens owned by another scope', () => {
  const registry = new LocalEvidenceReferenceRegistry();
  artifactCursorState(registry, 'summary').tokens.set('page-1', {
    query: 'synthetic',
    cursor: 'private',
    scope: 'another',
  });
  expect(() =>
    captureArtifactPagingSnapshot(registry, 'current', new Map(), new Map()),
  ).toThrow('scope changed');
  expect(() => decodeArtifactPagingSnapshot(null)).toThrow();
});
