import { fireEvent, render, screen } from '@testing-library/react-native';
import { DailyReportVisualProbe } from '../e2e/dailyReportVisualProbeEntry';

jest.mock('react-native-get-random-values', () => ({}));

// Replace only the native scene host; report and conversation components remain real.
jest.mock('../src/navigation/NavigationRouteAdapter', () => {
  const React = require('react') as typeof import('react');
  return {
    NavigationRouteAdapter: ({
      controller,
      children,
    }: {
      controller: ReturnType<
        typeof import('../src/navigation/navigationController').createNavigationController
      >;
      children: (actions: unknown) => React.ReactNode;
    }) => {
      const snapshot = React.useSyncExternalStore(
        controller.subscribe,
        controller.getSnapshot,
        controller.getSnapshot,
      );
      return children({
        route: snapshot.currentRoute,
        push: controller.push,
        onBack: controller.requestBack,
      });
    },
  };
});

test('synthetic saved report enters the production conversation with its exact identity', async () => {
  const view = await render(<DailyReportVisualProbe />);
  expect(await screen.findByText('합성 심박수 기록은 72회예요.')).toBeTruthy();
  expect(screen.getByText(/건강 측정: 일부만 포함/)).toBeTruthy();
  await fireEvent.press(screen.getByText('이 보고서에 관해 대화하기'));
  expect(await screen.findByText(/선택한 보고서: 2035-01-01/)).toBeTruthy();
  await fireEvent.changeText(
    screen.getByTestId('rag-conversation-input'),
    'Synthetic question',
  );
  await fireEvent.press(screen.getByTestId('rag-conversation-send'));
  expect(
    await screen.findByText('합성 보고서 대화 연결을 확인했어요.'),
  ).toBeTruthy();
  await view.unmount();
});
