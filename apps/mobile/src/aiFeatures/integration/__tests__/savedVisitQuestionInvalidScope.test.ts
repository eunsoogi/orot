import { visitHealthFixture } from '../../../agent/visitQuestions/testing/healthContextFixture';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { restoreVisitQuestionPeriodForHistory } from '../savedVisitQuestionHealthContext';
import { loadSavedVisitQuestionState } from '../savedVisitQuestions';
import { createLocalHealthEvidenceRepository } from '../../../healthEvidence/localEvidenceRepository';

test('rejects a malformed saved health scope without reading or changing saved questions', async () => {
  const fixture = await visitHealthFixture();
  try {
    await fixture.save();
    const before = await fixture.records.list('visit_question');
    const source = before[0]!.healthContextSources![0]!;
    const read = jest.fn(fixture.read);
    await expect(
      restoreVisitQuestionPeriodForHistory(
        { ...source, scope: { ...source.scope, topic: 'invalid' } } as never,
        read,
        new LocalEvidenceReferenceRegistry(),
      ),
    ).rejects.toMatchObject({ reason: 'invalid_question' });
    expect(read).not.toHaveBeenCalled();
    expect(await fixture.records.list('visit_question')).toEqual(before);
  } finally {
    fixture.close();
  }
});

test('reports invalid saved provenance without claiming a health record changed', async () => {
  const fixture = await visitHealthFixture();
  try {
    await fixture.save();
    const saved = await fixture.records.list('visit_question');
    const source = saved[0]!.healthContextSources![0]!;
    const invalidRow = {
      ...saved[0]!,
      healthContextSources: [
        {
          ...source,
          scope: {
            ...source.scope,
            window: {
              fromInclusive: '2026-01-01T00:00:00Z',
              toExclusive: '2026-04-02T00:00:00Z',
              timeZone: 'UTC',
            },
          },
        },
      ],
    };
    // The stored schema admits 91 elapsed days; the reader permits only 90 local days.
    await fixture.records.put('visit_question', invalidRow);
    const before = await fixture.records.list('visit_question');
    const read = jest.fn(fixture.read);
    const result = await loadSavedVisitQuestionState({
      appointmentId: fixture.prepared.appointment.id,
      records: fixture.records,
      sourceReader: createLocalHealthEvidenceRepository(fixture.database),
      readHealthContext: read,
      registry: new LocalEvidenceReferenceRegistry(),
    });
    expect(result).toMatchObject({
      status: 'error',
      message: '저장된 질문의 정보가 올바르지 않아 불러오지 못했어요.',
      questions: [],
    });
    expect(read).not.toHaveBeenCalled();
    expect(await fixture.records.list('visit_question')).toEqual(before);
  } finally {
    fixture.close();
  }
});
