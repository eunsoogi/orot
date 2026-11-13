type SyntheticStage =
  | 'database'
  | 'preview-boundary'
  | 'preview-prepare'
  | 'preview-stream'
  | 'request-identity'
  | 'lease-check'
  | 'probe-read'
  | 'await-release'
  | 'commit-candidate';

/** Report only fixed synthetic stages and a typed outcome, never underlying errors. */
export async function runSyntheticStages<T>(
  publish: (value: string) => void,
  run: (mark: (stage: SyntheticStage) => void) => Promise<T>,
): Promise<T> {
  let stage: SyntheticStage = 'database';
  try {
    return await run(next => {
      stage = next;
      publish(`stage:${stage} result:entered`);
    });
  } catch (error) {
    publish(`stage:${stage} result:exception`);
    throw error;
  }
}
