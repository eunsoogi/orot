import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { Dimensions, StyleSheet, View } from 'react-native';
import { NavigationRouteAdapter } from '../../navigation/NavigationRouteAdapter';
import { appContentLayoutOwner } from '../../navigation/appContentLayoutPolicy';
import { createNavigationController } from '../../navigation/navigationController';
import { savedSourceDocument } from '../../medicalDocuments/testSupport/medicalDocumentSourceViewFixtures';
import type { MedicalDocumentImportService } from '../../medicalDocuments/medicalDocumentImportService';
import type { StagedMedicalDocument } from '../../medicalDocuments/medicalDocumentNativeBridge';
import { RecordsRoute } from '../RecordsRoute';
import type { AppNavigationRoute } from '../appNavigationRoute';
import { hubSpacing } from '../../layout/hubSpacing';

jest.mock('../../layout/AppSymbol', () => ({ AppSymbol: () => null }));
jest.mock('react-native-safe-area-context', () => {
  const React = require('react') as typeof import('react');
  const insets = { top: 0, left: 0, right: 0, bottom: 34 };
  const Wrapper = ({ children }: { children?: ReactNode }) =>
    React.createElement(React.Fragment, null, children);
  return {
    SafeAreaInsetsContext: React.createContext(insets),
    useSafeAreaInsets: () => insets,
    SafeAreaProvider: Wrapper,
    SafeAreaView: Wrapper,
  };
});

const originalWindow = Dimensions.get('window');
const originalScreen = Dimensions.get('screen');
const measurement = View as unknown as {
  prototype: {
    measureInWindow: (callback: (...bounds: number[]) => void) => void;
  };
};
beforeEach(() => {
  jest
    .spyOn(measurement.prototype, 'measureInWindow')
    .mockImplementation(() => {});
});
afterEach(() => {
  Dimensions.set({ window: originalWindow, screen: originalScreen });
  jest.restoreAllMocks();
});

const staged: StagedMedicalDocument = {
  id: 'synthetic-document',
  displayName: 'Synthetic source.pdf',
  contentHash: `sha256:${'a'.repeat(64)}`,
  sections: Array.from({ length: 24 }, (_, index) => ({
    id: `synthetic-page-${index}`,
    text: `Synthetic source page ${index + 1}`,
    pageNumber: index + 1,
    startOffset: index * 24,
    endOffset: (index + 1) * 24,
  })),
};

