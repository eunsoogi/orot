import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { ConversationSummaryHistory } from '../../../diseaseHypotheses/ConversationSummaryHistory';
import {
  NavigationContentFrameContext,
  type NavigationContentFrame,
} from '../../../navigation/navigationContentFrame';
import { SavedVisitQuestionsRoute } from '../SavedVisitQuestionsRoute';
import { useNextVisitQuestionsRoute } from '../useNextVisitQuestionsRoute';
import type { NextVisitQuestionsRouteProps } from '../NextVisitQuestionsRoute.types';

jest.mock('../useNextVisitQuestionsRoute');

const viewport = { x: 0, y: 0, width: 466, height: 678 };
const frame: NavigationContentFrame = {
  side: 'right',
  windowFrame: viewport,
  viewportFrame: viewport,
  availableContentFrame: { ...viewport, width: 382 },
  reservedRegions: [
    {
      kind: 'occlusion',
      id: 'system-edge',
      frame: { ...viewport, x: 382, width: 84, height: 90 },
      margins: { top: 0, right: 0, bottom: 0, left: 0 },
      isActive: true,
    },
  ],
  navigationFrame: { x: 406, y: 90, width: 48, height: 270 },
};

test.each(['questions', 'summary'] as const)(
  'gives the %s page physical edge width only when its own pane fills the scene',
  async page => {
    jest.mocked(useNextVisitQuestionsRoute).mockReturnValue({
      appointment: { status: 'loading' },
      savedQuestions: { status: 'loading' },
      refreshAppointment: jest.fn(),
      onOpenSource: jest.fn(),
      onRetrySavedQuestions: jest.fn(),
    } as unknown as ReturnType<typeof useNextVisitQuestionsRoute>);
    const isQuestions = page === 'questions';
    const id = isQuestions
      ? 'saved-visit-questions-screen'
      : 'summary-history-screen';
    await render(
      <NavigationContentFrameContext.Provider value={frame}>
        {isQuestions ? (
          <SavedVisitQuestionsRoute {...({} as NextVisitQuestionsRouteProps)} />
        ) : (
          <ConversationSummaryHistory onOpenSource={jest.fn()} />
        )}
      </NavigationContentFrameContext.Provider>,
    );
    const scroll = () => screen.getByTestId(id);
    const host = () => screen.getByTestId(id + '-host');
    expect(scroll().props.scrollIndicatorInsets).toBeUndefined();

    const measure = (width: number) =>
      fireEvent(host(), 'layout', { nativeEvent: { layout: { width } } });

    await measure(382);
    expect(StyleSheet.flatten(scroll().props.style).marginRight).toBe(-84);
    expect(
      StyleSheet.flatten(scroll().props.contentContainerStyle),
    ).toMatchObject({
      paddingRight: 84 + (isQuestions ? 0 : 24),
    });
    expect(scroll().props.automaticallyAdjustsScrollIndicatorInsets).toBe(
      false,
    );
    expect(scroll().props.scrollIndicatorInsets).toMatchObject({
      right: 0,
      top: 90,
    });
    expect(within(scroll()).getAllByRole('header').length).toBeGreaterThan(0);

    await measure(290);
    expect(scroll().props.scrollIndicatorInsets).toBeUndefined();
    expect(
      StyleSheet.flatten(scroll().props.style)?.marginRight,
    ).toBeUndefined();
    expect(
      StyleSheet.flatten(scroll().props.contentContainerStyle)?.paddingRight,
    ).toBeUndefined();
  },
);
