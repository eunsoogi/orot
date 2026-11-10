import { visitHealthFixture } from '../../../agent/visitQuestions/testing/healthContextFixture';
import { createLocalHealthEvidenceRepository } from '../../../healthEvidence/localEvidenceRepository';
import type { HealthContextReader } from '../../../healthEvidence/healthContext/reader';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { loadSavedVisitQuestionState } from '../savedVisitQuestions';

test('does not publish an outdated saved list when another question is added during restoration', async () => {
  const fixture = await visitHealthFixture();
  try {
    await fixture.save();
    const second = {
      ...fixture.question,
      identity: { id: 'synthetic-second-question' },
      questionText: '합성 기록을 다음 진료에서 어떻게 확인할까요?',
    };
    let added = false;
    const read: HealthContextReader = async (...args) => {
      const report = await fixture.read(...args);
      if (!added) {
        added = true;
        await fixture.save({ questions: [fixture.question, second] });
      }
      return report;
    };
    const result = await loadSavedVisitQuestionState({
      appointmentId: fixture.prepared.appointment.id,
      records: fixture.records,
      sourceReader: createLocalHealthEvidenceRepository(fixture.database),
      registry: new LocalEvidenceReferenceRegistry(),
      readHealthContext: read,
    });
    expect(result).toMatchObject({
      status: 'error',
      questions: [],
      message: '저장된 질문 목록이 바뀌었어요. 다시 불러와 주세요.',
    });
    expect(
      (await fixture.records.list('visit_question'))
        .map(question => question.id)
        .sort(),
    ).toEqual([fixture.question.identity.id, second.identity.id].sort());
    const retried = await loadSavedVisitQuestionState({
      appointmentId: fixture.prepared.appointment.id,
      records: fixture.records,
      sourceReader: createLocalHealthEvidenceRepository(fixture.database),
      registry: new LocalEvidenceReferenceRegistry(),
      readHealthContext: fixture.read,
    });
    expect(retried.status).toBe('ready');
    if (retried.status !== 'ready')
      throw new Error('The updated list did not load.');
    expect(retried.questions.map(question => question.identity.id)).toEqual([
      fixture.question.identity.id,
      second.identity.id,
    ]);
  } finally {
    fixture.close();
  }
});

test('does not invalidate this visit when another visit receives a question', async () => {
  const fixture = await visitHealthFixture();
  try {
    await fixture.save();
    const original = (await fixture.records.list('visit_question'))[0]!;
    let added = false;
    const read: HealthContextReader = async (...args) => {
      const report = await fixture.read(...args);
      if (!added) {
        added = true;
        await fixture.records.put('visit_question', {
          ...original,
          id: 'synthetic-other-question',
          appointmentId: 'synthetic-other-visit',
        });
      }
      return report;
    };
    const result = await loadSavedVisitQuestionState({
      appointmentId: fixture.prepared.appointment.id,
      records: fixture.records,
      sourceReader: createLocalHealthEvidenceRepository(fixture.database),
      registry: new LocalEvidenceReferenceRegistry(),
      readHealthContext: read,
    });
    expect(result.status).toBe('ready');
    if (result.status !== 'ready')
      throw new Error('This visit was invalidated.');
    expect(result.questions.map(question => question.identity.id)).toEqual([
      fixture.question.identity.id,
    ]);
    expect(added).toBe(true);
    expect(
      await fixture.records.get('visit_question', 'synthetic-other-question'),
    ).not.toBeNull();
  } finally {
    fixture.close();
  }
});

test('does not treat distinct equivalent-looking question IDs as a concurrent change', async () => {
  const fixture = await visitHealthFixture();
  try {
    const first = { ...fixture.question, identity: { id: 'é' } };
    const second = {
      ...fixture.question,
      identity: { id: 'e\u0301' },
      questionText: '합성 기록의 확인 방법을 진료에서 물어볼까요?',
    };
    await fixture.save({ questions: [first, second] });
    const result = await loadSavedVisitQuestionState({
      appointmentId: fixture.prepared.appointment.id,
      records: fixture.records,
      sourceReader: createLocalHealthEvidenceRepository(fixture.database),
      registry: new LocalEvidenceReferenceRegistry(),
      readHealthContext: fixture.read,
    });
    expect(result.status).toBe('ready');
    if (result.status !== 'ready')
      throw new Error('Unchanged list was invalidated.');
    expect(result.questions.map(question => question.identity.id)).toEqual([
      first.identity.id,
      second.identity.id,
    ]);
  } finally {
    fixture.close();
  }
});
