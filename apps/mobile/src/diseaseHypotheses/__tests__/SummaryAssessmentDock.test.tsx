import { act, fireEvent, render } from '@testing-library/react-native';
import { ActionSheetIOS } from 'react-native';
import { NavigationGlassSurface } from '../../navigation/NavigationGlassSurface';
import { NavigationPageActionDock } from '../../navigation/NavigationPageActionDock';
import {
  NavigationPrimaryActionContext,
  useNavigationPrimaryActionHost,
} from '../../navigation/useNavigationPrimaryAction';
import { DiseaseHypothesesScreen } from '../DiseaseHypothesesScreen';

const metrics = globalThis as typeof globalThis & {
  __OROT_TEST_PAGE_METRICS__?: null;
};

test('keeps Summary direct and Assessment independently reachable in the real measured dock', async () => {
  metrics.__OROT_TEST_PAGE_METRICS__ = null;
  let selectMenuOption: ((index: number) => void) | undefined;
  const show = jest
    .spyOn(ActionSheetIOS, 'showActionSheetWithOptions')
    .mockImplementation((_options, callback) => (selectMenuOption = callback));
  const summary = jest.fn();
  const assessment = jest.fn();
  function Fixture() {
    const { host, actions } = useNavigationPrimaryActionHost('summary');
    return (
      <NavigationPrimaryActionContext.Provider value={host}>
        <DiseaseHypothesesScreen
          onBack={jest.fn()}
          onOpenSource={jest.fn()}
          onGenerate={assessment}
          onSummarize={summary}
          onOpenHistory={jest.fn()}
          summaryHistory={{ list: async () => [], read: async () => null }}
        />
        <NavigationPageActionDock
          actions={actions}
          capacity={3}
          disabled={false}
          isDarkAppearance={false}
          isRail={false}
          routeKey="summary"
          surface={NavigationGlassSurface}
          surfaceProps={{}}
        />
      </NavigationPrimaryActionContext.Provider>
    );
  }
  try {
    const view = await render(<Fixture />);
    const surface = () => view.getByTestId('navigation-page-action-surface');
    const measureWidth = (width: number) =>
      act(async () => {
        const { onPageMetrics, pageMetricsRequest } = surface().props;
        onPageMetrics({
          nativeEvent: {
            revision: pageMetricsRequest.revision,
            widths: [150, 145, 130, 48],
            heights: [48, 48, 48, 48],
            width,
          },
        });
      });
    await measureWidth(540);
    expect(view.getByTestId('symptom-summary-generate')).toBeEnabled();
    expect(view.getByTestId('disease-hypotheses-generate')).toBeEnabled();
    expect(view.queryByTestId('navigation-page-action-overflow')).toBeNull();

    // Narrow width keeps the primary Summary, but an ordinary direct-only
    // disease lookup here cannot succeed even though the action is available.
    await measureWidth(290);
    expect(view.getByTestId('symptom-summary-generate')).toBeEnabled();
    expect(view.queryByTestId('disease-hypotheses-generate')).toBeNull();
    await fireEvent.press(view.getByTestId('navigation-page-action-overflow'));
    expect(show).toHaveBeenCalledTimes(1);
    expect(show).toHaveBeenCalledWith(
      expect.objectContaining({
        options: ['가능성 살펴보기', '저장된 요약 보기', '동작 메뉴 닫기'],
        cancelButtonIndex: 2,
        disabledButtonIndices: [],
      }),
      expect.any(Function),
    );
    await act(async () => selectMenuOption?.(2));
    expect(view.getByTestId('symptom-summary-generate')).toBeEnabled();
    expect(summary).not.toHaveBeenCalled();
    expect(assessment).not.toHaveBeenCalled();
    await view.unmount();
  } finally {
    show.mockRestore();
    delete metrics.__OROT_TEST_PAGE_METRICS__;
  }
});
