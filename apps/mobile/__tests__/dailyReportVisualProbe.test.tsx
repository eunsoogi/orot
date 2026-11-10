import { fireEvent, render, screen } from '@testing-library/react-native';
import {
  DailyReportLoadingProbe,
  DailyReportVisualProbe,
} from '../e2e/dailyReportVisualProbeEntry';
import { t } from '../src/i18n';

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

test('controlled preview rejects and releases only on explicit fixture actions', async () => {
  const saved = '합성 심박수 기록은 72회예요.';
  const pending = t('dailyReport.preparing');
  const error = t('dailyReport.lookupError');
  const view = await render(<DailyReportLoadingProbe />);
  expect(screen.getByText(pending)).toBeTruthy();
  expect(screen.getByText(saved)).toBeTruthy();

  await fireEvent.press(
    screen.getByTestId('daily-report-fixture-reject-preview'),
  );
  expect(screen.getByText(error)).toBeTruthy();
  expect(screen.queryByText(pending)).toBeNull();
  expect(screen.getByText(saved)).toBeTruthy();

  await fireEvent.press(
    screen.getByRole('button', { name: t('dailyReport.retry') }),
  );
  expect(screen.getByText(pending)).toBeTruthy();
  expect(screen.queryByText(error)).toBeNull();
  expect(screen.getByText(saved)).toBeTruthy();

  await fireEvent.press(
    screen.getByTestId('daily-report-fixture-release-preview'),
  );
  expect(screen.getByText(/까지 확인한 기록 1건/u)).toBeTruthy();
  expect(screen.queryByText(pending)).toBeNull();
  expect(screen.getByText(saved)).toBeTruthy();
  await view.unmount();
});
