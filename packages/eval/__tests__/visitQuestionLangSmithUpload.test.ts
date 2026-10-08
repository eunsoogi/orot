import { describe, expect, it } from '@jest/globals';
import { createSyntheticVisitQuestionFixture } from '../src';

const { toLangSmithExample } = require('../../../scripts/evaluation/visit-questions/privacy');
const {
  datasetIdentity,
} = require('../../../scripts/evaluation/visit-questions/langsmith-dataset.cjs');
const {
  assertLangSmithEvaluationComplete,
} = require('../../../scripts/evaluation/visit-questions/langsmith-evaluation.cjs');

function completedLangSmithResult(rows: any[]) {
  return {
    results: rows,
    processedCount: rows.length,
    get length() {
      return this.results.length;
    },
    [Symbol.asyncIterator]() {
      return this;
    },
    async next() {
      if (this.processedCount < this.results.length) {
        const value = this.results[this.processedCount];
        this.processedCount += 1;
        return { value, done: false };
      }
      return { value: undefined, done: true };
    },
  };
}

describe('LangSmith synthetic example upload contract', () => {
  it('reuses a dataset name only for the same synthetic fixture contents', () => {
    const testCase = createSyntheticVisitQuestionFixture('langsmith-contract').cases[0];
    const first = datasetIdentity('langsmith-contract', [testCase]);
    const repeated = datasetIdentity('langsmith-contract', [testCase]);
    const changed = datasetIdentity('langsmith-contract', [{ ...testCase, query: 'changed' }]);

    expect(repeated).toEqual(first);
    expect(changed.name).not.toBe(first.name);
  });

  it('provides stable SDK example identity and a parseable creation time', () => {
    const testCase = createSyntheticVisitQuestionFixture('langsmith-contract').cases[0];
    const datasetId = '7b30d606-d7cf-4dde-a6aa-8f3f1ac91995';
    const first = toLangSmithExample(testCase, datasetId);
    const repeated = toLangSmithExample(testCase, datasetId);

    // LangSmith evaluates persisted dataset examples; incomplete local maps are not SDK examples.
    expect(first).toMatchObject({
      dataset_id: datasetId,
      id: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
      ),
      inputs: expect.any(Object),
      outputs: expect.any(Object),
      created_at: expect.any(String),
    });
    expect(new Date(first.created_at).toISOString()).toBe(first.created_at);
    expect(repeated.id).toBe(first.id);
  });

  it('accepts all buffered rows after the SDK has exhausted its result iterator', async () => {
    const rows = [
      { run: { id: 'synthetic-run-1' } },
      { run: { id: 'synthetic-run-2' } },
      { run: { id: 'synthetic-run-3' } },
    ];
    const experiment = completedLangSmithResult(rows);
    const yieldedRows = [];

    // LangSmith 0.10.7 returns after processing and advancing its iterator to results.length.
    for await (const row of experiment) yieldedRows.push(row);

    expect(yieldedRows).toHaveLength(0);
    expect(assertLangSmithEvaluationComplete(experiment, 3)).toHaveLength(3);
  });

  it('rejects missing evaluation rows and rows without runs', () => {
    expect(() =>
      assertLangSmithEvaluationComplete(completedLangSmithResult([{ run: {} }, { run: {} }]), 3),
    ).toThrow('LangSmith did not finish every synthetic example.');
    expect(() =>
      assertLangSmithEvaluationComplete(
        completedLangSmithResult([{ run: {} }, { run: {} }, {}]),
        3,
      ),
    ).toThrow('LangSmith returned an incomplete run.');
  });
});
