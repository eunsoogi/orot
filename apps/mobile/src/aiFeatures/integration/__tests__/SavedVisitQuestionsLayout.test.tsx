import { render, screen, within } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { SavedVisitQuestionsRoute } from '../SavedVisitQuestionsRoute';
import { useNextVisitQuestionsRoute } from '../useNextVisitQuestionsRoute';
import type { NextVisitQuestionsRouteProps } from '../NextVisitQuestionsRoute.types';

jest.mock('../useNextVisitQuestionsRoute');
jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

const route = jest.mocked(useNextVisitQuestionsRoute);

/** The hook is the state boundary; no provider, credential or storage operation is performed. */
test('retains the padded title and single scroll through appointment loading, absence and retry error', async () => {
  const refreshAppointment = jest.fn();
  const state = {
    appointment: { status: 'loading' },
    savedQuestions: { status: 'loading' },
    refreshAppointment,
    onOpenSource: jest.fn(),
    onRetrySavedQuestions: jest.fn(),
  };
  route.mockReturnValue(
    state as unknown as ReturnType<typeof useNextVisitQuestionsRoute>,
  );
  const props = {} as NextVisitQuestionsRouteProps;
  const view = await render(<SavedVisitQuestionsRoute {...props} />);
  const content = screen.getByTestId('saved-visit-questions-content');
  expect(StyleSheet.flatten(content.props.style)).toMatchObject({
    paddingHorizontal: 24,
    paddingTop: 20,
    gap: 20,
  });
  expect(
    within(content).getByTestId('saved-visit-questions-title').props
      .accessibilityRole,
  ).toBe('header');
  expect(
    screen.getByTestId('saved-visit-appointment-state').props
      .accessibilityState,
  ).toEqual({ busy: true });
  expect(screen.getByText('다음 예약을 확인하고 있어요.')).toBeTruthy();
  expect(
    within(screen.getByTestId('saved-visit-questions-screen')).getByTestId(
      'saved-visit-questions-content',
    ),
  ).toBe(content);

  route.mockReturnValue({
    ...state,
    appointment: { status: 'empty' },
  } as unknown as ReturnType<typeof useNextVisitQuestionsRoute>);
  await view.rerender(<SavedVisitQuestionsRoute {...props} />);
  expect(
    screen.getByTestId('saved-visit-appointment-state').props
      .accessibilityState,
  ).toEqual({ busy: false });
  expect(screen.queryByText('다음 예약을 확인하고 있어요.')).toBeNull();
  expect(screen.getByTestId('next-visit-appointment-retry')).toBeTruthy();

  route.mockReturnValue({
    ...state,
    appointment: { status: 'error', message: '합성 불러오기 오류' },
  } as unknown as ReturnType<typeof useNextVisitQuestionsRoute>);
  await view.rerender(<SavedVisitQuestionsRoute {...props} />);
  expect(
    within(screen.getByTestId('saved-visit-questions-content')).getByText(
      '합성 불러오기 오류',
    ),
  ).toBeTruthy();
  expect(screen.getByTestId('saved-visit-questions-title')).toBeTruthy();
  expect(screen.queryByTestId('next-visit-generate')).toBeNull();
  expect(screen.queryByTestId('next-visit-saved-edit')).toBeNull();
});
