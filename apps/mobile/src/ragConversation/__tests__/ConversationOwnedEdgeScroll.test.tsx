import { fireEvent, render, screen } from '@testing-library/react-native';
import { ScrollView, StyleSheet, View } from 'react-native';
import { FloatingIdentityInset } from '../../assistantAppearance/FloatingIdentityInset';
import { NavigationContentFrameContext } from '../../navigation/navigationContentFrame';
import { resolveNavigationOcclusion } from '../../navigation/navigationLayout';
import { NavigationOcclusionContext } from '../../navigation/useNavigationContentInset';
import { FloatingComposerSurface } from '../FloatingComposerSurface';
import {
  useHistoryPageEdgeScroll,
  useTranscriptEdgeScroll,
} from '../useConversationOwnedEdgeScroll';

const full = { x: 0, y: 0, width: 466, height: 650 };
const bounds = {
  windowFrame: full,
  viewportFrame: full,
  availableContentFrame: { ...full, width: 382 },
  reservedRegions: [],
  side: 'right' as const,
  navigationFrame: { x: 382, y: 0, width: 84, height: 650 },
};
const occlusion = resolveNavigationOcclusion({
  placement: 'right',
  reservedRightWidth: 84,
  systemBottomInset: 0,
  measuredBottomActionOcclusion: 20,
  systemInsets: { top: 0, left: 0, right: 0, bottom: 0 },
});

function ScrollOwners() {
  const transcript = useTranscriptEdgeScroll(5, false);
  const history = useHistoryPageEdgeScroll();
  return (
    <>
      <View {...transcript.hostProps} testID="synthetic-transcript-host">
        <ScrollView testID="synthetic-transcript" {...transcript.scrollProps} />
      </View>
      <View {...history.hostProps}>
        <ScrollView testID="synthetic-history" {...history.scrollProps} />
      </View>
    </>
  );
}

test('independent owners use the measured full edge while respecting composer and identity overlap', async () => {
  await render(
    <NavigationContentFrameContext.Provider value={bounds}>
      <NavigationOcclusionContext.Provider value={occlusion}>
        <FloatingIdentityInset.Provider value={36}>
          <FloatingComposerSurface composer={<View />}>
            <ScrollOwners />
          </FloatingComposerSurface>
        </FloatingIdentityInset.Provider>
      </NavigationOcclusionContext.Provider>
    </NavigationContentFrameContext.Provider>,
  );
  const resize = async (id: string, width: number, height = 650) =>
    fireEvent(screen.getByTestId(id), 'layout', {
      nativeEvent: { layout: { width, height, x: 0, y: 0 } },
    });
  const transcript = screen.getByTestId('synthetic-transcript');
  const history = screen.getByTestId('synthetic-history');
  expect(transcript.props.scrollIndicatorInsets).toBeUndefined();
  expect(history.props.scrollIndicatorInsets).toBeUndefined();

  await resize('conversation-floating-composer-overlay', 382, 70);
  await resize('synthetic-transcript-host', 382, 350);
  await resize('conversation-history-screen', 382);
  expect(screen.getByTestId('synthetic-transcript')).toBe(transcript);
  expect(screen.getByTestId('synthetic-history')).toBe(history);
  expect(StyleSheet.flatten(transcript.props.style)).toHaveProperty(
    'marginRight',
    -84,
  );
  expect(StyleSheet.flatten(transcript.props.contentContainerStyle)).toEqual({
    paddingTop: 36,
    paddingBottom: 95,
    paddingRight: 84,
  });
  expect(transcript.props.scrollIndicatorInsets).toEqual({
    top: 36,
    bottom: 70,
    left: 0,
    right: 0,
  });
  expect(history.props.scrollIndicatorInsets.bottom).toBe(20);

  await resize('synthetic-transcript-host', 220, 350);
  expect(transcript.props.scrollIndicatorInsets).toBeUndefined();
  expect(StyleSheet.flatten(transcript.props.contentContainerStyle)).toEqual({
    paddingTop: 36,
    paddingBottom: 95,
  });
  expect(history.props.scrollIndicatorInsets.bottom).toBe(20);
});
