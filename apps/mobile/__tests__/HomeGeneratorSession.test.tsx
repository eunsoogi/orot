import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react-native';
import { Alert } from 'react-native';
import {
  enterHomeGenerator,
  futureHomeVisit,
  generateHomeDraft,
  renderHomeGenerator,
} from '../test-helpers/homeGeneratorHarness';
import { readyQuestions } from '../src/aiFeatures/integration/testSupport/visitQuestionsRetentionFixtures';
import type { VisitQuestionRouteGeneration } from '../src/aiFeatures/integration/visitQuestionsRouteOperations';

afterEach(() => jest.restoreAllMocks());

test('provider and source detours retain A, while a new Home B entry and the AI hub never expose its draft', async () => {
  const a = futureHomeVisit('Home A');
  const b = futureHomeVisit('Home B');
  const { store, query } = await renderHomeGenerator([a, b]);
  jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
    buttons?.find(button => button.style === 'destructive')?.onPress?.();
  });
  await enterHomeGenerator();
  await fireEvent.press(screen.getByTestId('next-visit-provider-select'));
  expect(await screen.findByTestId('provider-selection-screen')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('navigation-back'));
  expect(await screen.findByText('Home A')).toBeTruthy();
  await generateHomeDraft();
  await fireEvent.changeText(
    screen.getByTestId('next-visit-question-text-0'),
    'A만의 검토 초안',
  );
  await fireEvent.press(screen.getByTestId('next-visit-source-0-0'));
  expect(await screen.findByTestId('ai-feature-source-detail')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('navigation-back'));
  expect(
    await screen.findByTestId('next-visit-question-text-0'),
  ).toHaveDisplayValue('A만의 검토 초안');
  await store.repository.cancel(a.id);
  query.mockResolvedValue(b);
  await fireEvent.press(screen.getByTestId('navigation-back'));
  expect(await screen.findByText('Home B')).toBeTruthy();
  await enterHomeGenerator();
  expect(screen.queryByDisplayValue('A만의 검토 초안')).toBeNull();
  const inputB = await generateHomeDraft();
  expect(inputB.props.value).toMatch(/^Home B:/);
  await fireEvent.press(screen.getByTestId('navigation-back'));
  await fireEvent.press(screen.getByTestId('navigation-tab-ai'));
  const entryPage = screen.getByTestId('ai-features-screen');
  expect(entryPage.type).toBe('RCTScrollView');
  expect(
    entryPage.queryAll(node => node.type === 'RCTScrollView'),
  ).toHaveLength(0);
  expect(
    within(entryPage).getByTestId('ai-feature-visit-questions'),
  ).toBeTruthy();
  await fireEvent.press(screen.getByTestId('ai-feature-visit-questions'));
  expect(await screen.findByTestId('next-visit-generate')).toBeEnabled();
  expect(screen.queryByTestId('next-visit-question-text-0')).toBeNull();
  expect(screen.queryByDisplayValue('A만의 검토 초안')).toBeNull();
});

test('a late task from Home A cannot publish into a new Home B session', async () => {
  const a = futureHomeVisit('Home A');
  const b = futureHomeVisit('Home B');
  const { store, query, generate } = await renderHomeGenerator([a, b]);
  let finish!: (value: VisitQuestionRouteGeneration) => void;
  const pending = new Promise<VisitQuestionRouteGeneration>(resolve => {
    finish = resolve;
  });
  generate.mockImplementationOnce(() => pending);
  await enterHomeGenerator();
  await fireEvent.press(screen.getByTestId('next-visit-generate'));
  await waitFor(() => expect(generate).toHaveBeenCalledTimes(1));
  const signal = generate.mock.calls[0]![0].signal;
  await store.repository.cancel(a.id);
  query.mockResolvedValue(b);
  await fireEvent.press(screen.getByTestId('navigation-back'));
  expect(await screen.findByText('Home B')).toBeTruthy();
  await enterHomeGenerator();
  expect(signal.aborted).toBe(true);
  await act(async () => {
    finish(readyQuestions());
  });
  expect(screen.queryByTestId('next-visit-question-text-0')).toBeNull();
  expect(screen.getByTestId('next-visit-generate')).toBeEnabled();
});
