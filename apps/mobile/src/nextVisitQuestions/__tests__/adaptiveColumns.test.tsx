import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';
import { StyleSheet, View } from 'react-native';
import { NextVisitQuestionsScreen } from '../NextVisitQuestionsScreen';
import { appointment, makeProps, source } from '../testSupport/fixtures';

const measurableView = View as unknown as {
  prototype: {
    measureInWindow: (
      callback: (x: number, y: number, width: number, height: number) => void,
    ) => void;
  };
};
const windowBounds = new Map<
  string,
  { readonly x: number; readonly width: number }
>();

beforeEach(() => windowBounds.clear());

jest
  .spyOn(measurableView.prototype, 'measureInWindow')
  .mockImplementation(function (
    this: { readonly props: { readonly testID?: string } },
    callback,
  ) {
    const bounds = windowBounds.get(this.props.testID ?? '');
    if (bounds) callback(bounds.x, 0, bounds.width, 600);
  });

function setWindowBounds(testID: string, x: number, width: number) {
  windowBounds.set(testID, { x, width });
}

test('reflows the active question editor without replaying generation', async () => {
  const props = makeProps();
  const evidenceExcerpt = source.content ?? '';
  const appointmentLabel = appointment.clinicLabel ?? '';
  expect(evidenceExcerpt).not.toBe('');
  expect(appointmentLabel).not.toBe('');
  await render(<NextVisitQuestionsScreen {...props} />);

  const columns = screen.getByTestId('next-visit-question-columns');
  const host = screen.getByTestId('next-visit-question-columns-host');
  await fireEvent.press(screen.getByTestId('next-visit-generate'));
  const question = await screen.findByTestId('next-visit-question-text-0');
  await fireEvent.changeText(question, 'edited visit question');
  await fireEvent.press(screen.getByTestId('next-visit-source-0-0'));
  expect(screen.getByTestId('next-visit-source-content')).toHaveTextContent(
    evidenceExcerpt,
  );

  const expectRetainedState = () => {
    // A Duo division must not separate the page heading from its measured primary content panel.
    expect(
      within(
        screen.getByTestId('next-visit-question-columns-primary'),
      ).getByTestId('next-visit-title'),
    ).toBeTruthy();
    expect(screen.getByText(appointmentLabel)).toBeTruthy();
    expect(screen.getByTestId('next-visit-question-text-0').props.value).toBe(
      'edited visit question',
    );
    expect(screen.getByTestId('next-visit-source-content')).toHaveTextContent(
      evidenceExcerpt,
    );
    expect(props.onGenerate).toHaveBeenCalledTimes(1);
    expect(props.onGenerate).toHaveBeenCalledWith(
      appointment,
      { providerId: 'synthetic-provider', modelId: 'fixture-model' },
      expect.any(AbortSignal),
      expect.objectContaining({
        onProgress: expect.any(Function),
        onTaskStreamEvent: expect.any(Function),
      }),
    );
  };

  setWindowBounds('next-visit-question-columns-host', 24, 1400);
  await fireEvent(host, 'layout', {
    nativeEvent: { layout: { width: 1400, height: 600, x: 0, y: 0 } },
  });

  expect(StyleSheet.flatten(columns.props.style)?.flexDirection).toBe('row');
  expectRetainedState();

  setWindowBounds('next-visit-question-columns-host', 24, 1200);
  await fireEvent(host, 'layout', {
    nativeEvent: { layout: { width: 1200, height: 600, x: 0, y: 0 } },
  });
  expect(StyleSheet.flatten(columns.props.style)?.flexDirection).toBe('column');
  expectRetainedState();
});
