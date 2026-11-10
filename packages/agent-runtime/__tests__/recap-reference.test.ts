import { recapInput } from './recap-fixtures';
import { recapUnits, resolveRecapUnit } from '../src/recap/units';
import { validateReferenceChunk } from '../src/recap/referenceValidation';

it('resolves cited units and rejects foreign references and identities', () => {
  const input = recapInput('이 약 계속 먹나요? 네, 그대로 드세요.');
  const units = recapUnits(input);
  const wire = {
    recordingSourceId: input.recordingSourceId,
    appointmentId: input.appointmentId,
    chunkIndex: 0,
    questions: [
      {
        questionId: 'question-1',
        status: 'evidence_found',
        questionSufficiency: 'complete',
        questionRefs: [units[0].ref],
        answers: [
          {
            refs: [units[1].ref],
            utteranceRole: 'response',
            association: 'clear',
            summary: '그대로 복용하라는 응답',
            inferredRole: 'uncertain',
            speakerUncertainty: '발화자 미확인',
          },
        ],
      },
    ],
  };
  const result = validateReferenceChunk(wire, input, units, 0);
  const absent = {
    ...wire,
    questions: [
      {
        ...wire.questions[0],
        status: 'not_found',
        questionSufficiency: 'absent',
        questionRefs: [],
        answers: [],
      },
    ],
  };
  expect(validateReferenceChunk(absent, input, units, 0)[0]).toMatchObject({
    status: 'not_found',
    answers: [],
  });
  expect(() =>
    validateReferenceChunk(
      { ...absent, questions: [{ ...absent.questions[0], questionSufficiency: 'complete' }] },
      input,
      units,
      0,
    ),
  ).toThrow();
  const invalidFiltered = {
    ...wire,
    questions: [
      {
        ...wire.questions[0],
        answers: [
          { ...wire.questions[0].answers[0], utteranceRole: 'question', refs: ['foreign'] },
        ],
      },
    ],
  };
  expect(() => validateReferenceChunk(invalidFiltered, input, units, 0)).toThrow();
  expect(result[0].answers[0].quotation).toBe(units[1].text);
  expect(result[0].answers[0].speaker).toBe('unknown');
  const repeatedQuestion = {
    ...wire,
    questions: [
      {
        ...wire.questions[0],
        answers: [{ ...wire.questions[0].answers[0], utteranceRole: 'question' }],
      },
    ],
  };
  expect(validateReferenceChunk(repeatedQuestion, input, units, 0)[0].answers).toEqual([]);
  const ambiguous = {
    ...wire,
    questions: [
      {
        ...wire.questions[0],
        answers: [{ ...wire.questions[0].answers[0], association: 'ambiguous' }],
      },
    ],
  };
  expect(validateReferenceChunk(ambiguous, input, units, 0)[0]).toMatchObject({
    status: 'evidence_found',
    answers: [],
  });
  const partial = {
    ...wire,
    questions: [{ ...wire.questions[0], questionSufficiency: 'partial' }],
  };
  expect(validateReferenceChunk(partial, input, units, 0)[0]).toMatchObject({
    status: 'indeterminate',
    answers: [],
  });
  expect(() =>
    validateReferenceChunk(
      {
        ...wire,
        questions: [
          {
            ...wire.questions[0],
            answers: [{ ...wire.questions[0].answers[0], refs: [units[0].ref] }],
          },
        ],
      },
      input,
      units,
      0,
    ),
  ).toThrow();
  expect(() =>
    validateReferenceChunk({ ...wire, appointmentId: 'foreign' }, input, units, 0),
  ).toThrow();
  expect(() =>
    validateReferenceChunk(
      { ...wire, questions: [{ ...wire.questions[0], questionRefs: ['foreign'] }] },
      input,
      units,
      0,
    ),
  ).toThrow();
});

it('allows prior evidence only for the same question and never as a new answer', () => {
  const input = recapInput('질문? 답변.');
  const units = recapUnits(input);
  const prior = [
    {
      questionId: 'question-1',
      status: 'evidence_found' as const,
      questionEvidence: [resolveRecapUnit(input, units, units[0].ref)],
      answers: [],
    },
  ];
  const wire = {
    recordingSourceId: input.recordingSourceId,
    appointmentId: input.appointmentId,
    chunkIndex: 1,
    questions: [
      {
        questionId: 'question-1',
        status: 'evidence_found',
        questionSufficiency: 'complete',
        questionRefs: [units[0].ref],
        answers: [
          {
            refs: [units[1].ref],
            utteranceRole: 'response',
            association: 'clear',
            summary: '답변',
            inferredRole: 'uncertain',
            speakerUncertainty: '확인 불가',
          },
        ],
      },
    ],
  };
  expect(
    validateReferenceChunk(wire, input, [units[1]], 1, prior, units)[0].answers[0].quotation,
  ).toBe(units[1].text);
  const bad = {
    ...wire,
    questions: [
      {
        ...wire.questions[0],
        answers: [{ ...wire.questions[0].answers[0], refs: [units[0].ref] }],
      },
    ],
  };
  expect(() => validateReferenceChunk(bad, input, [units[1]], 1, prior, units)).toThrow();
  const overlappingChunk = {
    ...wire,
    questions: [
      {
        ...wire.questions[0],
        questionRefs: [units[1].ref],
        answers: [{ ...wire.questions[0].answers[0], refs: [units[0].ref] }],
      },
    ],
  };
  expect(() => validateReferenceChunk(overlappingChunk, input, units, 1, prior, units)).toThrow(
    'Question and answer evidence overlap.',
  );
  const previousWithAnswer = [
    {
      ...prior[0],
      answers: [
        {
          quotation: units[1].text,
          summary: '응답',
          speaker: 'unknown' as const,
          inferredRole: 'uncertain' as const,
          speakerUncertainty: '확인 불가',
          evidence: [resolveRecapUnit(input, units, units[1].ref)],
        },
      ],
    },
  ];
  const laterQuestion = {
    ...wire,
    questions: [{ ...wire.questions[0], questionRefs: [units[1].ref], answers: [] }],
  };
  expect(() =>
    validateReferenceChunk(laterQuestion, input, units, 1, previousWithAnswer, units),
  ).toThrow('Question and answer evidence overlap.');
});
