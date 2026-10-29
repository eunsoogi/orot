import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import {
  Dimensions,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { NavigationGeometryProvider } from '../../navigation/NavigationGeometryProvider';
import { RecordsRoute } from '../../routes/RecordsRoute';
import type { RecordsRouteProps } from '../../routes/RecordsRoute';
import type { StagedMedicalDocument } from '../medicalDocumentNativeBridge';
import type { MedicalDocumentImportService } from '../medicalDocumentImportService';
import {
  medicalDocumentReviewCompactGeometry,
  medicalDocumentReviewDuoGeometry,
  medicalDocumentReviewInsets,
} from '../testSupport/medicalDocumentReviewGeometryFixtures';

jest.mock('../../layout/AppSymbol', () => ({ AppSymbol: () => null }));
jest.mock('../../navigation', () => ({
  useNavigationLeaveStateRegistration: jest.fn(),
}));

const measurableView = View as unknown as {
  prototype: {
    measureInWindow: (
      callback: (x: number, y: number, width: number, height: number) => void,
    ) => void;
  };
};
const originalWindow = Dimensions.get('window');
const originalScreen = Dimensions.get('screen');
const viewport = (width: number, fontScale = 1) => ({
  ...originalWindow,
  width,
  height: 900,
  scale: 1,
  fontScale,
});

function ParentViewport({ children }: { readonly children: ReactNode }) {
  const { width, height } = useWindowDimensions();
  return (
    <View style={{ width, height }} testID="records-test-viewport">
      {children}
    </View>
  );
}

function stagedDocument(): StagedMedicalDocument {
  return {
    id: 'document-review',
    displayName: 'Synthetic medical source.pdf',
    contentHash: `sha256:${'a'.repeat(64)}` as const,
    sections: [
      {
        id: 'page-one',
        text: 'Synthetic source page one',
        pageNumber: 1,
        startOffset: 0,
        endOffset: 25,
      },
      {
        id: 'page-two',
        text: 'Synthetic source page two',
        pageNumber: 2,
        startOffset: 25,
        endOffset: 50,
      },
    ],
  };
}

function importService(
  overrides: Partial<MedicalDocumentImportService> = {},
): MedicalDocumentImportService {
  return {
    listDocuments: jest.fn().mockResolvedValue([]),
    getDocument: jest.fn().mockResolvedValue(null),
    selectDocument: jest.fn().mockResolvedValue(null),
    saveDocument: jest.fn().mockResolvedValue('saved'),
    discardDocument: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function routeProps(
  documentImportService: MedicalDocumentImportService,
): RecordsRouteProps {
  return {
    recordings: [],
    recordingState: 'ready',
    onRetryRecordings: jest.fn(),
    onOpenSymptoms: jest.fn(),
    onOpenSavedRecordings: jest.fn(),
    onOpenRecording: jest.fn(),
    onOpenHealthLibrary: jest.fn(),
    onOpenManualHistory: jest.fn(),
    documentImportService,
  };
}

async function renderRoute(
  documentImportService: MedicalDocumentImportService,
) {
  await render(
    <SafeAreaInsetsContext.Provider value={medicalDocumentReviewInsets}>
      <NavigationGeometryProvider>
        <ParentViewport>
          <RecordsRoute {...routeProps(documentImportService)} />
        </ParentViewport>
      </NavigationGeometryProvider>
    </SafeAreaInsetsContext.Provider>,
  );
}

beforeEach(() => {
  Dimensions.set({ window: viewport(1000), screen: viewport(1000) });
  jest
    .spyOn(measurableView.prototype, 'measureInWindow')
    .mockImplementation(function (
      this: { readonly props: { readonly testID?: string } },
      callback,
    ) {
      // Give the shared frame full host bounds so it can select one usable Duo region.
      if (this.props.testID === 'records-document-review-layout-frame-host') {
        const parent = Dimensions.get('window');
        callback(0, 0, parent.width, parent.height);
      }
    });
});

afterEach(() => {
  Dimensions.set({ window: originalWindow, screen: originalScreen });
  jest.restoreAllMocks();
});

test('keeps the production review and preview vertical inside one measured Duo region', async () => {
  const selected = stagedDocument();
  const service = importService({
    selectDocument: jest.fn().mockResolvedValue(selected),
    saveDocument: jest
      .fn()
      .mockRejectedValueOnce(new Error('Synthetic write failure.'))
      .mockResolvedValue('saved'),
  });
  await renderRoute(service);

  await fireEvent.press(screen.getByTestId('records-import-medical-document'));
  await screen.findByTestId('medical-document-review-title');

  const style = (testID: string) =>
    StyleSheet.flatten(screen.getByTestId(testID).props.style);
  const expectVerticalFlow = () =>
    [
      'records-document-review-layout',
      'records-document-review-layout-frame',
    ].forEach(testID => expect(style(testID)?.flexDirection).toBe('column'));
  const measuredLaneWidth = () =>
    style('records-document-review-layout-frame-primary')?.width as number;
  const reflowToCompact = async () =>
    act(async () => {
      Dimensions.set({ window: viewport(320), screen: viewport(320) });
      await fireEvent(
        screen.getByTestId('navigation-window-geometry-sensor'),
        'geometryChange',
        { nativeEvent: medicalDocumentReviewCompactGeometry },
      );
    });
  expectVerticalFlow();
  expect(
    screen.queryByTestId('records-document-review-layout-frame-secondary'),
  ).toBeNull();
  expect(screen.getByTestId('records-test-viewport').props.style.width).toBe(
    Dimensions.get('window').width,
  );

  await fireEvent(
    screen.getByTestId('navigation-window-geometry-sensor'),
    'geometryChange',
    { nativeEvent: medicalDocumentReviewDuoGeometry },
  );
  expectVerticalFlow();
  const measuredLeadingInset = Number(
    style('records-document-review-layout-frame')?.marginStart ?? 0,
  );
  const division = medicalDocumentReviewDuoGeometry.reservedRegions.find(
    region => region.kind === 'division',
  );
  if (!division) throw new Error('The Duo fixture needs a display division.');
  expect(measuredLeadingInset).toBeGreaterThanOrEqual(
    medicalDocumentReviewDuoGeometry.safeAreaInsets.left,
  );
  expect(measuredLeadingInset + measuredLaneWidth()).toBeLessThanOrEqual(
    division.frame.x,
  );

  await act(async () => {
    Dimensions.set({
      window: viewport(1000, 1.5),
      screen: viewport(1000, 1.5),
    });
  });
  expectVerticalFlow();
  expect(
    screen.getByTestId('medical-document-review-filename'),
  ).toHaveTextContent(selected.displayName);
  expect(
    screen.getByTestId('medical-document-review-text-1'),
  ).toHaveTextContent('Synthetic source page two');
  expect(screen.getByTestId('medical-document-save')).toBeEnabled();
  expect(screen.getByTestId('medical-document-cancel')).toBeEnabled();

  await reflowToCompact();
  expectVerticalFlow();
  expect(screen.getByTestId('records-test-viewport').props.style.width).toBe(
    Dimensions.get('window').width,
  );
  expect(measuredLaneWidth()).toBeLessThanOrEqual(320);
  expect(screen.getByTestId('medical-document-review-title')).toBeTruthy();
  expect(screen.getByTestId('medical-document-review-text-0')).toBeTruthy();
  expect(service.selectDocument).toHaveBeenCalledTimes(1);

  await fireEvent.press(screen.getByTestId('medical-document-save'));
  expect(
    await screen.findByText(
      '문서를 불러오지 못했어요. 파일이 열리는지 확인해 주세요.',
    ),
  ).toBeTruthy();

  await reflowToCompact();
  expect(
    screen.getByTestId('medical-document-review-text-0'),
  ).toHaveTextContent('Synthetic source page one');
  expect(
    screen.getByTestId('medical-document-import-status'),
  ).toHaveTextContent(
    '문서를 불러오지 못했어요. 파일이 열리는지 확인해 주세요.',
  );
  await fireEvent.press(screen.getByTestId('medical-document-save'));
  expect(service.saveDocument).toHaveBeenCalledTimes(2);
  expect(service.saveDocument).toHaveBeenNthCalledWith(1, selected);
  expect(service.saveDocument).toHaveBeenNthCalledWith(2, selected);
  expect(await screen.findByText('문서와 출처를 저장했어요.')).toBeTruthy();
  expect(screen.queryByTestId('medical-document-review-title')).toBeNull();
});
