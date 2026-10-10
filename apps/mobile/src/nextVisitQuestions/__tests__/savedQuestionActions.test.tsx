import { fireEvent, render, screen } from '@testing-library/react-native';
import { Button } from 'react-native';
import {
  NavigationPrimaryActionContext,
  useNavigationPrimaryActionHost,
} from '../../navigation/useNavigationPrimaryAction';
import { NextVisitQuestionsScreen } from '../NextVisitQuestionsScreen';
import { createNextVisitQuestionsTheme } from '../../aiFeatures/integration/nextVisitQuestionsRoutePresentation';
import {
  appointment,
  makeProps,
  questions,
  type Props,
} from '../testSupport/fixtures';

function Route({ props }: { readonly props: Props }) {
  const { host, action } = useNavigationPrimaryActionHost('questions');
  return (
    <NavigationPrimaryActionContext.Provider value={host}>
      <NextVisitQuestionsScreen {...props} />
      {action ? (
        <Button
          testID={action.testID}
          title={action.label}
          disabled={action.disabled}
          onPress={action.onPress}
        />
      ) : null}
    </NavigationPrimaryActionContext.Provider>
  );
}

test('edits saved questions through one shell action even while the provider is unavailable', async () => {
  const props = makeProps({
    onSaveReviewedQuestions: jest.fn(async (_visit, reviewed, caveats) => ({
      questions: reviewed,
      caveats,
      memoryStatus: 'saved' as const,
    })),
    provider: { status: 'unselected', selection: null },
    savedQuestions: {
      status: 'ready',
      appointmentId: appointment.id,
      questions,
      caveats: ['incomplete_coverage', 'conflicting_records'],
    },
  });
  await render(<Route props={props} />);
  expect(screen.getAllByTestId('next-visit-saved-edit')).toHaveLength(1);
  expect(screen.getByTestId('next-visit-generate')).toBeDisabled();
  expect(screen.getAllByTestId('next-visit-caveats')).toHaveLength(1);
  expect(
    screen.getByTestId('next-visit-caveat-incomplete_coverage'),
  ).toBeTruthy();
  expect(
    screen.getByTestId('next-visit-caveat-conflicting_records'),
  ).toBeTruthy();
  await fireEvent.press(screen.getByTestId('next-visit-saved-edit'));
  expect(screen.getByTestId('next-visit-title')).toHaveTextContent('질문 편집');
  expect(screen.getByText('합성 진료 예약')).toBeTruthy();
  expect(screen.queryByTestId('next-visit-provider')).toBeNull();
  expect(screen.getAllByTestId('next-visit-review-save')).toHaveLength(1);
  await fireEvent.press(screen.getByTestId('next-visit-question-priority-0'));
  expect(
    screen.getByTestId('next-visit-question-priority-0').props
      .accessibilityState.checked,
  ).toBe(true);
  await fireEvent.press(screen.getByTestId('next-visit-review-save'));
  expect(props.onSaveReviewedQuestions).toHaveBeenCalledWith(
    appointment,
    [{ ...questions[0], priority: 'important' }, ...questions.slice(1)],
    ['incomplete_coverage', 'conflicting_records'],
  );
  expect(props.onGenerate).not.toHaveBeenCalled();
});

test('retains the edited draft when appearance changes remount native text inputs', async () => {
  const props = makeProps({ theme: createNextVisitQuestionsTheme(true) });
  const view = await render(<Route props={props} />);
  await fireEvent.press(screen.getByTestId('next-visit-generate'));
  await fireEvent.changeText(
    screen.getByTestId('next-visit-question-text-0'),
    '외형을 바꿔도 남는 질문',
  );
  await view.rerender(
    <Route props={{ ...props, theme: createNextVisitQuestionsTheme(false) }} />,
  );
  expect(screen.getByTestId('next-visit-question-text-0').props.value).toBe(
    '외형을 바꿔도 남는 질문',
  );
  expect(screen.getByTestId('next-visit-review-save')).not.toBeDisabled();
  expect(
    screen.getByTestId('next-visit-caveat-conflicting_records'),
  ).toBeTruthy();
});
