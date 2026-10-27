import type { EuropePmcMedicalEvidenceService } from '../src/externalMedicalEvidence/europePmc';

export const syntheticPublication = {
  provider: 'Europe PMC' as const,
  recordId: 'SYNTHETIC',
  source: 'MED',
  title: '합성 문헌: 활동과 수면 기록 해석',
  authors: 'Synthetic Author',
  journal: 'Synthetic Journal',
  publicationDate: '2035-01-01',
  updatedDate: '2035-01-02',
  abstract:
    '화면 검사를 위한 합성 초록이에요. 실제 연구 결과나 건강 조언이 아니에요.',
  originalUrl: 'https://europepmc.org/article/MED/SYNTHETIC',
  retrievedAt: '2035-01-03T00:00:00Z',
};

export const syntheticSecondPublication = {
  ...syntheticPublication,
  recordId: 'SYNTHETIC-SECOND',
  title: '합성 문헌: 운동과 수면의 질',
  authors: 'Synthetic Second Author',
  originalUrl: 'https://europepmc.org/article/MED/SYNTHETIC-SECOND',
};

/** Local result states only: no fetch, model, real article or patient record is accessed. */
export const syntheticLiteratureService: EuropePmcMedicalEvidenceService = {
  async search(query, options) {
    if (!options.externalQueryConsented) return { status: 'consent_required' };
    if (query.includes('empty')) return { status: 'empty' };
    if (query.includes('failure')) return { status: 'unavailable' };
    if (query.includes('pending')) {
      return new Promise(resolve => {
        if (options.signal?.aborted) resolve({ status: 'unavailable' });
        else
          options.signal?.addEventListener(
            'abort',
            () => resolve({ status: 'unavailable' }),
            { once: true },
          );
      });
    }
    return {
      status: 'available',
      publications: [syntheticPublication, syntheticSecondPublication],
    };
  },
};
