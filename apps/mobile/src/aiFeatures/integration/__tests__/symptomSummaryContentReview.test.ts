import { restoreSymptomSummary } from '../symptomSummarySources';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { fingerprint } from '../evidenceUtils';
import { healthOverviewTestFixture } from '../testSupport/healthOverviewTestSupport';
import { repository } from '../testSupport/personalEvidenceTestSupport';
import { localData } from '../featureServiceFixtures';
import {
  hypothesis,
  reference,
} from '../../../diseaseHypotheses/taskTestSupport';

test.each([
  ['private-med-0', '예시약0은 처방되지 않음.', 'prescription'],
  ['private-sleep', '깊은 수면 4회.', 'sleep_count'],
  ['private-sleep', '깊은 수면 4분 40초.', 'sleep_duration'],
  ['private-health-4', '걸음 수는 1,234회 측정됐어요.', 'step_unit'],
])(
  'marks a known inaccurate saved %s result using only its existing bounded source read',
  async (id, summary, issue) => {
    const { records } = await healthOverviewTestFixture();
    const row = records.find(item => item.record.id === id)!;
    const ref = { ...reference, sourceId: id, evidenceId: id };
    const saved = {
      id: 'synthetic-saved',
      createdAt: '2035-01-01T00:00:00Z',
      modelId: 'synthetic',
      providerId: 'synthetic',
      modelName: 'Synthetic',
      analysis: {
        hypotheses: [hypothesis({ summary, supportingEvidence: [ref] })],
      },
      sources: [
        {
          reference: ref,
          records: [{ kind: row.kind, id, revision: fingerprint(row.record) }],
        },
      ],
    };
    const before = JSON.stringify(saved);
    const data = localData([]).data;
    data.repository.readRecord = jest.fn(repository([row]).readRecord);
    const result = await restoreSymptomSummary(
      saved,
      new LocalEvidenceReferenceRegistry(),
      data,
    );
    expect(result.savedSummary).toMatchObject({
      status: 'saved',
      sourceChanged: false,
      contentReviewIssues: [issue],
    });
    expect(result.hypotheses[0]?.summary).toBe(summary);
    expect(JSON.stringify(saved)).toBe(before);
    expect(data.repository.readRecord).toHaveBeenCalledTimes(1);
  },
);
