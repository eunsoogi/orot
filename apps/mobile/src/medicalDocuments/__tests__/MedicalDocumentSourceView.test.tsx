import { fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { NavigationGeometryProvider } from '../../navigation/NavigationGeometryProvider';
import { MedicalDocumentSourceView } from '../MedicalDocumentSourceView';
import { savedSourceDocument } from '../testSupport/medicalDocumentSourceViewFixtures';

const noInsets = { top: 0, right: 0, bottom: 0, left: 0 };

async function renderSource(
  evidenceSpans = savedSourceDocument().evidenceSpans,
  onBack = jest.fn(),
) {
  await render(
    <SafeAreaInsetsContext.Provider value={noInsets}>
      <NavigationGeometryProvider>
        <MedicalDocumentSourceView
          document={savedSourceDocument(evidenceSpans)}
          onBack={onBack}
        />
      </NavigationGeometryProvider>
    </SafeAreaInsetsContext.Provider>,
  );
  return onBack;
}

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
