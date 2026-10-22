import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CHECK_KEYS,
  emptySelection,
  loadPolicies,
  selectEverything,
} from './changed-paths-core.mjs';
import { selectChecksForPaths } from './changed-paths-select.mjs';
import { writeSelectionOutputs, writeSelectionReport } from './ios-e2e-selection-report.mjs';
import { iosValidationTierForEvent } from './ios-validation-tier.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

function validSha(value) {
  return typeof value === 'string' && /^[a-f0-9]{40,64}$/i.test(value) && !/^0+$/.test(value);
}

export function parseNameStatusOutput(output) {
  if (typeof output !== 'string') throw new TypeError('git diff output must be text');
  const fields = output.split('\0');
  if (fields.at(-1) === '') fields.pop();
  const paths = [];
  for (let index = 0; index < fields.length;) {
    const status = fields[index++];
    if (!/^[A-Z][0-9]*$/.test(status ?? '')) {
      throw new Error('git diff returned an invalid name-status record');
    }
    const count = status.startsWith('R') || status.startsWith('C') ? 2 : 1;
    const record = fields.slice(index, index + count);
    if (record.length !== count || record.some((path) => !path)) {
      throw new Error('git diff returned an incomplete name-status record');
    }
    paths.push(...record);
    index += count;
  }
  return paths;
}

function gitDiff(args) {
  const result = spawnSync(
    'git',
    ['diff', '--name-status', '--find-renames', '--no-ext-diff', '-z', ...args],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
  );
  if (result.error || result.status !== 0) {
    throw new Error('git diff could not resolve the event comparison');
  }
  return result.stdout;
}

export function resolveChangedPaths(eventName, payload, runDiff = gitDiff) {
  // Full inventory triggers and known metadata edits bypass diffs; unknown comparisons select every check.
  if (eventName === 'workflow_dispatch') {
    return { complete: true, forceAll: true, paths: [], reason: 'manual-full-inventory-selection' };
  }
  if (eventName === 'schedule') {
    return {
      complete: true,
      forceAll: true,
      paths: [],
      reason: 'scheduled-full-inventory-selection',
    };
  }
  try {
    let args;
    if (eventName === 'pull_request') {
      if (payload?.action === 'edited') {
        const changes = payload.changes;
        if (!changes || typeof changes !== 'object')
          throw new Error('incomplete edited PR comparison');
        const changedFields = Object.keys(changes);
        if (
          changedFields.length === 0 ||
          changedFields.some((field) => !['base', 'body', 'title'].includes(field))
        ) {
          throw new Error('unknown or incomplete edited PR comparison');
        }
        if (!Object.hasOwn(changes, 'base')) {
          return {
            complete: true,
            forceAll: false,
            paths: [],
            reason: 'metadata-only-pr-edit',
            metadataOnlyEdit: true,
          };
        }
        if (
          typeof changes.base?.ref?.from !== 'string' ||
          typeof changes.base?.ref?.to !== 'string'
        )
          throw new Error('incomplete PR base edit comparison');
      }
      const base = payload?.pull_request?.base?.sha;
      const head = payload?.pull_request?.head?.sha;
      if (!validSha(base) || !validSha(head)) throw new Error('incomplete PR comparison');
      args = [base + '...' + head];
    } else if (eventName === 'push') {
      const before = payload?.before;
      const after = payload?.after;
      if (!validSha(before) || !validSha(after)) throw new Error('incomplete push comparison');
      args = [before, after];
    } else {
      throw new Error('unsupported event');
    }
    const paths = parseNameStatusOutput(runDiff(args));
    return {
      complete: true,
      forceAll: false,
      paths,
      reason: paths.length ? 'changed-paths' : 'no-changes',
    };
  } catch {
    return { complete: false, forceAll: true, paths: [], reason: 'comparison-unavailable' };
  }
}

export function selectChecksForEvent(
  eventName,
  payload,
  runDiff = gitDiff,
  policies = null,
  ref = process.env.GITHUB_REF ?? '',
  candidatePrNumber = '',
) {
  const comparison = resolveChangedPaths(eventName, payload, runDiff);
  let selection;
  if (comparison.forceAll || !comparison.complete) selection = selectEverything(comparison.reason);
  else if (comparison.metadataOnlyEdit) {
    selection = emptySelection(comparison.reason);
    selection.metadata_only_edit = true;
  } else {
    try {
      selection = selectChecksForPaths(comparison.paths, policies ?? loadPolicies());
      if (comparison.reason === 'no-changes') selection.reason = 'no-changes';
    } catch {
      selection = selectEverything('selection-unavailable');
    }
  }
  selection.validation_tier = iosValidationTierForEvent(eventName, ref, candidatePrNumber);
  return selection;
}

export function resolveFullValidationDeferred(eventName, payload) {
  // Only an explicit draft PR event may defer the required full E2E gate.
  return eventName === 'pull_request' && payload?.pull_request?.draft === true;
}

function main() {
  const eventName = process.env.GITHUB_EVENT_NAME ?? '';
  let payload = null;
  try {
    payload = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  } catch {
    // Missing event details take the same full-verification path as a failed comparison.
  }
  // Candidate provenance is supplied only by the preceding live PR validation step.
  const selection = selectChecksForEvent(
    eventName,
    payload,
    gitDiff,
    null,
    process.env.GITHUB_REF ?? '',
    process.env.OROT_IOS_CANDIDATE_PR_NUMBER ?? '',
  );
  const fullValidationDeferred = resolveFullValidationDeferred(eventName, payload);
  const selected = CHECK_KEYS.filter((key) => selection[key]);
  process.stdout.write(
    'CI path selection: event=' +
      (eventName || 'unknown') +
      ' tier=' +
      selection.validation_tier +
      ' reason=' +
      selection.reason +
      ' changed=' +
      JSON.stringify(selection.paths) +
      ' selected=' +
      JSON.stringify(selected) +
      ' cohorts=' +
      JSON.stringify(selection.ios_test_cohorts) +
      '\n',
  );
  writeSelectionReport(selection, eventName, payload, fullValidationDeferred);
  writeSelectionOutputs(selection, process.env.GITHUB_OUTPUT, fullValidationDeferred);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch {
    process.stderr.write('CI path selection output failed; required checks must fail safe.\n');
    process.exitCode = 1;
  }
}
