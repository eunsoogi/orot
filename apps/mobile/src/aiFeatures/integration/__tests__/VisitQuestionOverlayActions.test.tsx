import { act, fireEvent, waitFor, within } from '@testing-library/react-native';
import type { VisitQuestionRouteGeneration } from '../visitQuestionsRouteOperations';
import {
  readyQuestions,
  createOperations,
  renderIntegratedRoute,
  startGeneration,
} from '../testSupport/visitQuestionsRetentionFixtures';

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);
// The shared route fixture imports App; native backup startup is unrelated to
// the real AI navigation and question controller exercised here.
jest.mock('../../../backup/backupSupport', () => ({
  prepareBackupSupport: jest.fn(async () => 'ready'),
}));
jest.mock('../../../providers/selection/options', () => {
  const actual = jest.requireActual('../../../providers/selection/options');
  return {
    ...actual,
    loadAppleSelectionOption: jest.fn(async () =>
      actual.createAppleSelectionOption('available'),
    ),
  };
});

// Exercise the real screen and route shell, including hidden-page overlay boundaries.
test.each(['review', 'saved'] as const)(
  'keeps the %s action out of evidence and provider overlays, then restores it on return',
  async phase => {
    let finish!: (outcome: VisitQuestionRouteGeneration) => void;
    const operations = createOperations(
      () =>
        new Promise(resolve => {
          finish = resolve;
        }),
    );
    const route = await renderIntegratedRoute(operations);
    await startGeneration(route);
    await act(async () => {
      finish(readyQuestions());
    });
    await waitFor(() =>
      expect(route.getByTestId('next-visit-question-text-0')).toBeTruthy(),
    );
    if (phase === 'saved') {
      await fireEvent.press(route.getByTestId('next-visit-review-save'));
      await waitFor(() =>
        expect(route.queryByTestId('next-visit-question-text-0')).toBeNull(),
      );
    } else {
      await fireEvent.changeText(
        route.getByTestId('next-visit-question-text-0'),
        '돌아와도 유지할 합성 질문',
      );
    }
    const actionId =
      phase === 'review' ? 'next-visit-review-save' : 'next-visit-saved-edit';
    const bar = () =>
      within(route.getByTestId('navigation-bar-native-surface'));
    expect(bar().queryByTestId(actionId)).toBeNull();
    expect(
      within(route.getByTestId('next-visit-questions-scroll')).getByTestId(
        actionId,
      ),
    ).toBeTruthy();

    await fireEvent.press(route.getByTestId('next-visit-source-0-0'));
    await waitFor(() =>
      expect(route.getByTestId('ai-feature-source-detail')).toBeTruthy(),
    );
    expect(bar().queryByTestId(actionId)).toBeNull();
    expect(route.queryByTestId(actionId)).toBeNull();
    expect(bar().getByTestId('navigation-back')).toBeTruthy();
    expect(bar().getByTestId('navigation-home')).toBeTruthy();
    expect(
      route
        .getByTestId('navigation-bar-native-surface')
        .props.actions.map(
          (action: { readonly testID: string }) => action.testID,
        ),
    ).toEqual(['navigation-back', 'navigation-home']);
    await fireEvent.press(bar().getByTestId('navigation-back'));
    await waitFor(() => expect(route.getByTestId(actionId)).toBeTruthy());
    if (phase === 'review') {
      expect(
        route.getByTestId('next-visit-question-text-0'),
      ).toHaveDisplayValue('돌아와도 유지할 합성 질문');
      await fireEvent.press(route.getByTestId('next-visit-review-cancel'));
    }

    await fireEvent.press(route.getByTestId('next-visit-provider-select'));
    await waitFor(() =>
      expect(route.getByTestId('provider-selection-screen')).toBeTruthy(),
    );
    expect(bar().queryByTestId(actionId)).toBeNull();
    expect(route.queryByTestId(actionId)).toBeNull();
    expect(bar().queryByTestId('next-visit-generate')).toBeNull();
    await waitFor(() =>
      expect(route.getByTestId('provider-option-0')).toBeTruthy(),
    );
    await fireEvent.press(route.getByTestId('provider-option-0'));
    expect(route.getByTestId('provider-selection-confirm')).toBeTruthy();
    // Commit only the synthetic model choice, then check that returning did not
    // regenerate or save the retained review as a side effect of the overlay.
    await fireEvent.press(route.getByTestId('provider-selection-confirm'));
    await waitFor(() =>
      expect(route.queryByTestId('provider-selection-screen')).toBeNull(),
    );
    expect(
      within(route.getByTestId('next-visit-questions-scroll')).getByTestId(
        phase === 'saved' ? 'next-visit-saved-edit' : 'next-visit-generate',
      ),
    ).toBeTruthy();
    expect(operations.generate).toHaveBeenCalledTimes(1);
    expect(operations.save).toHaveBeenCalledTimes(phase === 'saved' ? 1 : 0);
    route.unmount();
  },
);
