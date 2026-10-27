import { fireEvent, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';
import App from '../../../App';
import type { HealthReviewService } from '../service';

jest.mock('../../healthkit/commonObservations/importLocal', () => ({
  importLocalCommonObservations: jest.fn(),
}));
jest.mock('../../healthkit/bloodPressure/importLocal', () => ({
  importLocalBloodPressure: jest.fn(),
  listLocalBloodPressureObservations: jest.fn(),
}));
jest.mock('../../backup/backupSupport', () => ({
  prepareBackupSupport: jest.fn(async () => 'ready'),
}));
jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

it('keeps the four AI actions and reaches a separate App review route with a retained draft', async () => {
  jest
    .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
    .mockResolvedValue(true);
  const service: HealthReviewService = {
    list: jest.fn(async () => []),
    start: jest.fn(),
    continue: jest.fn(),
    delete: jest.fn(),
  };
  await render(<App healthReviewService={service} />);
  await fireEvent.press(screen.getByTestId('navigation-tab-ai'));
  for (const id of [
    'visit-questions',
    'disease-hypotheses',
    'rag-conversation',
    'external-evidence',
    'health-review',
  ])
    expect(screen.getByTestId('ai-feature-' + id)).toBeOnTheScreen();
  await fireEvent.press(screen.getByTestId('ai-feature-health-review'));
  expect(await screen.findByTestId('health-review-screen')).toBeOnTheScreen();
  await fireEvent.changeText(
    screen.getByTestId('health-review-name'),
    '유지할 요청',
  );
  await fireEvent.press(screen.getByTestId('navigation-back'));
  await fireEvent.press(screen.getByTestId('ai-feature-health-review'));
  expect(screen.getByTestId('health-review-name')).toHaveDisplayValue(
    '유지할 요청',
  );
  expect(service.start).not.toHaveBeenCalled();
  expect(service.continue).not.toHaveBeenCalled();
});
