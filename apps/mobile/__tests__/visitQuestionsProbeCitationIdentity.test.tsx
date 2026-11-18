import { render, screen } from '@testing-library/react-native';
import { syntheticCitationTestID } from '../e2e/visitQuestionsProbeCitationIdentity';
import {
  createPreparedContext,
  createSyntheticProvider,
  createVisitQuestionsProbeMetrics,
} from '../e2e/visitQuestionsProbe';
import { runVisitQuestionWorkflow } from '../src/agent/visitQuestions/workflow';
import { selectedOption } from '../src/agent/visitQuestions/testing/workflowFixtures';
import { VisitQuestionReview } from '../src/agent/visitQuestions/VisitQuestionReview';

async function preparedQuestions() {
  const { selection, option } = selectedOption(
    createSyntheticProvider(createVisitQuestionsProbeMetrics()),
    'on-device',
  );
  const result = await runVisitQuestionWorkflow({
    prepared: createPreparedContext(),
    selection,
    providerOptions: [option],
  });
  if (result.status !== 'ready')
    throw new Error('Synthetic review did not complete');
  return result.questions;
}

test('exact synthetic question and evidence identity survives order changes but is not inherited by a replacement', async () => {
  const questions = await preparedQuestions();
  const third = questions[2]!;
  const citation = third.citations[0]!;
  expect(syntheticCitationTestID(third, citation)).toBe(
    'visit-question-probe-citation-third',
  );
  for (const changed of [
    { ...citation, sourceId: 'replacement' },
    { ...citation, evidenceId: 'replacement' },
    { ...citation, content: 'replacement' },
    { ...citation, sourceRevision: 'replacement' },
    { ...citation, evidenceRevision: 'replacement' },
  ])
    expect(syntheticCitationTestID(third, changed)).toBeUndefined();
  expect(
    syntheticCitationTestID(
      { ...third, questionText: 'replacement' },
      citation,
    ),
  ).toBeUndefined();
  expect(
    questions
      .slice()
      .reverse()
      .map(question =>
        syntheticCitationTestID(question, question.citations[0]!),
      ),
  ).toEqual([
    'visit-question-probe-citation-third',
    'visit-question-probe-citation-second',
    'visit-question-probe-citation-first',
  ]);
});

test('the real citation text carries the opt-in ID and removing the original third question removes that target', async () => {
  const questions = await preparedQuestions();
  const view = (items: typeof questions, identified = true) => (
    <VisitQuestionReview
      appointmentLabel="Synthetic visit"
      questions={items}
      citationTestID={identified ? syntheticCitationTestID : undefined}
      onConfirm={() => {}}
    />
  );
  const result = await render(view(questions));
  expect(
    screen.getByTestId('visit-question-probe-citation-third').props.children,
  ).toBe('이 프로브에만 쓰는 합성 검사 기록입니다.');
  await result.rerender(view(questions.slice().reverse()));
  expect(
    screen.getByTestId('visit-question-probe-citation-third'),
  ).toBeTruthy();
  await result.rerender(
    view([
      questions[0]!,
      questions[1]!,
      { ...questions[0]!, questionText: 'Replacement fourth question' },
    ]),
  );
  expect(
    screen.queryByTestId('visit-question-probe-citation-third'),
  ).toBeNull();
  await result.rerender(view(questions, false));
  expect(
    screen.queryByTestId('visit-question-probe-citation-third'),
  ).toBeNull();
  expect(
    screen.getAllByText('이 프로브에만 쓰는 합성 검사 기록입니다.'),
  ).toHaveLength(3);
});
