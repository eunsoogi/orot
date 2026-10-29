import type { ExternalMedicalPublication } from '../../europePmc';

/** Synthetic provider data stays separate from the navigation roundtrip contract. */
export const publications: ExternalMedicalPublication[] = [
  {
    provider: 'Europe PMC',
    recordId: 'SYNTHETIC-FIRST',
    source: 'MED',
    title: 'Synthetic sleep study',
    authors: 'Synthetic Author One',
    journal: 'Synthetic Journal',
    publicationDate: '2035-01-01',
    updatedDate: null,
    abstract: 'Synthetic first abstract',
    originalUrl: 'https://europepmc.org/article/MED/SYNTHETIC-FIRST',
    retrievedAt: '2035-01-03T00:00:00.000Z',
  },
  {
    provider: 'Europe PMC',
    recordId: 'SYNTHETIC-SECOND',
    source: 'MED',
    title: 'Synthetic exercise study',
    authors: 'Synthetic Author Two',
    journal: 'Synthetic Journal',
    publicationDate: '2035-01-02',
    updatedDate: null,
    abstract: 'Synthetic second abstract',
    originalUrl: 'https://europepmc.org/article/MED/SYNTHETIC-SECOND',
    retrievedAt: '2035-01-03T00:00:00.000Z',
  },
];
