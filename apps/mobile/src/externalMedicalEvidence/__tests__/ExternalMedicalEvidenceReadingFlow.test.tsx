import { fireEvent, screen, within } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { renderWithRootSafeArea } from '../../../test-support/safeAreaTestProviders';
import { ExternalMedicalEvidenceScreen } from '../ExternalMedicalEvidenceScreen';
import type {
  EuropePmcMedicalEvidenceService,
  ExternalMedicalPublication,
} from '../europePmc';
import { getExternalMedicalEvidenceCopy } from '../copy';

const publication: ExternalMedicalPublication = {
  provider: 'Europe PMC',
  source: 'MED',
  recordId: 'LONG',
  title: 'Original long publication title '.repeat(12),
  authors: null,
  journal: null,
  publicationDate: null,
  updatedDate: null,
  abstract: 'Original supplied abstract '.repeat(80),
  originalUrl: `https://europepmc.org/article/MED/${'original-source-'.repeat(30)}`,
  retrievedAt: '2035-01-03T00:00:00Z',
};

/** Guards reading order and the permission boundary independently of measured window size. */
test('keeps guidance compact and results with their full selected source in one scrolling page', async () => {
  const service: EuropePmcMedicalEvidenceService = {
    search: jest.fn(async () => ({
      status: 'available' as const,
      publications: [publication],
    })),
  };
  await renderWithRootSafeArea(
    <ExternalMedicalEvidenceScreen
      onBack={jest.fn()}
      onOpenArticle={jest.fn()}
      service={service}
    />,
  );
  expect(
    screen.queryByTestId('external-medical-evidence-columns-secondary'),
  ).toBeNull();
  expect(screen.queryByTestId('external-evidence-result-panel')).toBeNull();
  expect(
    screen.getByText(getExternalMedicalEvidenceCopy().selectResult),
  ).toBeTruthy();
  await fireEvent.changeText(
    screen.getByTestId('external-evidence-query'),
    '   ',
  );
  expect(screen.getByTestId('external-evidence-search')).toBeDisabled();
  expect(service.search).not.toHaveBeenCalled();
  await fireEvent.changeText(
    screen.getByTestId('external-evidence-query'),
    'original query',
  );
  expect(service.search).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByTestId('external-evidence-search'));
  expect(service.search).not.toHaveBeenCalled();
  await fireEvent.press(
    await screen.findByTestId('inference-disclosure-allow'),
  );
  const flow = within(
    screen.getByTestId('external-medical-evidence-columns-primary'),
  );
  expect(flow.getByTestId('external-evidence-result-list')).toBeTruthy();
  const details = flow.getByTestId('external-evidence-selected-source');
  expect(within(details).getByText(publication.title)).toBeTruthy();
  expect(within(details).getByText(publication.abstract!)).toBeTruthy();
  expect(within(details).getByText(publication.originalUrl)).toBeTruthy();
  expect(
    within(details).getByText('저자 정보를 확인할 수 없어요.'),
  ).toBeTruthy();
  expect(
    within(details).getByTestId('external-evidence-open-selected-source'),
  ).toBeTruthy();
  const result = flow.getByTestId('external-evidence-publication-MED-LONG');
  expect(StyleSheet.flatten(result.props.style)).toMatchObject({
    borderBottomWidth: StyleSheet.hairlineWidth,
  });
  expect(
    screen.getByTestId('external-evidence-selection-MED-LONG'),
  ).toBeTruthy();
  expect(
    flow
      .getAllByText(publication.title)
      .every(item => item.props.numberOfLines === undefined),
  ).toBe(true);
});

test('keeps loading exclusive and retries failure in place without dropping the query', async () => {
  let complete!: (value: { status: 'unavailable' }) => void;
  const search = jest
    .fn<
      ReturnType<EuropePmcMedicalEvidenceService['search']>,
      Parameters<EuropePmcMedicalEvidenceService['search']>
    >()
    .mockImplementationOnce(
      () =>
        new Promise(resolve => {
          complete = resolve;
        }),
    )
    .mockResolvedValue({ status: 'available', publications: [publication] });
  const service = { search };
  const onOpenArticle = jest.fn();
  await renderWithRootSafeArea(
    <ExternalMedicalEvidenceScreen
      onBack={jest.fn()}
      onOpenArticle={onOpenArticle}
      service={service}
    />,
  );
  const query = screen.getByTestId('external-evidence-query');
  await fireEvent.changeText(query, 'retained query');
  await fireEvent.press(screen.getByTestId('external-evidence-search'));
  await fireEvent.press(
    await screen.findByTestId('inference-disclosure-allow'),
  );
  expect(screen.getByTestId('external-evidence-search')).toBeDisabled();
  await fireEvent.press(screen.getByTestId('external-evidence-search'));
  expect(search).toHaveBeenCalledTimes(1);
  complete({ status: 'unavailable' });
  expect(
    await screen.findByText(getExternalMedicalEvidenceCopy().unavailable),
  ).toBeTruthy();
  expect(query.props.value).toBe('retained query');
  await fireEvent.press(screen.getByTestId('external-evidence-search'));
  await screen.findByTestId('external-evidence-selected-source');
  await fireEvent.press(
    screen.getByTestId('external-evidence-publication-MED-LONG'),
  );
  await fireEvent.press(
    screen.getByTestId('external-evidence-open-selected-source'),
  );
  expect(onOpenArticle).toHaveBeenCalledWith(publication);
  expect(query.props.value).toBe('retained query');
  expect(search).toHaveBeenCalledTimes(2);
});
