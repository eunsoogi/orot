import { recapInput } from './recap-fixtures';
import { recapUnits } from '../src/recap/units';
import { validateReferenceChunk as validateFlatChunk } from '../src/recap/referenceValidation';

function validateReferenceChunk(
  wire: unknown,
  input: Parameters<typeof validateFlatChunk>[1],
  units: Parameters<typeof validateFlatChunk>[2],
  chunk: number,
  previous?: Parameters<typeof validateFlatChunk>[4],
  allUnits?: Parameters<typeof validateFlatChunk>[5],
) {
  return validateFlatChunk(wire, input, units, chunk, previous, allUnits, `request:${chunk}`);
}

it('uses distinct request-scoped question and speech references while retaining exact evidence', () => {
  const input = recapInput('약을... [소음] 질문? 답변.');
  const units = recapUnits(input);
  expect(units.map((unit) => unit.text)).toEqual(['약을...', ' [소음] 질문?', ' 답변.']);
  const wire = {
    requestRef: 'request:0',
    items: [
      { kind: 'question', preparedQuestionRef: 'q0', status: 'evidence_found', speechRefs: ['u1'] },
      {
        kind: 'answer',
        preparedQuestionRef: 'q0',
        speechRefs: ['u2'],
        utteranceRole: 'response',
        association: 'clear',
        summary: '답변',
        inferredRole: 'uncertain',
        speakerUncertainty: '화자 미확인',
      },
    ],
  };
  expect(validateReferenceChunk(wire, input, units, 0)[0].answers[0].quotation).toBe(' 답변.');
  expect(() => validateReferenceChunk({ ...wire, requestRef: 'r1' }, input, units, 0)).toThrow();
  expect(() =>
    validateReferenceChunk(
      wire,
      { ...input, segments: [{ ...input.segments[0], revision: 2 }] },
      units,
      0,
    ),
  ).toThrow();
  expect(() =>
    validateReferenceChunk(
      { ...wire, items: [{ ...wire.items[0], speechRefs: ['q0'] }] },
      input,
      units,
      0,
    ),
  ).toThrow();
  expect(() =>
    validateReferenceChunk(
      { ...wire, items: [wire.items[0], { ...wire.items[1], speechRefs: ['u1'] }] },
      input,
      units,
      0,
    ),
  ).toThrow();
});

it('rejects a prior question reference when it belongs to another prepared question', () => {
  const input = recapInput('첫 질문? 다음 답변.');
  input.questions.push({ ...input.questions[0], id: 'question-2', questionText: '다른 질문' });
  const units = recapUnits(input);
  const previous = [
    {
      questionId: 'question-1',
      status: 'evidence_found' as const,
      questionEvidence: [
        {
          segmentId: units[0].segmentId,
          transcriptId: units[0].transcriptId,
          revision: units[0].revision,
          startOffset: units[0].startOffset,
          endOffset: units[0].endOffset,
          quote: units[0].text,
          audioRange: units[0].audioRange,
        },
      ],
      answers: [],
    },
  ];
  const wire = {
    requestRef: 'request:1',
    items: [
      { kind: 'question', preparedQuestionRef: 'q0', status: 'evidence_found', speechRefs: ['u0'] },
      { kind: 'question', preparedQuestionRef: 'q1', status: 'evidence_found', speechRefs: ['u0'] },
    ],
  };
  expect(() => validateReferenceChunk(wire, input, [units[1]], 1, previous, units)).toThrow();
});
