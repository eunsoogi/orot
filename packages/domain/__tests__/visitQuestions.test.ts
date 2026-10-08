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
