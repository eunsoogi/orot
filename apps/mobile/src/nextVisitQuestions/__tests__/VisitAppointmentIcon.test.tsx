import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';
import { View } from 'react-native';
import { InlineVisitQuestionCard } from '../InlineVisitQuestionCard';
import { VisitAppointmentCard } from '../VisitContextCards';
import { formatNextVisitTime } from '../format';
import { createInlineVisitReview } from '../inlineVisitReview';
import { appointment, questions, theme } from '../testSupport/fixtures';

jest.mock('../../layout/AppSymbol', () => {
  const { View: SymbolHost } = jest.requireActual('react-native');
  return {
    AppSymbol: ({ name }: { name: string }) => (
      <SymbolHost testID={`legacy-symbol-${name}`} />
    ),
  };
});

test.each([
  ['compact', 320],
  ['Duo', 620],
] as const)(
  'keeps one decorative calendar in the %s appointment row and saves the selected question',
  async (_layout, width) => {
    const onSave = jest.fn(async () => undefined);
    const layout = await render(
      <View style={{ width }}>
        <InlineVisitQuestionCard
          state={createInlineVisitReview(
            'fixture-turn',
            [questions[0]!],
            [],
            [],
            () => 'fixture-question',
          )}
          appointment={appointment}
          onChange={jest.fn()}
          onSave={onSave}
          onOpenSource={jest.fn()}
          theme={theme}
          isSaving={false}
        />
      </View>,
    );
    const slot = screen.getByTestId('next-visit-appointment-icon', {
      includeHiddenElements: true,
    });
    expect(slot).toHaveStyle({
      width: 40,
      height: 40,
      alignItems: 'center',
      justifyContent: 'center',
    });
    expect(
      within(slot).getByTestId('next-visit-appointment-calendar', {
        includeHiddenElements: true,
      }),
    ).toBeTruthy();
    expect(
      layout.getAllByTestId('next-visit-appointment-calendar', {
        includeHiddenElements: true,
      }),
    ).toHaveLength(1);
    expect(
      layout.queryByTestId('legacy-symbol-calendar', {
        includeHiddenElements: true,
      }),
    ).toBeNull();
    expect(screen.getByText(appointment.clinicLabel!)).toBeVisible();
    expect(
      screen.getByText(formatNextVisitTime(appointment)!.label),
    ).toBeVisible();
    await fireEvent.press(screen.getByTestId('inline-visit-save'));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ questions: [questions[0]!] }),
    );
  },
);

test('uses the same single leading calendar on the standalone card', async () => {
  await render(
    <VisitAppointmentCard appointment={appointment} theme={theme} />,
  );
  const slot = screen.getByTestId('next-visit-appointment-icon', {
    includeHiddenElements: true,
  });
  expect(
    within(slot).getByTestId('next-visit-appointment-calendar', {
      includeHiddenElements: true,
    }),
  ).toBeTruthy();
  expect(
    screen.getAllByTestId('next-visit-appointment-calendar', {
      includeHiddenElements: true,
    }),
  ).toHaveLength(1);
});
