import { fireEvent, screen } from '@testing-library/react-native';
import { runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { renderWithRootSafeArea } from '../../../test-support/safeAreaTestProviders';
import { createResearchArtifactStorage } from '../../storage/researchArtifactStorage';
import { localData } from '../../aiFeatures/integration/featureServiceFixtures';
import { retainLiteratureResults } from '../../aiFeatures/integration/researchRetention';
import { ExternalMedicalEvidenceScreen } from '../ExternalMedicalEvidenceScreen';
import { getExternalMedicalEvidenceCopy } from '../copy';

test('a failed literature retention is visible and the user can retry the search', async () => {
  const db = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(db.database);
    const storage = createResearchArtifactStorage(db.database);
    jest
      .spyOn(storage, 'append')
      .mockRejectedValueOnce(new Error('Synthetic storage failure'));
    const data = Object.assign(localData([]).data, {
      openResearchArtifactStorage: async () => storage,
    });
    const service = retainLiteratureResults(
      {
        search: async () => ({
          status: 'available',
          publications: [
            {
              provider: 'Europe PMC',
              recordId: '123',
              source: 'MED',
              title: 'Synthetic retry study',
              authors: null,
              journal: null,
              publicationDate: null,
              updatedDate: null,
              abstract: 'Not retained',
              originalUrl: 'https://europepmc.org/article/MED/123',
              retrievedAt: '2026-10-05T00:00:00.000Z',
            },
          ],
        }),
      },
      async () => data,
    );
    await renderWithRootSafeArea(
      <ExternalMedicalEvidenceScreen
        onBack={jest.fn()}
        service={service}
        onOpenArticle={jest.fn()}
      />,
    );
    await fireEvent.changeText(
      screen.getByTestId('external-evidence-query'),
      'synthetic',
    );
    await fireEvent.press(screen.getByTestId('external-evidence-search'));
    await fireEvent.press(
      await screen.findByTestId('inference-disclosure-allow'),
    );
    expect(
      await screen.findByText(getExternalMedicalEvidenceCopy().unavailable),
    ).toBeTruthy();
    expect(screen.getByTestId('external-evidence-query').props.value).toBe(
      'synthetic',
    );
    expect(
      (await storage.search('synthetic retry study', null, 10)).items,
    ).toEqual([]);
    await fireEvent.press(screen.getByTestId('external-evidence-search'));
    expect(
      await screen.findByTestId('external-evidence-publication-MED-123'),
    ).toBeTruthy();
    expect(
      (await storage.search('synthetic retry study', null, 10)).items,
    ).toHaveLength(1);
  } finally {
    db.close();
  }
});
