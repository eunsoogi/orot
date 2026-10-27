import { fireEvent, screen, within } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { renderWithRootSafeArea } from '../../../test-support/safeAreaTestProviders';
import { appColors } from '../../layout/appColors';
import { ExternalMedicalEvidenceScreen } from '../ExternalMedicalEvidenceScreen';
import { getExternalMedicalEvidenceCopy } from '../copy';
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

const secondPublication: ExternalMedicalPublication = {
  ...publication,
  recordId: '67890',
  title: 'Exercise and sleep quality',
  authors: 'Kim S',
  originalUrl: 'https://europepmc.org/article/MED/67890',
};

test('declining the shared query permission does not call the literature service', async () => {
  const service: EuropePmcMedicalEvidenceService = {
    search: jest.fn(async () => ({ status: 'empty' as const })),
  };
  await renderWithRootSafeArea(
    <ExternalMedicalEvidenceScreen
      onBack={jest.fn()}
      service={service}
      onOpenArticle={jest.fn()}
    />,
  );
  // The native first-tap regression exercises keyboard delivery; this protects
  // the ScrollView configuration that lets the focused input's Search tap through.
  expect(
    screen.getByTestId('external-medical-evidence-screen').props
      .keyboardShouldPersistTaps,
  ).toBe('handled');
  await fireEvent(screen.getByTestId('external-evidence-query'), 'focus');
  await fireEvent.changeText(
    screen.getByTestId('external-evidence-query'),
    'synthetic query',
  );
  await fireEvent.press(screen.getByTestId('external-evidence-search'));
  await fireEvent.press(
    await screen.findByTestId('inference-disclosure-cancel'),
  );
  expect(service.search).not.toHaveBeenCalled();
  expect(
    await screen.findByText(getExternalMedicalEvidenceCopy().consentRequired),
  ).toBeTruthy();
});

test('requires query consent and presents provenance and dates', async () => {
  const service: EuropePmcMedicalEvidenceService = {
    search: jest.fn(async () => ({
      status: 'available' as const,
      publications: [publication, secondPublication],
    })),
  };
  const onOpenArticle = jest.fn();
  await renderWithRootSafeArea(
    <ExternalMedicalEvidenceScreen
      onBack={jest.fn()}
      service={service}
      onOpenArticle={onOpenArticle}
    />,
  );
  const description = screen.getByText(
    getExternalMedicalEvidenceCopy().description,
  );
  const queryInput = screen.getByTestId('external-evidence-query');
  expect(StyleSheet.flatten(description.props.style).color).toBe(
    appColors.text,
  );
  expect(queryInput.props.placeholderTextColor).toBe(appColors.secondary);
  expect(StyleSheet.flatten(queryInput.props.style)).toMatchObject({
    backgroundColor: appColors.surface,
    color: appColors.text,
  });
  await fireEvent(queryInput, 'focus');
  expect(StyleSheet.flatten(queryInput.props.style)).toMatchObject({
    borderColor: appColors.primaryText,
    borderWidth: 2,
  });
  await fireEvent(queryInput, 'blur');
  expect(StyleSheet.flatten(queryInput.props.style)).toMatchObject({
    borderColor: appColors.secondary,
    borderWidth: 1,
  });
  await fireEvent.changeText(queryInput, 'sleep and blood pressure');
  expect(screen.getByTestId('external-evidence-search')).not.toBeDisabled();
  expect(service.search).not.toHaveBeenCalled();

  await fireEvent.press(screen.getByTestId('external-evidence-search'));
  await fireEvent.press(
    await screen.findByTestId('inference-disclosure-allow'),
  );
  expect(service.search).toHaveBeenCalledWith('sleep and blood pressure', {
    externalQueryConsented: true,
    signal: expect.any(AbortSignal),
  });
  const firstResult = await screen.findByTestId(
    'external-evidence-publication-MED-12345',
  );
  expect(firstResult.props.accessibilityState).toMatchObject({
    selected: true,
  });
  const selectedSource = screen.getByTestId(
    'external-evidence-selected-source',
  );
  const sourceDetails = within(selectedSource);
  expect(sourceDetails.getByText(publication.title)).toBeTruthy();
  expect(StyleSheet.flatten(firstResult.props.style).backgroundColor).toEqual(
    appColors.surface,
  );
  expect(sourceDetails.getByText(/처음 공개된 날짜: 2024-03-01/)).toBeTruthy();
  expect(
    sourceDetails.getByText(/자료 수정 날짜: 확인할 수 없어요./),
  ).toBeTruthy();
  expect(
    sourceDetails.getByText('가져온 시각: 2026-10-07T03:00:00.000Z'),
  ).toBeTruthy();

  const secondResult = screen.getByTestId(
    'external-evidence-publication-MED-67890',
  );
  await fireEvent.press(secondResult);
  expect(firstResult.props.accessibilityState).toMatchObject({
    selected: false,
  });
  expect(secondResult.props.accessibilityState).toMatchObject({
    selected: true,
  });
  expect(StyleSheet.flatten(secondResult.props.style)).toMatchObject({
    borderColor: appColors.primaryText,
    borderWidth: 2,
  });
  expect(sourceDetails.getByText(secondPublication.title)).toBeTruthy();
  await fireEvent.press(
    screen.getByTestId('external-evidence-open-selected-source'),
  );
  expect(onOpenArticle).toHaveBeenCalledWith(secondPublication);
});

test('shows a localized fallback when publication authors are absent', async () => {
  const service: EuropePmcMedicalEvidenceService = {
    search: jest.fn(async () => ({
      status: 'available' as const,
      publications: [{ ...publication, authors: null }],
    })),
  };
  await renderWithRootSafeArea(
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
  await fireEvent.press(screen.getByTestId('external-evidence-search'));
  await fireEvent.press(
    await screen.findByTestId('inference-disclosure-allow'),
  );

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
  await renderWithRootSafeArea(
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
  await fireEvent.press(screen.getByTestId('external-evidence-search'));
  await fireEvent.press(
    await screen.findByTestId('inference-disclosure-allow'),
  );
  expect(screen.getByTestId('external-evidence-loading')).toBeTruthy();
  expect(
    screen.getByTestId('external-evidence-search').props.accessibilityState,
  ).toMatchObject({ busy: true, disabled: true });
  resolve({ status: 'empty' });
  expect(await screen.findByTestId('external-evidence-empty')).toBeTruthy();
});

test('shows an error when the provider is unavailable', async () => {
  const service: EuropePmcMedicalEvidenceService = {
    search: jest.fn(async () => ({ status: 'unavailable' as const })),
  };
  await renderWithRootSafeArea(
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
  await fireEvent.press(screen.getByTestId('external-evidence-search'));
  await fireEvent.press(
    await screen.findByTestId('inference-disclosure-allow'),
  );
  expect(await screen.findByText(/외부 자료를 불러오지 못했어요/)).toBeTruthy();
});
