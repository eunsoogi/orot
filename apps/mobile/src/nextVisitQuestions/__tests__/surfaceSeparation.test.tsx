import { render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { createNextVisitQuestionsTheme } from '../../aiFeatures/integration/nextVisitQuestionsRoutePresentation';
import { NextVisitQuestionsScreen } from '../NextVisitQuestionsScreen';
import { appointment, makeProps, questions } from '../testSupport/fixtures';

test.each([false, true])(
  'separates the page from appointment and saved-question cards (dark: %s)',
  async dark => {
    const theme = createNextVisitQuestionsTheme(dark);
    const view = await render(
      <NextVisitQuestionsScreen
        {...makeProps({
          theme,
          savedQuestions: {
            status: 'ready',
            appointmentId: appointment.id,
            questions,
            caveats: [],
          },
        })}
      />,
    );
    const canvas = StyleSheet.flatten(
      view.getByTestId('next-visit-questions-scroll').props
        .contentContainerStyle,
    ).backgroundColor;
    const question = StyleSheet.flatten(
      view.getByTestId('next-visit-question-0').props.style,
    ).backgroundColor;
    const appointmentCard = StyleSheet.flatten(
      view.getByTestId('next-visit-appointment-time').parent?.parent?.props
        .style,
    ).backgroundColor;
    expect(question).toBeDefined();
    expect(appointmentCard).toBeDefined();
    expect([question, appointmentCard]).not.toContain(canvas);
  },
);
