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
        questionRefs: [units[0].ref],
        answers: [
          {
            refs: [units[1].ref],
            summary: '그대로 복용하라는 응답',
            inferredRole: 'uncertain',
            speakerUncertainty: '발화자 미확인',
          },
        ],
      },
    ],
  };
  const result = validateReferenceChunk(wire, input, units, 0);
  expect(result[0].answers[0].quotation).toBe(units[1].text);
  expect(result[0].answers[0].speaker).toBe('unknown');
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
        questionRefs: [units[0].ref],
        answers: [
          {
            refs: [units[1].ref],
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
