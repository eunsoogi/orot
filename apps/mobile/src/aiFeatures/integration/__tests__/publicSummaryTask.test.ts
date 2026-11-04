import { publicSummaryTask } from '../publicSummaryTask';
import { symptomSummaryTask } from '../../../diseaseHypotheses/symptomSummaryTask';
import { evidence } from '../../../diseaseHypotheses/taskTestSupport';

test('preserves factual record instructions and distinguishes web explanations from papers', () => {
  const task = publicSummaryTask(symptomSummaryTask);
  expect(task.requiredToolEvidenceKinds).toEqual(
    symptomSummaryTask.requiredToolEvidenceKinds,
  );
  expect(task.systemPrompt).toContain('model-generated explanation');
  expect(task.systemPrompt).toContain('not an original publication');
  expect(task.systemPrompt).not.toContain(
    'Cite only retrieved publications for medical context',
  );
  const messages = task.createMessages({ request: '건강 요약', evidence });
  expect(
    messages.some(
      message =>
        message.role === 'system' &&
        typeof message.content === 'string' &&
        message.content.includes('never as an original paper'),
    ),
  ).toBe(true);
});
