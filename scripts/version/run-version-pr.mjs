import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createVersionPullRequest, readRemoteVersionPrState } from './github-pr.mjs';
import {
  assertMainDispatch,
  classifyExistingVersionPr,
  planVersionUpdate,
  versionPrDetails,
} from './metadata.mjs';

const root = process.env.GITHUB_WORKSPACE ?? process.cwd();
const repository = process.env.GITHUB_REPOSITORY ?? '';
const version = process.env.OROT_VERSION ?? '';

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8' });
  if (result.error || result.status !== 0) {
    const detail = result.error?.message ?? result.stderr?.trim() ?? `exit ${result.status}`;
    throw new Error(`${command} ${args[0] ?? ''} failed: ${detail}`.trim());
  }
  return result;
}

function readJsonSource(relativePath) {
  return readFileSync(resolve(root, relativePath), 'utf8');
}

function readWorkspaceManifests() {
  const packagesRoot = resolve(root, 'packages');
  return readdirSync(packagesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `packages/${entry.name}/package.json`)
    .filter((path) => existsSync(resolve(root, path)))
    .map((path) => ({ path, source: readJsonSource(path) }));
}

function createPlan() {
  return planVersionUpdate({
    version,
    rootManifestSource: readJsonSource('package.json'),
    mobileManifestSource: readJsonSource('apps/mobile/package.json'),
    workspaceManifests: readWorkspaceManifests(),
    projectFile: readFileSync(
      resolve(root, 'apps/mobile/ios/OrotMobile.xcodeproj/project.pbxproj'),
      'utf8',
    ),
  });
}

function recordOutput(values) {
  if (!process.env.GITHUB_OUTPUT) return;
  const rows = Object.entries(values).map(([key, value]) => `${key}=${value}`);
  appendFileSync(process.env.GITHUB_OUTPUT, `${rows.join('\n')}\n`);
}

function dispatchPlan() {
  assertMainDispatch({ eventName: process.env.GITHUB_EVENT_NAME, ref: process.env.GITHUB_REF });
  const plan = createPlan();
  recordOutput({ status: plan.status, version, current_version: plan.currentVersion });
  return plan;
}

function verifyMainCheckout() {
  assertMainDispatch({ eventName: process.env.GITHUB_EVENT_NAME, ref: process.env.GITHUB_REF });
  if (repository !== 'eunsoogi/orot')
    throw new Error('version PR workflow is restricted to eunsoogi/orot');

  const branch = run('git', ['branch', '--show-current']).stdout.trim();
  if (branch !== 'main')
    throw new Error(`expected a main checkout, found ${branch || 'detached HEAD'}`);
  const head = run('git', ['rev-parse', 'HEAD']).stdout.trim();
  const remoteMain = run('git', ['rev-parse', 'refs/remotes/origin/main']).stdout.trim();
  if (head !== remoteMain)
    throw new Error('main moved during dispatch; rerun the workflow against current main');
  if (run('git', ['status', '--porcelain']).stdout.trim()) {
    throw new Error('refusing to create a version PR from a dirty checkout');
  }
}

function applyPlan(plan, branch) {
  const changedPaths = [];
  for (const update of plan.updates) {
    const filePath = resolve(root, update.path);
    const previous = readFileSync(filePath, 'utf8');
    if (previous === update.content) continue;
    writeFileSync(filePath, update.content);
    changedPaths.push(update.path);
  }
  if (changedPaths.length === 0) throw new Error('version plan contained no file changes');

  run('git', ['switch', '--create', branch]);
  run('git', ['add', '--', ...changedPaths]);
  const staged = run('git', ['diff', '--cached', '--name-only'])
    .stdout.trim()
    .split('\n')
    .filter(Boolean)
    .sort();
  if (JSON.stringify(staged) !== JSON.stringify([...changedPaths].sort())) {
    throw new Error('staged files differ from the version update plan; refusing to commit');
  }
  run('git', [
    '-c',
    'user.name=github-actions[bot]',
    '-c',
    'user.email=41898282+github-actions[bot]@users.noreply.github.com',
    'commit',
    '-m',
    `chore: update version to ${version}`,
  ]);

  try {
    run('git', ['push', '--set-upstream', 'origin', branch]);
  } catch (error) {
    const remote = readRemoteVersionPrState(repository, branch);
    const classified = classifyExistingVersionPr({ ...remote, repository, version });
    if (classified.action === 'reuse') return classified.url;
    throw new Error(`push failed and ${branch} now conflicts with another ref: ${error.message}`);
  }
  return null;
}

async function main() {
  if (process.argv.includes('--validate-only')) {
    const plan = dispatchPlan();
    console.log(
      plan.status === 'current'
        ? `Version ${version} is already current.`
        : `Version ${version} is ready for review.`,
    );
    return;
  }

  verifyMainCheckout();
  const plan = createPlan();
  if (plan.status === 'current') {
    recordOutput({ status: 'current', version, current_version: plan.currentVersion });
    console.log(`Version ${version} is already current; no PR was created.`);
    return;
  }

  const details = versionPrDetails(version);
  const remote = readRemoteVersionPrState(repository, details.branch);
  const classified = classifyExistingVersionPr({ ...remote, repository, version });
  if (classified.action === 'reuse') {
    recordOutput({
      status: 'reused',
      version,
      current_version: plan.currentVersion,
      pull_request: classified.url,
    });
    console.log(`Reusing matching version PR: ${classified.url}`);
    return;
  }

  const concurrentPullRequest = applyPlan(plan, details.branch);
  if (concurrentPullRequest) {
    recordOutput({
      status: 'reused',
      version,
      current_version: plan.currentVersion,
      pull_request: concurrentPullRequest,
    });
    console.log(`Reusing matching version PR: ${concurrentPullRequest}`);
    return;
  }
  const pullRequest = createVersionPullRequest(repository, details, version);
  recordOutput({
    status: 'created',
    version,
    current_version: plan.currentVersion,
    pull_request: pullRequest,
  });
  console.log(`Created draft version PR: ${pullRequest}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
