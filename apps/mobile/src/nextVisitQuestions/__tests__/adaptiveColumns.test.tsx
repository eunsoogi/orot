import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet, View } from 'react-native';
import { NextVisitQuestionsScreen } from '../NextVisitQuestionsScreen';
import { makeProps } from '../testSupport/fixtures';

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
  await render(<NextVisitQuestionsScreen {...props} />);

  const columns = screen.getByTestId('next-visit-question-columns');
  const host = screen.getByTestId('next-visit-question-columns-host');
  await fireEvent.press(screen.getByTestId('next-visit-generate'));
  const question = await screen.findByTestId('next-visit-question-text-0');
  await fireEvent.changeText(question, 'edited visit question');
  setWindowBounds('next-visit-question-columns-host', 24, 1400);
  await fireEvent(host, 'layout', {
    nativeEvent: { layout: { width: 1400, height: 600, x: 0, y: 0 } },
  });

  expect(StyleSheet.flatten(columns.props.style)?.flexDirection).toBe('row');
  expect(question.props.value).toBe('edited visit question');
  expect(props.onGenerate).toHaveBeenCalledTimes(1);

  setWindowBounds('next-visit-question-columns-host', 24, 1200);
  await fireEvent(host, 'layout', {
    nativeEvent: { layout: { width: 1200, height: 600, x: 0, y: 0 } },
  });
  expect(StyleSheet.flatten(columns.props.style)?.flexDirection).toBe('column');
  expect(question.props.value).toBe('edited visit question');
  expect(props.onGenerate).toHaveBeenCalledTimes(1);
});
