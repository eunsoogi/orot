type ApprovedResult = Readonly<{
  id: string;
  output: string;
  current: () => boolean;
  reproveSource: () => Promise<boolean>;
}>;

type StagedResult = Readonly<Pick<ApprovedResult, 'id' | 'output'>>;
type ReadProof = Readonly<{ current: () => boolean; dispose: () => void }>;
type Admission = Readonly<{ signal: AbortSignal; proof: ReadProof }>;

/** Stage an approved result set without exposing any member. All source checks
 * belong to one guarded read owner, whose lease covers the complete admission
 * interval. This is a local point-in-time proof, not remote delivery. */
export function stageLiveResponsesResults(
  input: Admission & {
    readonly results: readonly ApprovedResult[];
  },
) {
  const { signal, proof } = input;
  let staged: readonly ApprovedResult[] | undefined = Object.freeze(
    input.results.map(result => Object.freeze({ ...result })),
  );
  let consumed = false;
  let disposed = false;
  const clear = () => {
    staged = undefined;
    signal.removeEventListener('abort', retire);
  };
  const retire = () => {
    clear();
    if (disposed) return;
    disposed = true;
    proof.dispose();
  };
  if (signal.aborted) retire();
  else signal.addEventListener('abort', retire, { once: true });
  if (
    !staged?.length ||
    staged.some(
      ({ id, output }) =>
        typeof id !== 'string' ||
        !id ||
        id.length > 256 ||
        typeof output !== 'string' ||
        !output,
    ) ||
    new Set(staged.map(({ id }) => id)).size !== staged.length
  )
    retire();
  return {
    retire,
    async admit(
      handoff: (approved: readonly StagedResult[]) => Promise<unknown>,
    ) {
      const candidate = staged;
      if (!candidate || consumed) return;
      consumed = true;
      const current = () =>
        staged === candidate &&
        !signal.aborted &&
        proof.current() &&
        candidate.every(result => result.current()) &&
        proof.current();
      try {
        for (const result of candidate) {
          if (!current() || !(await result.reproveSource()) || !current())
            return;
        }
        // Snapshot the exact approved bytes in caller order and pass only once.
        const approved = Object.freeze(
          candidate.map(({ id, output }) => Object.freeze({ id, output })),
        );
        if (!current()) return;
        clear();
        await handoff(approved);
      } finally {
        retire();
      }
    },
  };
}

/** Current Live transport deliberately consumes the same local proof for one result. */
export function stageLiveResponsesResult(input: ApprovedResult & Admission) {
  const { signal, proof, ...result } = input;
  const batch = stageLiveResponsesResults({ signal, proof, results: [result] });
  return {
    admit: (handoff: (approved: string) => Promise<unknown>) =>
      batch.admit(async ([approved]) => {
        if (approved) await handoff(approved.output);
      }),
  };
}
