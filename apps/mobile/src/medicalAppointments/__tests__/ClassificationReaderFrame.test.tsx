import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import { ClassificationPagedStage } from '../ClassificationPagedStage';
import { useClassificationReaderFrame } from '../ClassificationReaderFrame';

test('offers full-window reading rather than overflowing a line into actions', async () => {
  await render(
    <ClassificationPagedStage
      documents={['One large line']}
      testID="stage"
      actionTitle="시작"
      actionLabel="분류 시작"
      onAction={jest.fn()}
    />,
  );
  const measure = async (height: number) => {
    await fireEvent(screen.getByTestId('stage'), 'layout', {
      nativeEvent: { layout: { width: 272, height } },
    });
    await fireEvent(
      screen.getByTestId('classification-stage-footer'),
      'layout',
      { nativeEvent: { layout: { height: 44 } } },
    );
    await fireEvent(
      screen.getByTestId('classification-text-measurement', {
        includeHiddenElements: true,
      }),
      'textLayout',
      {
        nativeEvent: { lines: [{ text: 'One large line', height: 100 }] },
      },
    );
  };
  await measure(110);
  expect(screen.queryByTestId('classification-page-text')).toBeNull();
  expect(screen.getByTestId('medical-appointment-import')).toHaveProp(
    'accessibilityLabel',
    '전체 화면으로 내용 보기',
  );
  await fireEvent.press(screen.getByTestId('medical-appointment-import'));
  expect(screen.getByTestId('classification-close-reader')).toBeEnabled();
  await measure(480);
  expect(screen.getByText('One large line')).toBeTruthy();
  expect(screen.getByTestId('medical-appointment-import')).toBeEnabled();
  // Even a full window that cannot fit a line must not be reported as readable or silently shrink the text.
  await measure(110);
  expect(screen.queryByTestId('classification-page-text')).toBeNull();
  expect(screen.getByTestId('medical-appointment-import')).toBeDisabled();
  expect(screen.getByTestId('medical-appointment-import')).toHaveProp(
    'accessibilityLabel',
    '화면을 세로로 돌리거나 창을 키워 주세요',
  );
  expect(screen.getByTestId('classification-close-reader')).toBeEnabled();
});

let frame!: ReturnType<typeof useClassificationReaderFrame>;
function Harness({
  action,
  documents = ['source'],
}: {
  action: () => void;
  documents?: readonly string[];
}) {
  frame = useClassificationReaderFrame(action, documents);
  return <Text>{frame.expanded ? 'expanded' : 'normal'}</Text>;
}

test('does not start inference until native modal dismissal and dispatches at most once', async () => {
  const action = jest.fn();
  await render(<Harness action={action} />);
  await act(async () => frame.expand());
  await act(async () => {
    frame.execute();
    frame.execute();
  });
  expect(action).not.toHaveBeenCalled();
  expect(frame.closing).toBe(true);
  await act(async () => {
    frame.dismissed();
    frame.dismissed();
  });
  expect(action).toHaveBeenCalledTimes(1);
});

test.each(['cancel', 'unmount', 'action', 'documents'] as const)(
  'revokes queued action after %s',
  async interruption => {
    const action = jest.fn();
    const replacement = jest.fn();
    const view = await render(<Harness action={action} />);
    await act(async () => frame.expand());
    await act(async () => frame.execute());
    const lateDismiss = frame.dismissed;
    if (interruption === 'cancel') await act(async () => frame.close());
    if (interruption === 'unmount') await view.unmount();
    if (interruption === 'action')
      await view.rerender(<Harness action={replacement} />);
    if (interruption === 'documents')
      await view.rerender(
        <Harness action={action} documents={['new source']} />,
      );
    await act(async () => lateDismiss());
    expect(action).not.toHaveBeenCalled();
    expect(replacement).not.toHaveBeenCalled();
  },
);
