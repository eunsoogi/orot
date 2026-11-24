import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { NavigationContentFrameContext } from '../../navigation/navigationContentFrame';
import type { NavigationContentFrame } from '../../navigation/navigationContentFrame';
import { NavigationOcclusionContext } from '../../navigation/useNavigationContentInset';
import { resolveNavigationOcclusion } from '../../navigation/navigationLayout';
import { HealthRecordsDetailScreen } from '../HealthRecordsDetailScreen';
import { HealthRecordsMedicationDetailScreen } from '../HealthRecordsMedicationDetailScreen';

const windowFrame = { x: 0, y: 0, width: 466, height: 678 };
const frame: NavigationContentFrame = {
  side: 'right',
  windowFrame,
  viewportFrame: windowFrame,
  availableContentFrame: { ...windowFrame, width: 382 },
  navigationFrame: null,
  reservedRegions: [],
};
const occlusion = resolveNavigationOcclusion({
  placement: 'right',
  reservedRightWidth: 84,
  systemBottomInset: 34,
  measuredBottomActionOcclusion: 40,
  systemInsets: { top: 0, right: 0, bottom: 34, left: 0 },
});

const measureLane = async (width: number) => {
  const lane = screen.queryByTestId('health-records-detail-scroll-lane');
  if (!lane) return;
  await fireEvent(lane, 'layout', {
    nativeEvent: { layout: { x: 0, y: 0, width, height: 640 } },
  });
};

// React-list identity proves reflow keeps the same virtualized owner and data request.
test.each(['observations', 'medications'] as const)(
  '%s use the outer indicator only when their own panel matches the measured rail lane',
  async kind => {
    const load = jest.fn(async () => ({
      records: [],
      definitions: [],
      doseEvents: [],
      nextCursor: null,
    }));
    const onBack = jest.fn();
    const onSelectionChange = jest.fn();
    const view = (sharedFrame: NavigationContentFrame) => (
      <NavigationContentFrameContext.Provider value={sharedFrame}>
        <NavigationOcclusionContext.Provider value={occlusion}>
          {kind === 'observations' ? (
            <HealthRecordsDetailScreen
              loadObservations={load}
              onBack={onBack}
              onSelectionChange={onSelectionChange}
              selection={{ category: 'blood_pressure', period: 'month' }}
            />
          ) : (
            <HealthRecordsMedicationDetailScreen
              loadMedicationData={load}
              onBack={onBack}
              onSelectionChange={onSelectionChange}
              selection={{ category: 'medications', period: 'month' }}
            />
          )}
        </NavigationOcclusionContext.Provider>
      </NavigationContentFrameContext.Provider>
    );
    const mounted = await render(view(frame));
    await screen.findByTestId('health-records-detail-empty');
    const scroll = () => screen.getByTestId('health-records-detail-scroll');
    const list = scroll();
    const props = () => scroll().props;
    const style = () => StyleSheet.flatten(props().style);
    const content = () => StyleSheet.flatten(props().contentContainerStyle);

    // No measurement, or a narrower local panel, must leave the list in its own lane.
    expect(style().marginRight ?? 0).toBe(0);
    await measureLane(170);
    expect(style().marginRight ?? 0).toBe(0);

    await measureLane(382);
    expect(style().marginRight).toBe(-84);
    expect(content()).toMatchObject({ paddingRight: 104, paddingBottom: 56 });
    expect(466 - content().paddingRight).toBe(382 - 20);
    expect(props().scrollIndicatorInsets).toMatchObject({ bottom: 40 });
    expect(props().automaticallyAdjustsScrollIndicatorInsets).toBe(false);

    // Left rail reflow keeps the same owner, not a replacement or a second scroller.
    await mounted.rerender(
      view({
        ...frame,
        side: 'left',
        availableContentFrame: { ...frame.availableContentFrame, x: 84 },
      }),
    );
    expect(style().marginRight ?? 0).toBe(0);
    expect(content().paddingHorizontal).toBe(20);
    expect(scroll()).toBe(list);
    expect(screen.getAllByTestId('health-records-detail-scroll')).toHaveLength(
      1,
    );
    expect(load).toHaveBeenCalledTimes(1);
  },
);
