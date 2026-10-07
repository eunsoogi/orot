import { fireEvent, render, screen } from '@testing-library/react-native';
import { ExternalMedicalEvidenceScreen } from '../ExternalMedicalEvidenceScreen';
import type {
  EuropePmcMedicalEvidenceService,
  ExternalMedicalPublication,
} from '../europePmc';

const publication: ExternalMedicalPublication = {
  provider: 'Europe PMC',
  recordId: '12345',
  source: 'MED',
  title: 'Sleep and blood pressure',
  authors: 'Lee E',
  journal: 'Example Journal',
  publicationDate: '2024-03-01',
  updatedDate: null,
  abstract: 'Study summary',
  originalUrl: 'https://europepmc.org/article/MED/12345',
  retrievedAt: '2026-10-07T03:00:00.000Z',
};

test('requires query consent and presents provenance and dates', async () => {
  const service: EuropePmcMedicalEvidenceService = {
    search: jest.fn(async () => ({
      status: 'available' as const,
      publications: [publication],
    })),
  };
  const onOpenArticle = jest.fn();
  await render(
    <ExternalMedicalEvidenceScreen
      onBack={jest.fn()}
      service={service}
      onOpenArticle={onOpenArticle}
    />,
  );
  await fireEvent.changeText(
    screen.getByTestId('external-evidence-query'),
    'sleep and blood pressure',
  );
  expect(screen.getByTestId('external-evidence-search')).toBeDisabled();
  expect(service.search).not.toHaveBeenCalled();

  await fireEvent.press(screen.getByTestId('external-evidence-consent'));
  expect(screen.getByRole('checkbox')).toBeChecked();
  await fireEvent.press(screen.getByTestId('external-evidence-consent'));
  expect(screen.getByRole('checkbox')).not.toBeChecked();
  await fireEvent.press(screen.getByTestId('external-evidence-search'));
  expect(service.search).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByTestId('external-evidence-consent'));
  await fireEvent.press(screen.getByTestId('external-evidence-search'));
  expect(service.search).toHaveBeenCalledWith('sleep and blood pressure', {
    externalQueryConsented: true,
  });
  expect(await screen.findByText('Sleep and blood pressure')).toBeTruthy();
  expect(screen.getByText(/처음 공개된 날짜: 2024-03-01/)).toBeTruthy();
  expect(screen.getByText(/자료 수정 날짜: 확인할 수 없어요./)).toBeTruthy();
  expect(
    screen.getByText('가져온 시각: 2026-10-07T03:00:00.000Z'),
  ).toBeTruthy();
  await fireEvent.press(screen.getByText('원문 열기'));
  expect(onOpenArticle).toHaveBeenCalledWith(publication);
});

test('shows a localized fallback when publication authors are absent', async () => {
  const service: EuropePmcMedicalEvidenceService = {
    search: jest.fn(async () => ({
      status: 'available' as const,
      publications: [{ ...publication, authors: null }],
    })),
  };
  await render(
    <ExternalMedicalEvidenceScreen
      onBack={jest.fn()}
      service={service}
      onOpenArticle={jest.fn()}
    />,
  );

  await fireEvent.changeText(
    screen.getByTestId('external-evidence-query'),
    'query',
  );
  await fireEvent.press(screen.getByTestId('external-evidence-consent'));
  await fireEvent.press(screen.getByTestId('external-evidence-search'));

  expect(await screen.findByText('저자 정보를 확인할 수 없어요.')).toBeTruthy();
});

test('shows loading and empty-result states', async () => {
  let resolve!: (value: { status: 'empty' }) => void;
  const service: EuropePmcMedicalEvidenceService = {
    search: jest.fn(
      () =>
        new Promise(done => {
          resolve = done;
        }),
    ),
  };
  await render(
    <ExternalMedicalEvidenceScreen
      onBack={jest.fn()}
      service={service}
      onOpenArticle={jest.fn()}
    />,
  );
  await fireEvent.changeText(
    screen.getByTestId('external-evidence-query'),
    'query',
  );
  await fireEvent.press(screen.getByTestId('external-evidence-consent'));
  await fireEvent.press(screen.getByTestId('external-evidence-search'));
  expect(screen.getByTestId('external-evidence-loading')).toBeTruthy();
  expect(screen.getByTestId('external-evidence-search')).toBeDisabled();
  expect(screen.getByTestId('external-evidence-query').props.editable).toBe(
    false,
  );
  await fireEvent.press(screen.getByTestId('external-evidence-search'));
  expect(service.search).toHaveBeenCalledTimes(1);
  resolve({ status: 'empty' });
  expect(await screen.findByTestId('external-evidence-empty')).toBeTruthy();
});

test('shows an error when the provider is unavailable', async () => {
  const service: EuropePmcMedicalEvidenceService = {
    search: jest.fn(async () => ({ status: 'unavailable' as const })),
  };
  await render(
    <ExternalMedicalEvidenceScreen
      onBack={jest.fn()}
      service={service}
      onOpenArticle={jest.fn()}
    />,
  );
  await fireEvent.changeText(
    screen.getByTestId('external-evidence-query'),
    'query',
  );
  await fireEvent.press(screen.getByTestId('external-evidence-consent'));
  await fireEvent.press(screen.getByTestId('external-evidence-search'));
  expect(await screen.findByText(/외부 자료를 불러오지 못했어요/)).toBeTruthy();
});
