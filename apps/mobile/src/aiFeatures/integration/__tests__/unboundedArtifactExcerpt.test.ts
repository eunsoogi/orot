import { artifactExcerpt } from '../artifactExcerpt';
import type { ArtifactMetadata } from '../../../healthEvidence/artifactDiscovery';

const metadata: ArtifactMetadata = {
  type: 'summary',
  id: 'synthetic',
  originFeature: 'summary',
  originSession: null,
  createdAt: '2035-01-01T00:00:00Z',
  eventTime: null,
  revision: '1',
  providerId: 'synthetic',
  modelId: 'synthetic',
  completion: 'complete',
  review: 'unreviewed',
};

test('complete artifact text preserves all sections without promoting historical output to facts', () => {
  const section = {
    title: 'title'.repeat(30),
    summary: 'summary'.repeat(200),
    uncertainty: 'uncertain'.repeat(100),
    missingData: Array.from(
      { length: 5 },
      (_, index) => `${index} ${'missing'.repeat(30)}`,
    ),
    supportingEvidence: [],
    contraryEvidence: [],
  };
  const full = JSON.parse(
    artifactExcerpt(metadata, { hypotheses: [section] }, 'current', [], true)
      .full,
  );
  expect(full.sections[0]).toMatchObject({
    title: section.title,
    summary: section.summary,
    uncertainty: section.uncertainty,
    missingData: section.missingData,
  });
  expect(full.excerptTruncated).toBe(false);
  expect(full.warning).toContain('not independently verified');
  const legacy = JSON.parse(
    artifactExcerpt(metadata, { hypotheses: [section] }, 'current').full,
  );
  expect(legacy.excerptTruncated).toBe(true);
  expect(legacy.sections[0].summary).toHaveLength(700);
});
