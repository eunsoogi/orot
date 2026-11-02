import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import {
  verifyFaceIdControlLog,
  verifyAuthenticationResultBundle,
} from './ios-authentication-evidence.mjs';
import { focusedIosTestCohorts, selectFocusedIosTests } from './ios-focused-selection.mjs';
import { verifyIosTestCohortResults } from './ios-test-cohort-results.mjs';
import { verifyIosObservationList } from './ios-test-results.mjs';
import { verifyFocusedRuntimeEvidence } from './ios-focused-runtime-evidence.mjs';
import { iosTestCohort } from './ios-test-cohorts.mjs';

/** Verify one downloaded focused artifact against its workflow selection and exact run provenance. */
export function verifyFocusedIosResults(profile, file, name, directory, context) {
  const { sourceSha, runId, attempt } = context ?? {};
  if (
    !directory ||
    !/^[a-f0-9]{40}$/.test(sourceSha ?? '') ||
    !/^[1-9]\d*$/.test(String(runId ?? '')) ||
    !/^[1-9]\d*$/.test(String(attempt ?? ''))
  )
    throw new Error('Focused result verification requires selection and downloaded evidence');

  const selection = selectFocusedIosTests(profile, file, name);
  if (context.candidate) {
    const receipt = JSON.parse(
      readFileSync(join(directory, 'selection/ios-candidate-selection.json'), 'utf8'),
    );
    if (
      receipt.headSha !== sourceSha ||
      receipt.runId !== String(runId) ||
      receipt.attempt !== String(attempt) ||
      receipt.fullValidation !== false ||
      receipt.profile !== selection.profile ||
      receipt.configuration !== selection.configuration ||
      receipt.mode !== selection.mode ||
      !isDeepStrictEqual(receipt.identifiers, selection.identifiers) ||
      !isDeepStrictEqual(receipt.cohorts, focusedIosTestCohorts(selection))
    )
      throw new Error('Focused candidate selection receipt does not match this execution');
  }
  const manifestBytes = readFileSync(join(directory, 'product-artifact/manifest.json'));
  const manifest = JSON.parse(manifestBytes);
  if (
    context.candidate &&
    (!/^[a-f0-9]{64}$/.test(context.manifestDigest ?? '') ||
      createHash('sha256').update(manifestBytes).digest('hex') !== context.manifestDigest)
  )
    throw new Error('Focused candidate manifest digest mismatch');
  const product = manifest.context;
  if (
    product.sourceSha !== sourceSha ||
    String(product.runId) !== String(runId) ||
    String(product.attempt) !== String(attempt) ||
    product.spec.configuration !== selection.configuration ||
    !product.spec.compatibleExecutions.includes(selection.profile)
  )
    throw new Error('Focused results belong to a stale or incompatible integration product');

  const reportFile =
    selection.mode === 'fixture'
      ? 'fixtures/results.json'
      : [
            'backup',
            'local-model',
            'speech-journey',
            'fixture-isolation',
            'recording-persistence',
            'state-persistence',
            'encounter-review-persistence',
          ].includes(selection.mode)
        ? `${selection.mode}/results.json`
        : 'results.json';
  const cohorts = focusedIosTestCohorts(selection);
  const runtimeEvidence = (path, runtimeProfile, cohort) => {
    const owner = JSON.parse(readFileSync(join(path, 'simulator-owner.json'), 'utf8'));
    const records = readFileSync(join(path, 'simulator-owner.json.preparation.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    return verifyFocusedRuntimeEvidence(owner, records, runtimeProfile, { runId, attempt }, cohort);
  };
  const runtimes = [];
  let actual;
  if (cohorts.length) {
    const reports = join(directory, 'cohorts');
    const artifact = (cohort) => `ios-cohort-report-${cohort}-${runId}-${attempt}`;
    if (
      JSON.stringify(readdirSync(reports).sort()) !== JSON.stringify(cohorts.map(artifact).sort())
    )
      throw new Error('Focused reports omit a selected partition or include an unexpected report');
    actual = cohorts.flatMap((cohort) => {
      const path = join(reports, artifact(cohort));
      if (context.candidate)
        runtimes.push(runtimeEvidence(path, iosTestCohort(cohort).profiles[0], cohort));
      return verifyIosTestCohortResults(
        JSON.parse(readFileSync(join(reports, artifact(cohort), 'results.json'), 'utf8')),
        cohort,
        { sourceSha, runId: String(runId), attempt: String(attempt) },
      );
    });
  } else {
    if (context.candidate) runtimes.push(runtimeEvidence(directory, selection.profile));
    actual = JSON.parse(readFileSync(join(directory, reportFile), 'utf8')).observations;
  }

  // Authentication is counted separately; its real Device Hub inputs and xcresult are mandatory.
  const observations = verifyIosObservationList(actual, selection.identifiers);
  let authenticationEvidence;
  if (selection.mode === 'authentication') {
    const owner = JSON.parse(readFileSync(join(directory, 'simulator-owner.json'), 'utf8'));
    verifyAuthenticationResultBundle(join(directory, 'results.xcresult'));
    authenticationEvidence = {
      ...verifyFaceIdControlLog(join(directory, 'biometric-controls.log'), owner.udid),
      selectedCases: observations.length,
    };
  }
  return {
    sourceSha,
    runId: String(runId),
    attempt: String(attempt),
    profile: selection.profile,
    configuration: selection.configuration,
    identifiers: selection.identifiers,
    ...(context.candidate ? { manifestDigest: context.manifestDigest, runtimes } : {}),
    selectedCases: observations.length,
    fullValidation: false,
    ...(authenticationEvidence
      ? { authenticationEvidence, authenticationObservations: observations }
      : {}),
  };
}

if (process.argv[1]?.endsWith('/ios-focused-results.mjs')) {
  const [profile, file, name, directory] = process.argv.slice(2);
  const result = verifyFocusedIosResults(profile, file, name, directory, {
    sourceSha: process.env.GITHUB_SHA,
    runId: process.env.GITHUB_RUN_ID,
    attempt: process.env.GITHUB_RUN_ATTEMPT,
    candidate: process.env.OROT_FOCUSED_CANDIDATE === 'true',
    manifestDigest: process.env.OROT_FOCUSED_MANIFEST_DIGEST,
  });
  console.log(JSON.stringify(result));
}
