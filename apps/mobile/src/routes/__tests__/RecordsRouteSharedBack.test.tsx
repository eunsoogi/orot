import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo, ScrollView, View } from 'react-native';
import type { ReactNode } from 'react';
import type { NavigationSurfaceProps } from '../../navigation/NavigationActionBar';
import { createNavigationController } from '../../navigation/navigationController';
import { NavigationRouteAdapter } from '../../navigation/NavigationRouteAdapter';
import { RecordsRoute } from '../RecordsRoute';

jest.mock('react-native-safe-area-context', () => {
  const React = require('react') as typeof import('react');
  const { View: NativeView } =
    require('react-native') as typeof import('react-native');
  const insets = { top: 0, right: 0, bottom: 0, left: 0 };

  return {
    SafeAreaInsetsContext: React.createContext(insets),
    useSafeAreaInsets: () => insets,
    SafeAreaProvider: ({ children }: { children?: ReactNode }) =>
      React.createElement(React.Fragment, null, children),
    SafeAreaView: ({
      children,
      style,
      testID,
    }: {
      children?: ReactNode;
      style?: import('react-native').StyleProp<
        import('react-native').ViewStyle
      >;
      testID?: string;
    }) => React.createElement(NativeView, { style, testID }, children),
  };
});

function FallbackSurface({ children, style, testID }: NavigationSurfaceProps) {
  return (
    <View style={style} testID={testID}>
      {children}
    </View>
  );
}

afterEach(() => {
  jest.restoreAllMocks();
});

test('saved medical source returns through the shared Back action without losing the Records list', async () => {
  jest
    .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
    .mockResolvedValue(true);

  const source = {
    id: 'document-saved',
    sourceKind: 'medical_document' as const,
    title: 'Synthetic saved source.pdf',
    ingestedAt: '2026-10-01T10:00:00.000Z',
    provenance: { origin: 'imported' as const, sourceRecordIds: [] },
    reviewState: { status: 'unreviewed' as const },
  };
  const detail = {
    ...source,
    evidenceSpans: [
      {
        id: 'saved-span',
        sourceRecordId: source.id,
        text: 'Synthetic saved page text',
        pageNumber: 2,
        ingestedAt: source.ingestedAt,
        provenance: {
          origin: 'imported' as const,
          sourceRecordIds: [source.id],
        },
        reviewState: source.reviewState,
        locator: {
          kind: 'document_range' as const,
          pageNumber: 2,
          startOffset: 0,
          endOffset: 25,
        },
      },
    ],
  };
  const service = {
    listDocuments: jest.fn().mockResolvedValue([source]),
    getDocument: jest.fn().mockResolvedValue(detail),
    selectDocument: jest.fn().mockResolvedValue(null),
    saveDocument: jest.fn(),
    discardDocument: jest.fn(),
  };
  const onSelectTab = jest.fn();
  const controller = createNavigationController<'records'>('records');
  const scrollTo = jest.spyOn(ScrollView.prototype, 'scrollTo');
  const restoreFrames: FrameRequestCallback[] = [];
  jest
    .spyOn(globalThis, 'requestAnimationFrame')
    .mockImplementation(callback => {
      restoreFrames.push(callback);
      return restoreFrames.length;
    });

  await render(
    <NavigationRouteAdapter
      controller={controller}
      rootTabs={{ activeTab: 'records', onSelect: onSelectTab }}
      scrollable
      surface={FallbackSurface}
    >
      {() => (
        <RecordsRoute
          recordings={[]}
          recordingState="ready"
          onRetryRecordings={jest.fn()}
          onOpenSavedRecordings={jest.fn()}
          onOpenRecording={jest.fn()}
          onOpenHealthLibrary={jest.fn()}
          onOpenManualHistory={jest.fn()}
          documentImportService={service}
        />
      )}
    </NavigationRouteAdapter>,
  );

  await screen.findByTestId('medical-document-source-0');
  await fireEvent.scroll(screen.getByTestId('navigation-route-scroll'), {
    nativeEvent: { contentOffset: { x: 0, y: 340 } },
  });
  await fireEvent.press(screen.getByTestId('medical-document-source-0'));
  expect(
    await screen.findByTestId('medical-document-source-title'),
  ).toHaveTextContent(source.title);
  expect(screen.queryByTestId('medical-document-source-back')).toBeNull();

  await fireEvent.scroll(screen.getByTestId('navigation-route-scroll'), {
    nativeEvent: { contentOffset: { x: 0, y: 720 } },
  });

  await fireEvent.press(screen.getByTestId('navigation-back'));

  await act(async () => {
    restoreFrames.forEach(frame => frame(0));
  });

  expect(screen.getByTestId('medical-document-source-0')).toBeTruthy();
  expect(screen.queryByTestId('navigation-back')).toBeNull();
  expect(controller.getSnapshot().currentRoute.name).toBe('records');
  expect(onSelectTab).not.toHaveBeenCalled();
  expect(service.getDocument).toHaveBeenCalledWith(source.id);
  expect(scrollTo).toHaveBeenCalledWith({ x: 0, y: 340, animated: false });

  await fireEvent.press(screen.getByTestId('medical-document-source-0'));
  expect(
    await screen.findByTestId('medical-document-source-title'),
  ).toHaveTextContent(source.title);
});
