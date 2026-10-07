import { AppointmentSchema } from '@orot/domain';
import { describe, expect, it } from '@jest/globals';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { createSyntheticVisitQuestionFixture } from '../src';

const {
  buildSyntheticClarificationResponse,
} = require('../../../scripts/evaluation/visit-questions/clarification-response.cjs');
const {
  getEvaluationRevisionMetadata,
  toLangSmithRevisionMetadata,
} = require('../../../scripts/evaluation/visit-questions/revision.cjs');

describe('synthetic visit-question fixtures', () => {
  it('creates repeatable calendar, health, consultation, and reviewed-memory inputs', () => {
    const first = createSyntheticVisitQuestionFixture('visit-eval-01');
    const repeat = createSyntheticVisitQuestionFixture('visit-eval-01');
    const otherSeed = createSyntheticVisitQuestionFixture('visit-eval-02');

    expect(repeat).toEqual(first);
    expect(otherSeed.fixtureId).not.toBe(first.fixtureId);
    expect(first.disclaimer).toMatch(/synthetic/i);
    expect(first.reviewedMemory.reviewState).toBe('reviewed');
    expect(first.reviewedMemory.content).toMatch(/합성 메모리/u);
    first.cases.forEach((testCase) => {
      AppointmentSchema.parse(testCase.appointment);
      testCase.evidence.forEach((item) => {
        expect(item.sourceId).toContain(first.fixtureId);
        expect(item.evidenceId).toContain(first.fixtureId);
      });
    });
  });

  it('preserves cancelled versus rescheduled dates and both sleep units', () => {
    const fixture = createSyntheticVisitQuestionFixture('visit-eval-temporal');
    const visit = fixture.cases.find((item) => item.caseId === 'confirmed-next-visit-with-memory');
    const content = visit?.evidence.map((item) => item.content).join('\n') ?? '';

    expect(visit?.appointment.status).toBe('rescheduled');
    expect(visit?.appointmentContext.effectiveAt).toBe('2030-05-09T09:00:00Z');
    expect(content).toContain('2030-05-02 was cancelled');
    expect(content).toContain('rescheduled to 2030-05-09');
    expect(content).toContain('7.5 hours');
    expect(content).toContain('450 minutes');
    expect(visit?.expected.forbiddenDates).toEqual(['2030-05-02']);
  });

  it('marks material conflict and unobserved-date cases as clarification targets', () => {
    const fixture = createSyntheticVisitQuestionFixture('visit-eval-safety');
    const medication = fixture.cases.find((item) => item.caseId.includes('medication'));
    const measurement = fixture.cases.find((item) => item.caseId.includes('measurement'));

    expect(medication?.conflicts).toHaveLength(1);
    expect(medication?.expected.resultMode).toBe('needs_clarification');
    expect(medication?.evidence.map((item) => item.content).join('\n')).toMatch(
      /not taking MockMed-A now/u,
    );
    expect(measurement?.coverageGaps).toHaveLength(1);
    expect(measurement?.expected.unobservedDates).toEqual(['2030-04-22']);
    expect(measurement?.expected.resultMode).toBe('needs_clarification');
  });

  it('scripts clarification for conflicts and missing current measurements without guessing values', () => {
    const fixture = createSyntheticVisitQuestionFixture('visit-eval-clarification');
    const clarificationCases = fixture.cases.filter(
      (item) => item.expected.resultMode === 'needs_clarification',
    );

    clarificationCases.forEach((testCase) => {
      const response = JSON.parse(buildSyntheticClarificationResponse(testCase));
      expect(response.value.status).toBe('needs_clarification');
      expect(
        testCase.expected.requiredTerms.every((term: string) =>
          response.value.message.includes(term),
        ),
      ).toBe(true);
    });
    expect(buildSyntheticClarificationResponse(fixture.cases[0])).toBeNull();
  });

  it('records the graph target revision separately from the dependency toolchain', () => {
    const repositoryRoot = path.resolve(__dirname, '../../..');
    const metadata = getEvaluationRevisionMetadata(repositoryRoot);
    const expectedRevision = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repositoryRoot,
      encoding: 'utf8',
    }).trim();
    const expectedWorkingTreeClean =
      execFileSync('git', ['status', '--porcelain'], {
        cwd: repositoryRoot,
        encoding: 'utf8',
      }).trim().length === 0;
    const expectedLockfileHash = createHash('sha256')
      .update(readFileSync(path.join(repositoryRoot, 'pnpm-lock.yaml')))
      .digest('hex');

    expect(metadata.evaluationTarget).toMatchObject({
      name: 'runVisitQuestionWorkflow',
      sourcePath: 'apps/mobile/src/agent/visitQuestions/workflow.ts',
      gitRevision: expectedRevision,
      workingTreeClean: expectedWorkingTreeClean,
    });
    expect(metadata.toolchain).toMatchObject({
      lockfileSha256: expectedLockfileHash,
      nodeVersion: process.version,
    });
  });

  it('allowlists only revision and toolchain metadata for LangSmith', () => {
    expect(
      toLangSmithRevisionMetadata({
        evaluationTarget: {
          gitRevision: 'a'.repeat(40),
          sourcePath: 'apps/mobile/src/agent/visitQuestions/workflow.ts',
          workingTreeClean: false,
          fixtureContent: 'excluded',
        },
        toolchain: {
          lockfileSha256: 'b'.repeat(64),
          nodeVersion: process.version,
          debugPayload: 'excluded',
        },
        input: 'excluded',
      }),
    ).toEqual({
      evaluationTargetCommit: 'a'.repeat(40),
      evaluationTargetPath: 'apps/mobile/src/agent/visitQuestions/workflow.ts',
      evaluationTargetWorkingTreeClean: false,
      toolchainLockfileSha256: 'b'.repeat(64),
      toolchainNodeVersion: process.version,
    });
  });
});
