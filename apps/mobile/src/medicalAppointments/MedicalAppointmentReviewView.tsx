import { useState } from 'react';
import { t } from '../i18n';
import { StyleSheet, View } from 'react-native';
import { SelectedModelControl } from '../layout/SelectedModelControl';
import { appColors } from '../layout/appColors';
import { AdaptiveColumns } from '../layout/AdaptiveColumns';
import { useNavigationContentInset } from '../navigation/useNavigationContentInset';
import { NavigationContentTransition } from '../navigation/NavigationContentTransition';
import type { ProviderSelectionOption } from '../providers/selection/types';
import type { CandidateReview } from './classificationWorkflow';
import { ClassificationPagedStage } from './ClassificationPagedStage';
import {
  formatCalendarEventCompactRange,
  formatCalendarEventRange,
} from '../calendar/dateTime';
import { ClassificationResultsStage } from './ClassificationResultsStage';
import { ClassificationProgress } from './ClassificationProgress';
import { medicalAppointmentCopy as copy } from './copy.ko';
import { isConfidentMedical } from './saveCalendarCandidate';

interface Props {
  readonly provider: ProviderSelectionOption | null;
  readonly providerUnavailable: boolean;
  readonly providerReady: boolean;
  readonly loading: boolean;
  readonly calendarLoading: boolean;
  readonly calendarUnavailable: boolean;
  readonly classifying: boolean;
  readonly completed?: boolean;
  readonly accessAvailable: boolean;
  readonly queryComplete: boolean;
  readonly message: string;
  readonly eventCount: number;
  readonly candidates: readonly CandidateReview[];
  readonly savingId: string | null;
  readonly savedIds: ReadonlySet<string>;
  readonly onImport: () => Promise<void>;
  readonly onOpenCalendarSettings?: () => void;
  readonly onOpenProviderSelection?: () => void;
}

/** Three full-height stages share one native usable region; only validated results enter the final stage. */
export function MedicalAppointmentReviewView(props: Props) {
  const inset = useNavigationContentInset();
  const [confirmAgain, setConfirmAgain] = useState(false);
  const busy = props.loading || props.classifying || props.savingId !== null;
  const complete = props.completed ?? props.candidates.length > 0;
  const stage = busy
    ? 'progress'
    : complete && !confirmAgain
      ? 'results'
      : 'confirmation';
  const classified = props.candidates.filter(
    item => item.status === 'classified',
  ).length;
  const medical = props.candidates.filter(isConfidentMedical);
  const unavailable =
    props.providerUnavailable ||
    props.provider?.availability.status === 'unavailable';
  const start = () => {
    setConfirmAgain(false);
    props.onImport();
  };
  const confirmation = {
    title: t('medicalAppointments.confirmClassification'),
    supporting: copy.description,
    privacy:
      props.provider?.privacyBoundary === 'on-device'
        ? copy.localNotice
        : copy.remoteNotice,
    warning: [unavailable ? copy.providerUnavailable : '', props.message]
      .filter(Boolean)
      .join('\n'),
  };
  const resultSummary = copy.coverage(props.eventCount, classified);
  const resultNotice = [
    props.message,
    !props.queryComplete ? copy.incompleteCalendar : '',
  ]
    .filter(Boolean)
    .join('\n');
  const content =
    stage === 'progress' ? (
      <View style={styles.center}>
        <ClassificationProgress
          classified={classified}
          total={props.eventCount}
          saving={props.savingId !== null}
        />
      </View>
    ) : stage === 'confirmation' ? (
      <ClassificationPagedStage
        key="confirmation"
        testID="medical-appointment-confirmation"
        documents={[Object.values(confirmation).filter(Boolean).join('\n\n')]}
        caption={confirmation}
        actionTitle={t('medicalAppointments.startShort')}
        actionLabel={copy.loadCalendar}
        onAction={start}
        disabled={
          !props.providerReady ||
          props.calendarLoading ||
          props.calendarUnavailable
        }
        supplementaryAction={
          props.calendarUnavailable && props.onOpenCalendarSettings
            ? {
                title: copy.calendarSettings,
                onPress: props.onOpenCalendarSettings,
              }
            : undefined
        }
      />
    ) : (
      <ClassificationResultsStage
        key="results"
        rows={medical.map(candidate => ({
          id: candidate.candidateId,
          title: candidate.event.calendarEventSnapshot.title,
          when: formatCalendarEventCompactRange(candidate.event),
          category: copy.labels[candidate.classification!],
          details: [
            {
              label: t('medicalAppointments.detailTitle'),
              value: candidate.event.calendarEventSnapshot.title,
            },
            {
              label: t('medicalAppointments.detailDateTime'),
              value: formatCalendarEventRange(candidate.event),
            },
            {
              label: t('medicalAppointments.detailCategory'),
              value: copy.labels[candidate.classification!],
            },
            ...(candidate.reason
              ? [{ label: copy.reason, value: candidate.reason }]
              : []),
            ...(candidate.uncertainty
              ? [
                  {
                    label: copy.uncertainty,
                    value: copy.labels[candidate.uncertainty],
                  },
                ]
              : []),
            ...(props.savedIds.has(candidate.candidateId)
              ? [
                  {
                    label: t('medicalAppointments.resultStatus'),
                    value: copy.saved,
                  },
                ]
              : []),
          ],
        }))}
        summary={resultSummary}
        notice={medical.length ? resultNotice : resultNotice || copy.noMedical}
        restart={() => setConfirmAgain(true)}
      />
    );
  return (
    <View
      testID="medical-appointment-fullscreen"
      style={[styles.screen, inset]}
    >
      <AdaptiveColumns
        testID="medical-appointment-columns-frame"
        primary={
          <View style={styles.lane} testID="medical-appointment-columns">
            <SelectedModelControl
              name={props.provider?.displayName ?? copy.chooseProvider}
              nameNumberOfLines={1}
              local={props.provider?.privacyBoundary === 'on-device'}
              onPress={props.onOpenProviderSelection}
              label={`${t('medicalAppointments.chooseClassifier')}: ${props.provider?.displayName ?? copy.chooseProvider}`}
              testID="medical-appointment-select-provider"
            />
            <NavigationContentTransition transitionKey={stage}>
              {content}
            </NavigationContentTransition>
          </View>
        }
      />
    </View>
  );
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: appColors.background },
  lane: { flex: 1, flexDirection: 'column', paddingHorizontal: 24 },
  center: { flex: 1, minHeight: 0 },
});
