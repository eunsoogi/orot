import { symptomSummaryTask } from '../../../diseaseHypotheses/symptomSummaryTask';
import { diseaseHypothesisTask } from '../../../diseaseHypotheses/task';
import { ragConversationTask } from '../../../ragConversation/task';
import { createAppointmentClassificationTask } from '../../../medicalAppointments/classificationTask';
import { visitQuestionSystemPrompt } from '../../../agent/visitQuestions/taskPrompt';

test.each([
  ['symptom summary', symptomSummaryTask.systemPrompt],
  ['disease review', diseaseHypothesisTask.systemPrompt],
  ['conversation', ragConversationTask.systemPrompt],
  [
    'calendar classification',
    createAppointmentClassificationTask([]).systemPrompt,
  ],
  ['visit questions', visitQuestionSystemPrompt],
])(
  '%s uses English system instructions and explicitly requests Korean output',
  (_name, prompt) => {
    expect(prompt).not.toMatch(/[가-힣]/u);
    expect(prompt).toMatch(/Korean/);
  },
);
