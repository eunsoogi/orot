import type { SymptomJournalRepository } from './localRepository';
import SymptomsScreen from './SymptomsScreen';
import { useSymptomJournal } from './useSymptomJournal';

/** Loads the existing journal inside the app's guarded Records navigation. */
export function SymptomsRoute({
  loadSymptoms,
  onBack,
}: {
  readonly loadSymptoms?: () => Promise<SymptomJournalRepository>;
  readonly onBack: () => void;
}) {
  const journal = useSymptomJournal(loadSymptoms);
  return (
    <SymptomsScreen
      entries={journal.entries}
      filter={journal.filter}
      loading={journal.loading}
      loadError={journal.error}
      canWrite={journal.canWrite}
      onBack={onBack}
      onRetry={journal.retry}
      onFilterChange={journal.changeFilter}
      onCreate={journal.create}
      onUpdate={journal.update}
      onResolve={journal.resolve}
    />
  );
}
