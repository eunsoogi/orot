import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { EncounterPending } from '@orot/agent-runtime';
import { AppButton } from '../layout/AppButton';
import { AppText } from '../layout/AppText';
import { MaterialLibraryRows } from '../layout/MaterialLibraryRows';
import { t } from '../i18n';
import type { EncounterReviewController, ReviewState } from './controller';
import { CandidatePanel } from './CandidatePanel';

const longPageSize = 12;

/** Keep selection and edits in the one completed review, not in the visible page. */
export function EncounterCandidatePages({
  pending,
  state,
  controller,
  disabled,
}: {
  pending: EncounterPending;
  state: ReviewState;
  controller: EncounterReviewController;
  disabled: boolean;
}) {
  const [page, setPage] = useState(0);
  const total = state.candidates.length;
  const pageSize = total > 32 ? longPageSize : 32;
  const lastPage = Math.max(0, Math.ceil(total / pageSize) - 1);
  const current = Math.min(page, lastPage);
  const start = current * pageSize;
  const candidates = state.candidates.slice(start, start + pageSize);
  return (
    <View style={styles.pages}>
      {lastPage > 0 ? (
        <>
          <AppText accessibilityLiveRegion="polite">
            {t('encounterReview.candidatePage', {
              first: String(start + 1),
              last: String(start + candidates.length),
              total: String(total),
              selected: String(state.selected.length),
            })}
          </AppText>
          {current > 0 ? (
            <AppButton
              title={t('encounterReview.previousCandidates')}
              variant="secondary"
              disabled={disabled}
              testID="encounter-candidates-previous"
              onPress={() => setPage(current - 1)}
            />
          ) : null}
          {current < lastPage ? (
            <AppButton
              title={t('encounterReview.nextCandidates')}
              variant="secondary"
              disabled={disabled}
              testID="encounter-candidates-next"
              onPress={() => setPage(current + 1)}
            />
          ) : null}
        </>
      ) : null}
      <MaterialLibraryRows testID="encounter-candidate-list">
        {candidates.map((candidate, index) => (
          <CandidatePanel
            key={candidate.id}
            candidate={candidate}
            pending={pending}
            divider={index < candidates.length - 1}
            selected={state.selected.includes(candidate.id)}
            onToggle={() => controller.toggle(candidate.id, pending)}
            onEdit={(field, text) =>
              controller.edit(candidate.id, field, text, pending)
            }
          />
        ))}
      </MaterialLibraryRows>
    </View>
  );
}

const styles = StyleSheet.create({ pages: { gap: 12 } });
