import { priorDialogue } from '../priorDialogue';

test('bounds provider dialogue and ignores malformed turns', () => {
  expect(priorDialogue(null)).toEqual([]);
  expect(priorDialogue({ priorDialogue: 'invalid' })).toEqual([]);
  const turns = [
    { question: 'excluded', answer: 'excluded' },
    { question: 'q'.repeat(1001), answer: 'a'.repeat(1001) },
    { question: 1, answer: 'invalid' },
    { question: 'valid', answer: 'answer' },
    null,
  ];
  expect(priorDialogue({ priorDialogue: turns })).toEqual([
    { question: 'q'.repeat(1000), answer: 'a'.repeat(1000) },
    { question: 'valid', answer: 'answer' },
  ]);
});
