import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { useState } from 'react';
import { Button, Text } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import {
  NavigationPrimaryActionContext,
  useNavigationPrimaryActionHost,
} from '../../navigation/useNavigationPrimaryAction';
import { NavigationGeometryProvider } from '../../navigation/NavigationGeometryProvider';
import { medicalDocumentNativeBridge } from '../medicalDocumentNativeBridge';
import { MedicalDocumentSourceView } from '../MedicalDocumentSourceView';
import type { SavedMedicalDocument } from '../medicalDocumentImportService';
import type { StoredMedicalDocumentPhoto } from '../medicalDocumentNativeBridge';
import { savedSourceDocument } from '../testSupport/medicalDocumentSourceViewFixtures';

const noInsets = { top: 0, right: 0, bottom: 0, left: 0 };

async function renderDocument(
  document: SavedMedicalDocument,
  onBack = jest.fn(),
) {
  await render(
    <SafeAreaInsetsContext.Provider value={noInsets}>
      <NavigationGeometryProvider>
        <MedicalDocumentSourceView document={document} onBack={onBack} />
      </NavigationGeometryProvider>
    </SafeAreaInsetsContext.Provider>,
  );
  return onBack;
}

async function renderSource(
  evidenceSpans = savedSourceDocument().evidenceSpans,
  onBack = jest.fn(),
) {
  return renderDocument(savedSourceDocument(evidenceSpans), onBack);
}

afterEach(() => jest.restoreAllMocks());

test('shows saved text with its imported time, review state and original locator variants', async () => {
  const onBack = await renderSource();

  expect(screen.getByTestId('medical-document-source-title')).toHaveTextContent(
    'Synthetic saved source.pdf',
  );
  expect(
    screen.getByTestId('medical-document-source-review-state'),
  ).toHaveTextContent('아직 검토되지 않았어요.');
  expect(
    screen.getByTestId('medical-document-source-imported-at'),
  ).toHaveTextContent(/2026/);
  expect(
    screen.getByTestId('medical-document-source-locator-0'),
  ).toHaveTextContent('2쪽 · 위치 1–25');
  expect(
    screen.getByTestId('medical-document-source-locator-1'),
  ).toHaveTextContent('위치 3–10');
  expect(
    screen.getByTestId('medical-document-source-locator-2'),
  ).toHaveTextContent('4쪽');
  expect(
    screen.getByTestId('medical-document-source-locator-3'),
  ).toHaveTextContent('위치 정보 없음');
  expect(
    screen.getByTestId('medical-document-source-text-0'),
  ).toHaveTextContent('Synthetic saved page text');
  expect(
    screen.getByTestId('medical-document-source-text-3'),
  ).toHaveTextContent('Synthetic text without a locator');

  await fireEvent.press(screen.getByTestId('medical-document-source-back'));
  expect(onBack).toHaveBeenCalledTimes(1);
});

test('keeps an empty saved extracted-source detail distinct from original-file state', async () => {
  await renderSource([]);

  expect(screen.getByTestId('medical-document-source-empty')).toHaveTextContent(
    '저장된 텍스트 내용이 없어요.',
  );
  expect(screen.getByTestId('medical-document-source-evidence')).toBeTruthy();
  expect(screen.queryByText(/원본 파일|PDF 파일 상태|하이라이트/)).toBeNull();
});

test('omits the content Back link when the shared navigation host is present', async () => {
  function HostedSource() {
    const { host, routeBackAction } = useNavigationPrimaryActionHost('records');
    return (
      <NavigationPrimaryActionContext.Provider value={host}>
        <MedicalDocumentSourceView
          document={savedSourceDocument()}
          onBack={onBack}
        />
        {routeBackAction ? (
          <Button
            onPress={() => routeBackAction.onPress()}
            testID="shared-navigation-back"
            title="Back"
          />
        ) : null}
      </NavigationPrimaryActionContext.Provider>
    );
  }

  const onBack = jest.fn();
  await render(<HostedSource />);

  expect(screen.queryByTestId('medical-document-source-back')).toBeNull();
  await waitFor(() => {
    expect(screen.getByTestId('shared-navigation-back')).toBeTruthy();
  });
  await fireEvent.press(screen.getByTestId('shared-navigation-back'));
  expect(onBack).toHaveBeenCalledTimes(1);
});

test('unregisters the shared Back action when saved detail closes', async () => {
  const onBack = jest.fn();
  function HostedRecord() {
    const { host, routeBackAction } = useNavigationPrimaryActionHost('records');
    const [showDetail, setShowDetail] = useState(true);
    const closeDetail = () => {
      onBack();
      setShowDetail(false);
    };
    return (
      <NavigationPrimaryActionContext.Provider value={host}>
        {showDetail ? (
          <MedicalDocumentSourceView
            document={savedSourceDocument()}
            onBack={closeDetail}
          />
        ) : (
          <Text testID="records-list">Synthetic records list</Text>
        )}
        {routeBackAction ? (
          <Button
            onPress={() => routeBackAction.onPress()}
            testID="shared-navigation-back"
            title="Back"
          />
        ) : null}
      </NavigationPrimaryActionContext.Provider>
    );
  }

  await render(<HostedRecord />);
  await waitFor(() => {
    expect(screen.getByTestId('shared-navigation-back')).toBeTruthy();
  });
  await fireEvent.press(screen.getByTestId('shared-navigation-back'));

  expect(onBack).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId('records-list')).toBeTruthy();
  expect(screen.queryByTestId('shared-navigation-back')).toBeNull();
});

test('loads a saved photo by its persisted identity while retaining OCR as separate evidence', async () => {
  const document: SavedMedicalDocument = {
    ...savedSourceDocument(),
    title: 'Synthetic saved photo.png',
    contentHash: 'sha256:synthetic-photo',
  };
  const photo: StoredMedicalDocumentPhoto = {
    sourceId: document.id,
    mimeType: 'image/png',
    base64Data: 'c3ludGhldGlj',
  };
  const load = jest
    .spyOn(medicalDocumentNativeBridge, 'loadOriginalPhoto')
    .mockResolvedValue(photo);

  await renderDocument(document);
  await waitFor(() => {
    expect(load).toHaveBeenCalledWith(document.id, document.contentHash);
  });

  expect(
    screen.getByTestId('medical-document-source-original-photo'),
  ).toBeTruthy();
  expect(
    screen.getByTestId('medical-document-source-text-0'),
  ).toHaveTextContent('Synthetic saved page text');
});
