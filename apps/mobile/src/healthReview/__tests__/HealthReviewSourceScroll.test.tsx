import { fireEvent, render, screen } from '@testing-library/react-native';
import { SourceRecordSchema } from '@orot/domain';
import { StyleSheet } from 'react-native';
import * as provider from '../../aiFeatures/integration/provider';
import { appColors } from '../../layout/appColors';
import { HealthReviewScreen } from '../HealthReviewScreen';
import { HealthReviewSessionProvider } from '../HealthReviewSession';
import type { HealthReviewService } from '../service';

jest.mock('@react-native-community/datetimepicker', () => 'DateTimePicker');

jest.mock('../../agent/execution/useInferenceConsent', () => ({
  useInferenceConsent: () => ({
    consent: { authorize: async () => 'renewal_required' },
    disclosureSheet: null,
  }),
}));

afterEach(() => jest.restoreAllMocks());

it('keeps rounded inputs and source actions in the keyboard-aware scroll content', async () => {
  const source = SourceRecordSchema.parse({
    id: 'last-health-review',
    sourceKind: 'user_note',
    title: '마지막 건강 검토',
    effectiveAt: '2026-10-28T00:00:00.000Z',
    recordedAt: '2026-10-28T00:00:00.000Z',
    ingestedAt: '2026-10-28T00:00:00.000Z',
    reviewState: { status: 'unreviewed' },
    provenance: {
      origin: 'user_reported',
      sourceRecordIds: [],
      source: { system: 'orot.health-review-request' },
    },
  });
  const service: HealthReviewService = {
    list: jest.fn(async () => [{ source, pending: null }]),
    start: jest.fn(),
    continue: jest.fn(),
    delete: jest.fn(),
  };
  jest
    .spyOn(provider, 'resolveSelectedAiProvider')
    .mockResolvedValue({ status: 'selection-required' });

  await render(
    <HealthReviewSessionProvider service={service}>
      <HealthReviewScreen onSource={jest.fn()} onProvider={jest.fn()} />
    </HealthReviewSessionProvider>,
  );

  const scroll = await screen.findByTestId('health-review-screen');
  expect(scroll.props).toMatchObject({
    automaticallyAdjustKeyboardInsets: true,
    keyboardShouldPersistTaps: 'handled',
  });
  expect(
    StyleSheet.flatten(scroll.props.contentContainerStyle).paddingBottom,
  ).toBeGreaterThan(0);

  const inputStyle = StyleSheet.flatten(
    screen.getByTestId('health-review-name').props.style,
  );
  expect(inputStyle).toMatchObject({
    backgroundColor: appColors.surface,
    borderRadius: 12,
    minHeight: 48,
  });
  expect(inputStyle.height).toBeUndefined();

  const sourceAction = await screen.findByTestId(
    'health-review-request-last-health-review',
  );
  expect(StyleSheet.flatten(sourceAction.props.style)).toMatchObject({
    backgroundColor: appColors.surface,
    borderRadius: 14,
    borderWidth: 1,
    minHeight: 48,
  });
  const lastAction = screen.getByTestId(
    'health-review-delete-last-health-review',
  );
  expect(StyleSheet.flatten(lastAction.props.style)).toMatchObject({
    backgroundColor: appColors.dangerSurface,
    borderRadius: 14,
    borderWidth: 1,
  });
  expect(lastAction).toBeOnTheScreen();

  await fireEvent.press(sourceAction);
  expect(screen.getByTestId('health-review-unavailable')).toBeOnTheScreen();
});
