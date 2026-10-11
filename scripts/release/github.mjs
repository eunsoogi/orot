import { readApplicationVersion } from './application-version.mjs';
import {
  isCommitAncestor,
  listRepositoryTags,
  readGitHubJson,
  readMainSha,
  readRelease,
  readTagTarget,
} from './github-api.mjs';
import {
  collectJobsForMainPushes,
  latestMainPushRuns,
  listWorkflowRunsForSourcePushes,
  readWorkflowRunJobs,
} from './ci.mjs';
import { readCommitList } from './changelog.mjs';
import { isReleaseVersion, selectPreviousVersionTag } from './version-tags.mjs';

const REPOSITORY = 'eunsoogi/orot';
const FULL_SHA = /^[0-9a-f]{40}$/i;

// Build one candidate from the dispatch SHA plus live version, main, CI, tag, and release reads.
export function collectReleaseContext(env = process.env) {
  if (env.GITHUB_REPOSITORY !== REPOSITORY)
    throw new Error(`release workflow is restricted to ${REPOSITORY}`);
  const mode = env.OROT_RELEASE_MODE ?? '';
  if (!['dry-run', 'publish'].includes(mode))
    throw new Error('release mode must be dry-run or publish');
  const version = env.OROT_VERSION ?? '';
  if (!isReleaseVersion(version))
    throw new Error(
      'release version must use MAJOR.MINOR.PATCH without a v prefix or prerelease suffix',
    );
  const sourceSha = env.GITHUB_SHA ?? '';
  if (!FULL_SHA.test(sourceSha)) throw new Error('workflow candidate must be a full commit SHA');
  if (env.GITHUB_REF !== 'refs/heads/main')
    throw new Error('release workflow must be dispatched from main');

  const applicationVersion = readApplicationVersion();
  const currentMainSha = readMainSha(REPOSITORY);
  const workflowRuns = listWorkflowRunsForSourcePushes(REPOSITORY, sourceSha, readGitHubJson);
  const latestRuns = latestMainPushRuns(sourceSha, workflowRuns);
  const ciRun = latestRuns.find((run) => run.path === '.github/workflows/e2e-test.yml') ?? null;
  const ciJobs = collectJobsForMainPushes(sourceSha, workflowRuns, (runId) =>
    readWorkflowRunJobs(REPOSITORY, runId, readGitHubJson),
  );

  const tags = listRepositoryTags(REPOSITORY);
  const previousTag = selectPreviousVersionTag({
    version,
    tags,
    resolveTag: (name) => readTagTarget(REPOSITORY, name),
    isAncestor: (sha) => isCommitAncestor(REPOSITORY, sha, sourceSha),
  });
  const commits = readCommitList(sourceSha, previousTag?.sha ?? null);
  const tagTargetSha = readTagTarget(REPOSITORY, version);
  const release = readRelease(REPOSITORY, version);

  return {
    mode,
    version,
    applicationVersion,
    tag: version,
    ref: env.GITHUB_REF,
    sha: sourceSha.toLowerCase(),
    sourceSha: sourceSha.toLowerCase(),
    currentMainSha,
    ciRun,
    ciJobs,
    previousTag,
    commits,
    tagTargetSha,
    release,
  };
}
