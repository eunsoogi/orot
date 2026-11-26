import type { createAiFeatureServices } from '../featureServices';
import type { healthContextFixture } from './healthContextPersistenceFixture';
import type { EvidenceReference } from '@orot/agent-runtime';
import { presentHealthContextDocument } from '../healthContextPresentation';

const originalDescription = '합성 증상 원본 ' + '가'.repeat(1250);

/** The newest entry cannot fit even alone, but other complete entries can. */
export async function seedLongComputedSymptoms(
  repository: Awaited<ReturnType<typeof healthContextFixture>>['repository'],
) {
  for (const [index, description] of [
    originalDescription,
    '합성 두 번째 기록',
    '합성 세 번째 기록',
    '합성 네 번째 기록',
  ].entries()) {
    const at = `2026-10-0${4 - index}T01:00:00Z`;
    await repository.put('symptom_entry', {
      status: 'active',
      id: `synthetic-${index}`,
      effectiveAt: at,
      recordedAt: at,
      ingestedAt: at,
      provenance: { origin: 'user_reported', sourceRecordIds: [] },
      reviewState: { status: 'unreviewed' },
      description,
    });
  }
}

/** Read the same authorized detail document used by the evidence view. */
export async function expectBoundedSymptomPresentation(
  readSource: ReturnType<typeof createAiFeatureServices>['readSource'],
  source: EvidenceReference,
  summary: string,
) {
  expect(summary).toContain('증상 기록 4건 · 4일');
  expect(summary).toContain('합성 두 번째 기록');
  expect(summary).toContain('합성 네 번째 기록');
  expect(summary).not.toContain('합성 증상 원본');
  expect(summary).toContain(
    '요약에 담지 못한 기록은 근거에서 확인할 수 있어요.',
  );
  const detail = await readSource(source, new AbortController().signal);
  expect(detail.status).toBe('available');
  if (
    detail.status !== 'available' ||
    detail.document.sourceKind !== 'health_context_period'
  )
    throw new Error('Expected the existing period detail.');
  expect(
    presentHealthContextDocument(detail.document)
      .flatMap(group => group.rows)
      .map(row => row.value),
  ).toContain(originalDescription);
}
