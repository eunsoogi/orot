import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import {
  enterHomeGenerator,
  futureHomeVisit,
  generateHomeDraft,
  renderHomeGenerator,
} from '../test-helpers/homeGeneratorHarness';
import { nextVisitQuestionsCopy as copy } from '../src/nextVisitQuestions/copy';

afterEach(() => jest.restoreAllMocks());

test('Home A reaches the editor, obtains real disclosure consent and saves its reviewed questions', async () => {
  const { generate, save } = await renderHomeGenerator(undefined, true);
  await enterHomeGenerator();
  await fireEvent.press(screen.getByTestId('next-visit-generate'));
  expect(await screen.findByTestId('inference-disclosure-sheet')).toBeTruthy();
  expect(save).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByTestId('inference-disclosure-allow'));
  const input = await screen.findByTestId('next-visit-question-text-0');
  await fireEvent.changeText(input, 'Home A: 직접 수정한 질문');
  await fireEvent.press(screen.getByTestId('next-visit-review-save'));
  await waitFor(() => expect(save).toHaveBeenCalled());
  expect(generate.mock.calls[0]?.[0].appointment.id).toBe('Home A');
  expect(save.mock.calls[0]?.[0].appointment.id).toBe('Home A');
  expect(save.mock.calls[0]?.[0].questions[0]?.questionText).toBe(
    'Home A: 직접 수정한 질문',
  );
});

test('an entry lookup changing from displayed A to future B never exposes B or allows generation', async () => {
  const { store, query, generate, save } = await renderHomeGenerator();
  await store.repository.cancel('Home A');
  query.mockResolvedValue(futureHomeVisit('Calendar B'));
  await fireEvent.press(await screen.findByTestId('home-prepare-visit'));
  expect(await screen.findByText(copy.appointment.none)).toBeTruthy();
  expect(screen.queryByText('Calendar B')).toBeNull();
  expect(generate).not.toHaveBeenCalled();
  expect(save).not.toHaveBeenCalled();
});

test('a target change immediately before generation is rejected before model or consent work', async () => {
  const { store, query, generate } = await renderHomeGenerator();
  await enterHomeGenerator();
  await store.repository.cancel('Home A');
  query.mockResolvedValue(futureHomeVisit('Calendar B'));
  await fireEvent.press(screen.getByTestId('next-visit-generate'));
  expect(await screen.findByText(copy.appointment.none)).toBeTruthy();
  expect(generate).not.toHaveBeenCalled();
  expect(screen.queryByTestId('inference-disclosure-sheet')).toBeNull();
});

test('reviewed A cannot be saved after the current query changes to B', async () => {
  const { query, save } = await renderHomeGenerator();
  await enterHomeGenerator();
  await generateHomeDraft();
  query.mockResolvedValue(futureHomeVisit('Calendar B'));
  await fireEvent.press(screen.getByTestId('next-visit-review-save'));
  expect(
    await screen.findByText(
      '예약이나 원문 근거가 바뀌어 저장하지 못했어요. 최신 내용을 확인해 주세요.',
    ),
  ).toBeTruthy();
  expect(save).not.toHaveBeenCalled();
  expect(screen.getByTestId('next-visit-question-text-0')).toBeTruthy();
});
