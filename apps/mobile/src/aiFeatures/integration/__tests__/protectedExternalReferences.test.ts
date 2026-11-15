import { createPublicWebEvidence } from '../publicWebEvidence';
import { createExternalConversationEvidence } from '../externalConversationEvidence';
import { protectedExternalReferences } from '../protectedExternalReferences';
import { publicEvidenceFixture } from '../testSupport/publicWebEvidenceTestSupport';
import { referenceOnly } from '../../../diseaseHypotheses/resultValidation';

/** Synthetic searches only; imported provenance must never import prior authorization. */
test('a protected web snapshot restores exact citations without dispatch and fresh search needs fresh approval', async () => {
  const first = publicEvidenceFixture();
  const old = createPublicWebEvidence(first)!;
  const batch = await old.tool.search(first.request);
  if ('status' in batch) throw new Error('Expected evidence');
  const reference = referenceOnly(batch.items[0]!);
  const snapshot = old.snapshot();
  const next = publicEvidenceFixture();
  const fresh = createPublicWebEvidence({
    ...next,
    restoredReferences: snapshot,
  })!;
  expect(fresh.validates(reference)).toBe(true);
  expect(fresh.validates({ ...reference, evidenceRevision: 'changed' })).toBe(
    false,
  );
  expect(next.search).not.toHaveBeenCalled();
  expect(next.authorize).not.toHaveBeenCalled();
  const result = await fresh.tool.search(next.request);
  if ('status' in result) throw new Error('Expected evidence');
  expect(result.items[0]?.evidenceId).toBe('web-result-2');
  expect(next.search).toHaveBeenCalledTimes(1);
  expect(next.authorize).toHaveBeenCalledTimes(1);
  expect(snapshot.sequence).toBe(1);
});

test('wrong destination, duplicate provenance and regressed sequence fail closed', async () => {
  const f = publicEvidenceFixture();
  const web = createPublicWebEvidence(f)!;
  await web.tool.search(f.request);
  const snapshot = web.snapshot();
  expect(() => protectedExternalReferences('europe-pmc', snapshot)).toThrow();
  expect(() =>
    protectedExternalReferences('public-web', { ...snapshot, sequence: 0 }),
  ).toThrow();
  expect(() =>
    protectedExternalReferences('public-web', {
      ...snapshot,
      references: [...snapshot.references, ...snapshot.references],
    }),
  ).toThrow();
});

test('restored literature provenance does not skip fresh query consent', async () => {
  const publication = {
    provider: 'Europe PMC' as const,
    source: 'MED',
    recordId: '123',
    title: 'Synthetic',
    authors: null,
    journal: null,
    publicationDate: '2026-01-01',
    updatedDate: null,
    abstract: 'Synthetic abstract',
    originalUrl: 'https://europepmc.org/article/MED/123',
    retrievedAt: '2026-10-11T00:00:00Z',
  };
  const search = jest.fn(async () => ({
    status: 'available' as const,
    publications: [publication],
  }));
  const authorize = jest.fn(async () => 'authorized' as const);
  const old = createExternalConversationEvidence({ search }, { authorize });
  const f = publicEvidenceFixture();
  const result = await old.tool.search(f.request);
  if ('status' in result) throw new Error('Expected evidence');
  const freshSearch = jest.fn(async () => ({
    status: 'available' as const,
    publications: [publication],
  }));
  const deny = jest.fn(async () => 'denied' as const);
  const fresh = createExternalConversationEvidence(
    { search: freshSearch },
    { authorize: deny },
    { restoredReferences: old.snapshot() },
  );
  expect(fresh.validates(referenceOnly(result.items[0]!))).toBe(true);
  expect(freshSearch).not.toHaveBeenCalled();
  expect(deny).not.toHaveBeenCalled();
  expect(await fresh.tool.search(f.request)).toEqual({
    status: 'consent_required',
  });
  expect(deny).toHaveBeenCalledTimes(1);
  expect(freshSearch).not.toHaveBeenCalled();
});

test('forged web revisions and exhausted restored sequence are rejected without dispatch', async () => {
  const first = publicEvidenceFixture();
  const web = createPublicWebEvidence(first)!;
  await web.tool.search(first.request);
  const saved = web.snapshot();
  expect(() =>
    protectedExternalReferences('public-web', {
      ...saved,
      references: saved.references.map(ref => ({
        ...ref,
        evidenceRevision: 'forged',
      })),
    }),
  ).toThrow('provenance');
  const next = publicEvidenceFixture();
  const exhausted = createPublicWebEvidence({
    ...next,
    restoredReferences: { ...saved, sequence: Number.MAX_SAFE_INTEGER },
  })!;
  await expect(exhausted.tool.search(next.request)).rejects.toThrow();
  expect(next.authorize).not.toHaveBeenCalled();
  expect(next.search).not.toHaveBeenCalled();
});
