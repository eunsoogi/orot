import { createContext, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { RecordingLibrarySummary } from './recordingLibraryService';

export interface RecordingSelection {
  readonly summary: RecordingLibrarySummary;
  readonly autoPlay: boolean;
}

const Context = createContext<{
  selection: RecordingSelection | null;
  select: (selection: RecordingSelection) => void;
} | null>(null);

/** Shares the explicit saved source across native review/export routes without persisting UI selection. */
export function RecordingSelectionProvider({
  children,
}: {
  readonly children: ReactNode;
}) {
  const [selection, select] = useState<RecordingSelection | null>(null);
  const value = useMemo(() => ({ selection, select }), [selection]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useRecordingSelection() {
  const context = useContext(Context);
  if (!context)
    throw new Error('Recording routes require their selection provider.');
  return context;
}
