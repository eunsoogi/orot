import { symptomSummaryTask } from '../symptomSummaryTask';

test('opts into only the observed citations-array shape repair with current-source guidance', () => {
  const repair = symptomSummaryTask.correctionInstructionForInvalidEnvelope;
  expect(
    repair?.('The task responder returned an invalid envelope: citations.'),
  ).toContain('array of exact supplied evidence IDs');
  expect(
    repair?.('The task responder returned an invalid envelope: json.'),
  ).toBeUndefined();
  expect(
    repair?.('The task responder returned an invalid envelope: fields.'),
  ).toBeUndefined();
});
