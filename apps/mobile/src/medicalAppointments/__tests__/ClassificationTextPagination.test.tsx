import { fireEvent, render, screen } from '@testing-library/react-native';
import { ClassificationPagedStage } from '../ClassificationPagedStage';
import { paginateClassificationLines } from '../classificationTextPagination';

const line = (text: string, height = 60) => ({ text, height });

test('partitions native measured lines without losing a single long title or reason', () => {
  const lines = [
    'title one',
    'title two',
    'date',
    'reason one',
    'reason two',
    'reason three',
  ].map(value => line(value));
  const pages = paginateClassificationLines(lines, 125);
  expect(pages).toEqual([
    'title one\ntitle two',
    'date\nreason one',
    'reason two\nreason three',
  ]);
  expect(pages.join('\n')).toBe(lines.map(value => value.text).join('\n'));
  expect(paginateClassificationLines(lines, 60)).toHaveLength(6);
});

test.each(['medical-appointment-confirmation', 'medical-appointment-results'])(
  'keeps every line and primary action reachable in a small measured %s viewport',
  async testID => {
    const onAction = jest.fn();
    const text =
      'title one\ntitle two\ndate\nreason one\nreason two\nreason three';
    await render(
      <ClassificationPagedStage
        documents={[text, 'Second appointment']}
        testID={testID}
        actionTitle="시작"
        actionLabel="분류 시작"
        onAction={onAction}
      />,
    );
    await fireEvent(screen.getByTestId(testID), 'layout', {
      nativeEvent: { layout: { width: 272, height: 190 } },
    });
    const footer = screen.getByTestId('medical-appointment-import').parent
      ?.parent;
    // The component obtains footer height from its actual native container, not a fixed font assumption.
    expect(footer).toBeTruthy();
    await fireEvent(
      screen.getByTestId('classification-stage-footer'),
      'layout',
      { nativeEvent: { layout: { width: 272, height: 44 } } },
    );
    await fireEvent(
      screen.getByTestId('classification-text-measurement', {
        includeHiddenElements: true,
      }),
      'textLayout',
      {
        nativeEvent: { lines: text.split('\n').map(value => line(value)) },
      },
    );
    expect(screen.getByTestId('classification-page-text')).toHaveTextContent(
      'title one\ntitle two',
    );
    expect(screen.getByTestId('medical-appointment-import')).toBeEnabled();
    await fireEvent.press(
      screen.getByTestId('medical-appointment-next-result'),
    );
    expect(screen.getByTestId('classification-page-text')).toHaveTextContent(
      'date\nreason one',
    );
    await fireEvent.press(
      screen.getByTestId('medical-appointment-next-result'),
    );
    expect(screen.getByTestId('classification-page-text')).toHaveTextContent(
      'reason two\nreason three',
    );
    await fireEvent.press(
      screen.getByTestId('medical-appointment-next-result'),
    );
    expect(screen.getByText('Second appointment')).toBeTruthy();
    await fireEvent.press(
      screen.getByTestId('medical-appointment-previous-result'),
    );
    await fireEvent(
      screen.getByTestId('classification-text-measurement', {
        includeHiddenElements: true,
      }),
      'textLayout',
      {
        nativeEvent: { lines: text.split('\n').map(value => line(value)) },
      },
    );
    expect(screen.getByTestId('classification-page-text')).toHaveTextContent(
      'reason two\nreason three',
    );
    await fireEvent.press(screen.getByTestId('medical-appointment-import'));
    expect(onAction).toHaveBeenCalledTimes(1);
  },
);
