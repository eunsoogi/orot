import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { HealthReviewPending } from '@orot/agent-runtime';
import { SafetyPolicyDecisionSchema, SourceRecordSchema } from '@orot/domain';
import { Dimensions, View } from 'react-native';
import { NavigationGeometryProvider } from '../../navigation/NavigationGeometryProvider';
import type { NavigationGeometryPayload } from '../../navigation/navigationGeometry';
import { HealthReviewSessionProvider } from '../HealthReviewSession';
import { HealthReviewScreen } from '../HealthReviewScreen';
import type { HealthReviewService } from '../service';

const originalWindow = Dimensions.get('window');
const originalScreen = Dimensions.get('screen');
const viewport = (width: number, fontScale = 1) => ({
  ...originalWindow,
  width,
  height: 700,
  scale: 1,
  fontScale,
});
const hostBounds = new Map<
  string,
  { readonly x: number; readonly width: number }
>();
const measurableView = View as unknown as {
  prototype: {
    measureInWindow: (
      callback: (x: number, y: number, width: number, height: number) => void,
    ) => void;
  };
};

jest
  .spyOn(measurableView.prototype, 'measureInWindow')
  .mockImplementation(function (
    this: { readonly props: { readonly testID?: string } },
    callback,
  ) {
    const bounds = hostBounds.get(this.props.testID ?? '');
    if (bounds) callback(bounds.x, 0, bounds.width, 600);
  });

beforeEach(() => {
  hostBounds.clear();
  Dimensions.set({ window: viewport(900), screen: viewport(900) });
});

afterEach(() => {
  Dimensions.set({ window: originalWindow, screen: originalScreen });
});

function geometry(
  width: number,
  divisionX?: number,
): NavigationGeometryPayload {
  return {
    windowBounds: { x: 0, y: 0, width, height: 700 },
    safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 },
    reservedRegionsSupported: divisionX !== undefined,
    reservedRegions:
      divisionX === undefined
        ? []
        : [
            {
              id: 'duo-division',
              kind: 'division',
              frame: { x: divisionX, y: 0, width: 10, height: 700 },
              margins: { top: 0, right: 0, bottom: 0, left: 0 },
              isActive: true,
            },
          ],
  };
}

it('keeps the selected pending review and form values as measured panels reflow', async () => {
  const sourceId = 'pending-review';
  const source = SourceRecordSchema.parse({
    id: sourceId,
    sourceKind: 'user_note',
    title: '다시 확인할 검토',
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
  const pending: HealthReviewPending = {
    threadId: sourceId,
    sourceId,
    safety: SafetyPolicyDecisionSchema.parse({
      policyVersion: '1.0.0',
      category: 'insufficient_information',
      matchedRuleIds: [],
      requiredActions: [],
      missingInputs: [],
    }),
    references: [],
    reason: 'evidence',
  };
  const layoutService: HealthReviewService = {
    list: jest.fn(async () => [{ source, pending }]),
    start: jest.fn(),
    continue: jest.fn(),
    delete: jest.fn(),
  };
  await render(
    <NavigationGeometryProvider>
      <HealthReviewSessionProvider service={layoutService}>
        <HealthReviewScreen onSource={jest.fn()} onProvider={jest.fn()} />
      </HealthReviewSessionProvider>
    </NavigationGeometryProvider>,
  );

  expect(
    await screen.findByTestId('health-review-request-pending-review'),
  ).toBeOnTheScreen();
  expect(screen.getByTestId('health-review-layout')).toBeOnTheScreen();
  await fireEvent.changeText(
    screen.getByTestId('health-review-name'),
    '유지할 초안',
  );
  await fireEvent.changeText(
    screen.getByTestId('health-review-systolic-0'),
    '125',
  );
  await fireEvent.press(
    screen.getByTestId('health-review-request-pending-review'),
  );
  await fireEvent.press(
    screen.getByRole('radio', { name: '대상 정보: 임신 중' }),
  );
  expect(
    screen.getByTestId('health-review-needs_clarification'),
  ).toBeOnTheScreen();

  hostBounds.set('health-review-layout-host', { x: 0, width: 900 });
  await fireEvent(
    screen.getByTestId('navigation-window-geometry-sensor'),
    'geometryChange',
    { nativeEvent: geometry(900, 445) },
  );
  expect(screen.getByTestId('health-review-layout')).toBeOnTheScreen();

  await act(async () => {
    Dimensions.set({ window: viewport(500), screen: viewport(500) });
    hostBounds.set('health-review-layout-host', { x: 0, width: 500 });
    await fireEvent(
      screen.getByTestId('navigation-window-geometry-sensor'),
      'geometryChange',
      { nativeEvent: geometry(500) },
    );
  });
  expect(screen.getByTestId('health-review-layout')).toBeOnTheScreen();
  expect(screen.getByTestId('health-review-name')).toHaveDisplayValue(
    '유지할 초안',
  );
  expect(screen.getByTestId('health-review-systolic-0')).toHaveDisplayValue(
    '125',
  );
  expect(
    screen.getByRole('radio', {
      name: '대상 정보: 임신 중',
      checked: true,
    }),
  ).toBeOnTheScreen();
  expect(
    screen.getByTestId('health-review-needs_clarification'),
  ).toBeOnTheScreen();

  await act(async () => {
    Dimensions.set({ window: viewport(900, 2), screen: viewport(900, 2) });
    hostBounds.set('health-review-layout-host', { x: 0, width: 900 });
    await fireEvent(
      screen.getByTestId('navigation-window-geometry-sensor'),
      'geometryChange',
      { nativeEvent: geometry(900) },
    );
  });
  expect(screen.getByTestId('health-review-layout')).toBeOnTheScreen();
  expect(
    screen.getByTestId('health-review-needs_clarification'),
  ).toBeOnTheScreen();
  expect(layoutService.start).not.toHaveBeenCalled();
  expect(layoutService.continue).not.toHaveBeenCalled();
});
