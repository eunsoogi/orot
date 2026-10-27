import { describe, expect, it } from '@jest/globals';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { createSyntheticVisitQuestionFixture } from '../src';

const {
  compareSyntheticCase,
  PATHS,
} = require('../../../scripts/evaluation/visit-questions/comparison-harness.cjs');
const {
  buildComparisonReport,
  integrationEvidence,
} = require('../../../scripts/evaluation/visit-questions/comparison-report.cjs');
const {
  comparisonMetrics,
  regressionsFor,
} = require('../../../scripts/evaluation/visit-questions/comparison-metrics.cjs');
const {
  getVisitQuestionProviderConfig,
} = require('../../../scripts/evaluation/visit-questions/provider-config.cjs');
const root = path.resolve(__dirname, '../../..');
const fixture = createSyntheticVisitQuestionFixture('orot-visit-questions-eval-v1');

// Default inventory exercises the real graph offline; remote calls require the explicit CLI opt-in.
const environment = process.env.OROT_RUN_WORKFLOW_COMPARISON === '1' ? process.env : {};

describe('shared-fixture workflow comparison', () => {
  it('runs all paths and retains every cohort, quality shortfall and unmeasured counter', async () => {
    const cases = [];
    for (const testCase of fixture.cases) {
      cases.push(await compareSyntheticCase(testCase, fixture, { environment }));
    }
    const config = getVisitQuestionProviderConfig(environment);
    const report = buildComparisonReport(
      root,
      fixture,
      config,
      cases,
      process.env.OROT_COMPARISON_RAG_REVISION,
    );
    expect(cases.map((item: any) => item.caseId)).toEqual(fixture.cases.map((item) => item.caseId));
    expect(
      cases.every(
        (item: any) =>
          JSON.stringify(item.paths.map((row: any) => row.path)) === JSON.stringify(PATHS),
      ),
    ).toBe(true);
    if (config.mode === 'test-adapter') {
      expect(report.finalComparisonEligible).toBe(false);
      expect(report.evidenceClass).toBe('protocol-fixture-only');
      expect(
        cases
          .flatMap((item: any) => item.paths)
          .every((row: any) => row.metrics.token_usage.status === 'unmeasured'),
      ).toBe(true);
      expect(cases[0].paths[0].executionStatus).toBe('completed');
      expect(cases[0].paths[0].metrics.retrieval_recall).toBe(1);
      expect(cases[0].paths[0].metrics.citation_support).toBe(1);
      expect(cases[0].paths[2].executionStatus).toBe('completed');
      expect(cases[0].paths[2].metrics.retrieval_recall).toBeGreaterThan(0);
      expect(cases[2].paths[2].metrics.useful_questions).toBe(0);
    }
    if (process.env.OROT_RUN_WORKFLOW_COMPARISON === '1') {
      writeFileSync(
        path.resolve(root, process.env.OROT_COMPARISON_OUTPUT!),
        `${JSON.stringify(report, null, 2)}\n`,
      );
      expect(report.executionStatus).toBe('completed');
    }
  });

  it('keeps retrieval recall separate from citation choice and flags regressions', () => {
    const testCase = fixture.cases[0];
    const output = {
      status: 'ready',
      questions: [],
      execution: { latencyMs: 5, tokenUsage: { status: 'unmeasured' } },
    };
    const metrics = comparisonMetrics(testCase, output, testCase.expected.expectedEvidenceIds);
    expect(metrics.retrieval_recall).toBe(1);
    expect(metrics.citation_support).toBe(0);
    const rows = [
      { path: 'full-context', metrics: { ...metrics, useful_questions: 1 } },
      {
        path: 'simple-rag',
        executionStatus: 'completed',
        metrics: { ...metrics, retrieval_recall: 0 },
      },
    ];
    expect(regressionsFor(rows)[0].worseMetrics).toEqual(['retrieval_recall', 'useful_questions']);
    const failed = comparisonMetrics(testCase, { ...output, status: 'execution_failed' }, []);
    expect(failed.temporal_error).toBeNull();
    expect(failed.numeric_error).toBeNull();
    expect(failed.clarification_count).toBeNull();
  });

  it('rejects an invalid integration revision instead of manufacturing dependency proof', () => {
    expect(integrationEvidence(root)).toMatchObject({ status: 'unverified' });
    expect(() => integrationEvidence(root, 'main')).toThrow('full commit SHA');
    expect(() => integrationEvidence(root, 'f'.repeat(40))).toThrow();
  });
});
