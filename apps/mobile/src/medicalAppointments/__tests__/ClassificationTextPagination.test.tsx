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
      nativeEvent: { layout: { width: 272, height: 360 } },
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
        nativeEvent: { lines: text.split('\n').map(value => line(value, 22)) },
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
        nativeEvent: { lines: text.split('\n').map(value => line(value, 22)) },
      },
    );
    expect(screen.getByTestId('classification-page-text')).toHaveTextContent(
      'reason two\nreason three',
    );
    await fireEvent.press(screen.getByTestId('medical-appointment-import'));
    expect(onAction).toHaveBeenCalledTimes(1);
  },
);

test('drops only empty pages formed by native paragraph spacers', () => {
  const lines = [line('Title\n'), line('\n'), line('Coverage'), line(' \t\n')];
  expect(paginateClassificationLines(lines, 60)).toEqual(['Title', 'Coverage']);
  expect(paginateClassificationLines(lines.slice(0, 3), 180)).toEqual([
    'Title\n\nCoverage',
  ]);
  expect(paginateClassificationLines([line(' \t\n')], 60)).toEqual([]);
});

test('moves directly over wide-XXXL paragraph spacers in both directions', async () => {
  const title = '합성 긴 진료 예약 30';
  const coverage = '분류 근거와 일정 범위';
  const onAction = jest.fn();
  await render(
    <ClassificationPagedStage
      documents={[`${title}\n\n${coverage}`, '두 번째 결과']}
      testID="medical-appointment-results"
      actionTitle="다시"
      actionLabel="다시 분류하기"
      onAction={onAction}
    />,
  );
  await fireEvent(screen.getByTestId('medical-appointment-results'), 'layout', {
    nativeEvent: { layout: { width: 678, height: 400 } },
  });
  await fireEvent(screen.getByTestId('classification-stage-footer'), 'layout', {
    nativeEvent: { layout: { height: 44 } },
  });
  const measure = (texts: readonly string[]) =>
    fireEvent(
      screen.getByTestId('classification-text-measurement', {
        includeHiddenElements: true,
      }),
      'textLayout',
      { nativeEvent: { lines: texts.map(text => line(text)) } },
    );
  const page = () => screen.getByTestId('classification-page-text');
  const next = () => screen.getByTestId('medical-appointment-next-result');
  const previous = () =>
    screen.getByTestId('medical-appointment-previous-result');

  await measure([`${title}\n`, '\n', coverage]);
  expect(page()).toHaveTextContent(title);
  expect(previous()).toBeDisabled();
  await fireEvent.press(next());
  expect(page()).toHaveTextContent(coverage);
  await fireEvent.press(previous());
  expect(page()).toHaveTextContent(title);
  await fireEvent.press(next());
  await fireEvent.press(next());
  await measure(['\n']);
  expect(page()).toHaveTextContent('두 번째 결과');
  expect(next()).toBeDisabled();
  await fireEvent.press(previous());
  await measure([`${title}\n`, '\n', coverage]);
  expect(page()).toHaveTextContent(coverage);
  await fireEvent.press(screen.getByTestId('medical-appointment-import'));
  expect(onAction).toHaveBeenCalledTimes(1);
});