function service(
  overrides: Partial<MedicalDocumentImportService> = {},
): MedicalDocumentImportService {
  return {
    listDocuments: jest.fn().mockResolvedValue([]),
    getDocument: jest.fn().mockResolvedValue(null),
    selectDocument: jest.fn().mockResolvedValue(staged),
    saveDocument: jest.fn().mockResolvedValue('saved'),
    discardDocument: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

async function renderRecords(
  documentImportService: MedicalDocumentImportService,
  fontScale: number,
) {
  const viewport = { ...originalWindow, width: 390, height: 700, fontScale };
  Dimensions.set({ window: viewport, screen: viewport });
  await render(
    <NavigationRouteAdapter
      controller={createNavigationController<AppNavigationRoute>('home')}
      contentLayoutOwner={appContentLayoutOwner}
      rootTabs={{ activeTab: 'records', onSelect: jest.fn() }}
      scrollable={route => route.name === 'home'}
    >
      {() => (
        <RecordsRoute
          recordings={[]}
          recordingState="ready"
          onRetryRecordings={jest.fn()}
          onOpenSymptoms={jest.fn()}
          onOpenSavedRecordings={jest.fn()}
          onOpenRecording={jest.fn()}
          onOpenHealthLibrary={jest.fn()}
          onOpenManualHistory={jest.fn()}
          documentImportService={documentImportService}
        />
      )}
    </NavigationRouteAdapter>,
  );
}

function pageContent() {
  // Match App's root Records scene: document children must contribute content, never another vertical viewport.
  expect(
    screen.container.queryAll(
      node => node.type === 'RCTScrollView' && node.props.horizontal !== true,
    ),
  ).toHaveLength(1);
  return within(screen.getByTestId('navigation-route-scroll'));
}

test.each([1, 2])(
  'keeps every staged page and failed-save recovery in the Records scene at font scale %s',
  async fontScale => {
    const imports = service({
      saveDocument: jest
        .fn()
        .mockRejectedValueOnce(new Error('Synthetic write failure'))
        .mockResolvedValueOnce('saved'),
    });
    await renderRecords(imports, fontScale);
    await fireEvent.press(
      screen.getByTestId('records-import-medical-document'),
    );
    const content = pageContent();
    const flow = content.getByTestId('records-document-review-layout');
    const primary = content.getByTestId(
      'records-document-review-layout-primary',
    );
    const secondary = content.getByTestId(
      'records-document-review-layout-secondary',
    );
    expect(StyleSheet.flatten(flow.props.style)).toMatchObject({
      flexDirection: 'column',
      gap: hubSpacing.item,
    });
    expect(flow.children[0]).toBe(primary);
    expect(flow.children[1]).toBe(secondary);
    expect(
      content.getByTestId('medical-document-review-description'),
    ).toHaveTextContent(/진단과 약 변경은 자동으로 확정되지 않아요\./);
    for (let index = 0; index < 24; index += 1) {
      expect(
        content.getByTestId(`medical-document-review-text-${index}`),
      ).toHaveTextContent(staged.sections[index]!.text);
      expect(
        content.getByTestId(`medical-document-review-text-${index}`).props
          .selectable,
      ).toBe(true);
    }
    expect(content.getByTestId('medical-document-save')).toBeEnabled();
    expect(content.getByTestId('medical-document-cancel')).toBeEnabled();
    await fireEvent.press(content.getByTestId('medical-document-save'));
    expect(
      content.getByTestId('medical-document-import-status'),
    ).toHaveTextContent(/문서를 불러오지 못했어요\./);
    expect(
      content.getByTestId('medical-document-review-text-23'),
    ).toHaveTextContent(staged.sections[23]!.text);
    await fireEvent.press(content.getByTestId('medical-document-save'));
    expect(imports.saveDocument).toHaveBeenNthCalledWith(1, staged);
    expect(imports.saveDocument).toHaveBeenNthCalledWith(2, staged);
    expect(imports.selectDocument).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('medical-document-review-title')).toBeNull();
  },
);

test('retains staged content when discard fails, then returns through the existing cancel action', async () => {
  const imports = service({
    discardDocument: jest
      .fn()
      .mockRejectedValueOnce(new Error('Synthetic cleanup failure'))
      .mockResolvedValueOnce(undefined),
  });
  await renderRecords(imports, 2);
  await fireEvent.press(screen.getByTestId('records-import-medical-document'));
  const content = pageContent();
  await fireEvent.press(content.getByTestId('medical-document-cancel'));
  expect(content.getByTestId('medical-document-import-status')).toBeTruthy();
  expect(content.getByTestId('medical-document-review-text-23')).toBeTruthy();
  await fireEvent.press(content.getByTestId('medical-document-cancel'));
  expect(imports.discardDocument).toHaveBeenCalledTimes(2);
  expect(imports.saveDocument).not.toHaveBeenCalled();
  expect(screen.getByTestId('records-import-medical-document')).toBeTruthy();
});

test.each([1, 2])(
  'keeps saved text, provenance and Back in the same scene at font scale %s',
  async fontScale => {
    const detail = savedSourceDocument();
    const imports = service({
      listDocuments: jest.fn().mockResolvedValue([detail]),
      getDocument: jest.fn().mockResolvedValue(detail),
    });
    await renderRecords(imports, fontScale);
    await fireEvent.press(screen.getByTestId('medical-document-source-0'));
    const content = pageContent();
    expect(
      content.getByTestId('medical-document-source-title'),
    ).toHaveTextContent(detail.title!);
    expect(
      content.getByTestId('medical-document-source-review-state'),
    ).toHaveTextContent('아직 검토되지 않았어요.');
    expect(
      content.getByTestId('medical-document-source-locator-0'),
    ).toHaveTextContent('2쪽 · 위치 1–25');
    expect(
      content.getByTestId('medical-document-source-text-3'),
    ).toHaveTextContent('Synthetic text without a locator');
    expect(
      content.getByTestId('medical-document-source-text-3').props.selectable,
    ).toBe(true);
    expect(
      content.queryByText(/원본 파일|PDF 파일 상태|하이라이트/),
    ).toBeNull();
    await fireEvent.press(content.getByTestId('medical-document-source-back'));
    expect(screen.getByTestId('medical-document-source-0')).toBeTruthy();
    expect(imports.getDocument).toHaveBeenCalledWith(detail.id);
  },
);
