import { chunkEvidenceSpan } from '@orot/rag';
import type { EvidenceSpan } from '@orot/domain';
import { reloadPersonalVisitEvidence } from '../reloadPersonalEvidence';
import { mapRagHitToVisitQuestionEvidence } from '../evidence';
import {
  evidenceSpan,
  sourceRecord,
  repository,
} from '../testing/persistenceFixtures';
import type { VisitQuestionChunkBuilder } from '../evidenceRevalidation';

it('reloads a reviewed citation by bounded identities without a text query', async () => {
  const store = repository({
    evidence_span: [evidenceSpan],
    source_record: [sourceRecord],
  });
  const chunk = chunkEvidenceSpan(evidenceSpan as EvidenceSpan);
  const current = await mapRagHitToVisitQuestionEvidence(store.service, {
    chunk,
    score: 0,
    lexicalRank: null,
    vectorRank: null,
  });
  const build = jest.fn<
    ReturnType<VisitQuestionChunkBuilder>,
    Parameters<VisitQuestionChunkBuilder>
  >(async () => [chunk]);
  expect(
    await reloadPersonalVisitEvidence(store.service, build, current.item),
  ).toEqual(current);
  const selection = build.mock.calls[0]![1]!;
  expect(selection.query).toBeUndefined();
  expect(selection.identities).toContainEqual({
    kind: 'evidence_span',
    id: evidenceSpan.id,
  });
  expect(
    selection.identities?.every(identity => identity.id === evidenceSpan.id),
  ).toBe(true);
  expect(selection.identities!.length).toBeLessThanOrEqual(9);
  expect(
    await reloadPersonalVisitEvidence(store.service, build, {
      ...current.item,
      evidenceRevision: 'changed',
    }),
  ).toBeUndefined();
  expect(
    await reloadPersonalVisitEvidence(
      store.service,
      async () => [],
      current.item,
    ),
  ).toBeUndefined();
});
