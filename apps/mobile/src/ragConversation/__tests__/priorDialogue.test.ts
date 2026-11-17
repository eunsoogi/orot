import { priorDialogue } from '../priorDialogue';

test('preserves full provider dialogue and ignores malformed turns', () => {
  expect(priorDialogue(null)).toEqual([]);
  expect(priorDialogue({ priorDialogue: 'invalid' })).toEqual([]);
  const turns = [
    { question: 'earliest', answer: 'retained' },
    { question: 'q'.repeat(1001), answer: 'a'.repeat(1001) },
    { question: 1, answer: 'invalid' },
    { question: 'valid', answer: 'answer' },
    null,
  ];
  expect(priorDialogue({ priorDialogue: turns })).toEqual([
    { question: 'earliest', answer: 'retained' },
    { question: 'q'.repeat(1001), answer: 'a'.repeat(1001) },
    { question: 'valid', answer: 'answer' },
  ]);
});
