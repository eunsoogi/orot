import { useEffect, useState } from 'react';
import { AppButton } from '../layout/AppButton';
import { AppText } from '../layout/AppText';
import { formatDateTime, t } from '../i18n';
import { listSavedTreatment } from './treatmentSavedLibrary';
import type { SavedTreatmentChoice } from './treatmentSavedLibrary';
import { listTreatmentSourceChoices } from './treatmentSourceChoices';
import type { TreatmentSourceChoice } from './treatmentSourceChoices';

export function openTreatmentDatabase() {
  // Only an explicit local action loads the native adapter.
  const storage =
    require('../storage/secureDatabase') as typeof import('../storage/secureDatabase');
  return storage.openLocalAgentMemoryDatabase();
}

export function treatmentSourceLabel(choice: TreatmentSourceChoice) {
  const key =
    choice.status === 'ai_possibility'
      ? 'treatmentSafety.sourcePossibility'
      : choice.status === 'clinician_recorded'
        ? 'treatmentSafety.sourceClinician'
        : 'treatmentSafety.sourceReported';
  return t(key);
}

type Choices =
  | {
      readonly kind: 'sources';
      readonly items: readonly TreatmentSourceChoice[];
    }
  | { readonly kind: 'saved'; readonly items: readonly SavedTreatmentChoice[] };

/** Display record labels or saved metadata only. Opening answer text is a separate verified action. */
export function TreatmentLibraryChoices({
  mode,
  onSource,
  onSaved,
}: {
  readonly mode: Choices['kind'];
  readonly onSource: (choice: TreatmentSourceChoice) => void;
  readonly onSaved: (choice: SavedTreatmentChoice) => void;
}) {
  const [choices, setChoices] = useState<Choices | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const database = await openTreatmentDatabase();
        if (controller.signal.aborted) return;
        const result: Choices =
          mode === 'sources'
            ? {
                kind: 'sources',
                items: await listTreatmentSourceChoices(
                  database,
                  controller.signal,
                ),
              }
            : { kind: 'saved', items: await listSavedTreatment(database) };
        if (!controller.signal.aborted) setChoices(result);
      } catch {
        if (!controller.signal.aborted) setFailed(true);
      }
    }
    load();
    return () => controller.abort();
  }, [mode]);
  if (failed)
    return (
      <AppText accessibilityRole="alert">
        {t('treatmentSafety.withheld')}
      </AppText>
    );
  if (!choices) return <AppText>{t('treatmentSafety.checking')}</AppText>;
  if (!choices.items.length)
    return (
      <AppText>
        {t(
          mode === 'sources'
            ? 'treatmentSafety.noSources'
            : 'treatmentSafety.noSaved',
        )}
      </AppText>
    );
  return choices.kind === 'sources'
    ? choices.items.map(choice => (
        <AppButton
          key={choice.key}
          variant="list"
          title={choice.label}
          summary={treatmentSourceLabel(choice)}
          onPress={() => onSource(choice)}
        />
      ))
    : choices.items.map(item => (
        <AppButton
          key={item.id}
          variant="list"
          title={t('treatmentSafety.reopen')}
          summary={formatDateTime(new Date(item.createdAt))}
          onPress={() => onSaved(item)}
        />
      ));
}
