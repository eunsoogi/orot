import { describe, expect, it } from '@jest/globals';
import { VisitQuestionCreateSchema, VisitQuestionSchema } from '../src';
import { VisitQuestionSchema as VisitQuestionSchemaFromVisits } from '../src/visits';
import type { VisitQuestion as VisitQuestionFromVisits } from '../src/visits';
import { metadata } from './fixtures';

const legacyQuestion = {
  ...metadata('question-legacy'),
  questionText: '이 기록을 다음 진료에서 어떻게 확인하면 좋을까요?',
  priority: 'routine',
  evidenceSpanIds: ['evidence-1'],
};

describe('visit question persistence contracts', () => {
  it('continues to read previously stored questions without appointment details', () => {
    expect(VisitQuestionSchema.parse(legacyQuestion)).toEqual(legacyQuestion);
    expect(VisitQuestionCreateSchema.safeParse(legacyQuestion).success).toBe(false);
    const directModuleQuestion: VisitQuestionFromVisits =
      VisitQuestionSchemaFromVisits.parse(legacyQuestion);
    expect(directModuleQuestion).toEqual(legacyQuestion);
  });

  it('accepts a newly reviewed question with its appointment, rationale, and position', () => {
    const question = {
      ...legacyQuestion,
      appointmentId: 'appointment-1',
      rationale: '최근 기록에서 진료 때 확인할 항목을 찾았습니다.',
      position: 1,
    };

    expect(VisitQuestionCreateSchema.parse(question)).toEqual(question);
  });

  it('round-trips fixed health-period provenance through a saved record payload', () => {
    const source = {
      scope: {
        kind: 'health_context_period',
        version: 1,
        topic: 'sleep',
        window: {
          fromInclusive: '2026-10-01T00:00:00Z',
          toExclusive: '2026-10-05T00:00:00Z',
          timeZone: 'UTC',
        },
      },
      revision: 'synthetic-revision',
      deletionGeneration: 2,
    };
    const question = { ...legacyQuestion, healthContextSources: [source] };
    expect(VisitQuestionSchema.parse(JSON.parse(JSON.stringify(question)))).toEqual(question);
    for (const invalid of [
      { ...source, deletionGeneration: -1 },
      { ...source, revision: '' },
      { ...source, scope: { ...source.scope, topic: 'unknown' } },
      {
        ...source,
        scope: { ...source.scope, window: { ...source.scope.window, timeZone: 'unknown' } },
      },
      {
        ...source,
        scope: {
          ...source.scope,
          window: { ...source.scope.window, toExclusive: '2026-10-01T00:00:00Z' },
        },
      },
      {
        ...source,
        scope: {
          ...source.scope,
          window: { ...source.scope.window, toExclusive: '2027-10-01T00:00:00Z' },
        },
      },
    ])
      expect(
        VisitQuestionSchema.safeParse({ ...question, healthContextSources: [invalid] }).success,
      ).toBe(false);
  });

  it.each([
    { appointmentId: '   ' },
    { rationale: '   ' },
    { position: 0 },
    { position: 6 },
    { position: 1.5 },
  ])('rejects invalid new-list metadata: %p', (override) => {
    expect(
      VisitQuestionCreateSchema.safeParse({
        ...legacyQuestion,
        appointmentId: 'appointment-1',
        rationale: '최근 기록에서 진료 때 확인할 항목을 찾았습니다.',
        position: 1,
        ...override,
      }).success,
    ).toBe(false);
  });
});
