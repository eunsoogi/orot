import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { StyleSheet } from 'react-native';
import { HealthKitImportScreen } from '../../healthkit/unifiedImport/HealthKitImportScreen';
import { unifiedHealthImportCopy } from '../../healthkit/unifiedImport/copy';
import { NavigationContentFrameContext } from '../../navigation/navigationContentFrame';
import type { NavigationContentFrame } from '../../navigation/navigationContentFrame';
import { NavigationOcclusionContext } from '../../navigation/useNavigationContentInset';
import { resolveNavigationOcclusion } from '../../navigation/navigationLayout';
import { HealthDataIntegrationScreen } from '../HealthDataIntegrationScreen';

const outer = { x: 0, y: 0, width: 466, height: 678 };
const right = {
  side: 'right',
  windowFrame: outer,
  viewportFrame: outer,
  availableContentFrame: { ...outer, width: 382 },
  navigationFrame: null,
  reservedRegions: [],
} satisfies NavigationContentFrame;
const bottom = {
  ...right,
  side: 'bottom',
  availableContentFrame: outer,
} satisfies NavigationContentFrame;
const occlusion = resolveNavigationOcclusion({
  placement: 'right',
  reservedRightWidth: 84,
  systemBottomInset: 34,
  measuredBottomActionOcclusion: 40,
  systemInsets: { top: 0, right: 0, bottom: 34, left: 0 },
});
const page = (child: ReactNode, frame: NavigationContentFrame = right) => (
  <NavigationContentFrameContext.Provider value={frame}>
    <NavigationOcclusionContext.Provider value={occlusion}>
      {child}
    </NavigationOcclusionContext.Provider>
  </NavigationContentFrameContext.Provider>
);

function expectRailScroll(id: string) {
  const scroll = screen.getByTestId(id);
  expect(StyleSheet.flatten(scroll.props.style)?.marginRight).toBe(-84);
  expect(StyleSheet.flatten(scroll.props.contentContainerStyle)).toMatchObject({
    paddingRight: 108,
    paddingBottom: 56,
  });
  expect(scroll.props.scrollIndicatorInsets).toMatchObject({
    right: 0,
    bottom: 40,
  });
}

test('health settings only lends its full measured panel, without moving save or feature controls', async () => {
  const onSave = jest.fn();
  const onToggle = jest.fn();
  await render(
    page(
      <HealthDataIntegrationScreen
        integrationStatus={null}
        loadFailed={false}
        loaded
        notice={null}
        onRetryLoad={jest.fn()}
        onRetryStatus={jest.fn()}
        onSave={onSave}
        onToggle={onToggle}
        saving={false}
        selected={new Set(['sleep'])}
        statusLoadFailed={false}
      />,
    ),
  );
  const scroll = screen.getByTestId('health-data-scroll');
  const measure = async (width: number) => {
    const lane = screen.queryByTestId('health-data-scroll-lane');
    if (lane) {
      await fireEvent(lane, 'layout', {
        nativeEvent: { layout: { width, height: 640, x: 0, y: 0 } },
      });
    }
  };
  await measure(170);
  expect(StyleSheet.flatten(scroll.props.style)?.marginRight).toBeUndefined();

  await measure(382);
  expectRailScroll('health-data-scroll');
  expect(screen.getByTestId('health-data-scroll')).toBe(scroll);
  await fireEvent.press(screen.getByTestId('health-data-feature-heartRate'));
  await fireEvent.press(screen.getByTestId('health-data-save'));
  expect(onToggle).toHaveBeenCalledWith('heartRate');
  expect(onSave).toHaveBeenCalledTimes(1);
});

test('whole import route extends only its own edge while source selection and Back survive reflow', async () => {
  const onBack = jest.fn();
  const start = jest.fn();
  const screenContent = (
    <HealthKitImportScreen
      copy={unifiedHealthImportCopy}
      coordinator={{ start }}
      onBack={onBack}
    />
  );
  const rendered = await render(page(screenContent));
  const scroll = screen.getByTestId('unified-import-scroll');
  expectRailScroll('unified-import-scroll');
  await fireEvent.press(screen.getByTestId('unified-import-toggle-heartRate'));
  await rendered.rerender(page(screenContent, bottom));
  expect(screen.getByTestId('unified-import-scroll')).toBe(scroll);
  expect(StyleSheet.flatten(scroll.props.style)?.marginRight).toBeUndefined();
  expect(
    screen.getByTestId('unified-import-toggle-heartRate').props
      .accessibilityState.checked,
  ).toBe(true);
  await fireEvent.press(screen.getByTestId('healthkit-unified-import-back'));
  expect(onBack).toHaveBeenCalledTimes(1);
  expect(start).not.toHaveBeenCalled();
});
