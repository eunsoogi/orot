import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { iosTestCohortTasks } from './ios-test-cohorts.mjs';
import { iosTestImpactForPath } from './ios-test-impact.mjs';
import { focusedIosTestCohorts, selectFocusedIosTests } from './ios-focused-selection.mjs';

/** A focused run may claim coverage only when its exact selection contains every maintained dependent task. */
export function verifyFocusedCandidateImpact(paths, selection) {
  if (!Array.isArray(paths) || !paths.length || !Array.isArray(selection?.identifiers))
    throw new Error('Candidate impact requires a nonempty exact changed-path list');
  const selected = new Set(selection.identifiers);
  const impacts = [];
  for (const path of paths) {
    if (path.startsWith('docs/') || path === 'README.md') continue;
    if (!path.startsWith('apps/mobile/') && !path.startsWith('packages/'))
      throw new Error(`Candidate shared impact is unknown: ${path}`);
    const impact = iosTestImpactForPath(path);
    const tasks = impact.cohorts.flatMap(iosTestCohortTasks);
    if (
      impact.oauth ||
      tasks.some(
        (task) =>
          task.profile !== selection.profile || task.identifiers.some((id) => !selected.has(id)),
      )
    )
      throw new Error(`Candidate selection does not cover ${path}: ${impact.reason}`);
    impacts.push({ path, reason: impact.reason, cohorts: impact.cohorts });
  }
  return impacts;
}

/** Compare both names for renames so a deleted shared fixture cannot disappear from impact analysis. */
export function candidateChangedPaths(baseSha, headSha) {
  if (![baseSha, headSha].every((value) => /^[a-f0-9]{40}$/.test(value ?? '')))
    throw new Error('Candidate impact requires exact base and head SHAs');
  const git = (...args) => execFileSync('git', args, { encoding: 'utf8' });
  if (git('rev-parse', 'HEAD').trim() !== headSha)
    throw new Error('Candidate checkout SHA mismatch');
  const base = git('merge-base', baseSha, headSha).trim();
  return git('diff', '--no-renames', '--name-only', '-z', base, headSha)
    .split('\0')
    .filter(Boolean);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [profile, file, name, output, ...extra] = process.argv.slice(2);
  if (!output || extra.length)
    throw new Error('Candidate impact requires one exact focused selection');
  const selection = selectFocusedIosTests(profile, file, name);
  const baseSha = process.env.OROT_CANDIDATE_BASE_SHA;
  const headSha = process.env.GITHUB_SHA;
  const paths = candidateChangedPaths(baseSha, headSha);
  const impacts = verifyFocusedCandidateImpact(paths, selection);
  mkdirSync(resolve(output, '..'), { recursive: true });
  writeFileSync(
    output,
    JSON.stringify(
      {
        baseSha,
        headSha,
        runId: process.env.GITHUB_RUN_ID,
        attempt: process.env.GITHUB_RUN_ATTEMPT,
        paths,
        impacts,
        ...selection,
        cohorts: focusedIosTestCohorts(selection),
        fullValidation: false,
      },
      null,
      2,
    ) + '\n',
  );
}
