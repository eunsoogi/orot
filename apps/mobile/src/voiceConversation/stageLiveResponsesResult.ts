/** Private one-use owner for an already approved result. Nothing is sent by
 * staging, and the source proof ends at local admission, not network delivery. */
export function stageLiveResponsesResult(input: {
  readonly output: string;
  readonly signal: AbortSignal;
  readonly current: () => boolean;
  readonly reproveSource: () => Promise<boolean>;
}) {
  const { signal } = input;
  let staged: typeof input | undefined = input;
  let consumed = false;
  const retire = () => {
    staged = undefined;
    signal.removeEventListener('abort', retire);
  };
  if (signal.aborted) retire();
  else signal.addEventListener('abort', retire, { once: true });
  return {
    retire,
    async admit(handoff: (approved: string) => Promise<unknown>) {
      const candidate = staged;
      if (!candidate || consumed) return;
      consumed = true;
      const current = () =>
        staged === candidate && !signal.aborted && candidate.current();
      try {
        if (!current() || !(await candidate.reproveSource()) || !current())
          return;
        retire();
        await handoff(candidate.output);
      } finally {
        retire();
      }
    },
  };
}
