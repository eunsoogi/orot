import { t } from '../i18n';

/**
 * Preserve the feature's semantic copy names while resolving each value from
 * the shared typed catalog at access time; this adapter contains no locale text.
 */
export const medicalAppointmentCopy = {
  get title() {
    return t('medicalAppointments.title');
  },
  get description() {
    return t('medicalAppointments.description');
  },
  get queryLimit() {
    return t('medicalAppointments.queryLimit');
  },
  get incompleteCalendar() {
    return t('medicalAppointments.incompleteCalendar');
  },
  get localNotice() {
    return t('medicalAppointments.localNotice');
  },
  get remoteNotice() {
    return t('medicalAppointments.remoteNotice');
  },
  get loadCalendar() {
    return t('medicalAppointments.actions.loadCalendar');
  },
  get classify() {
    return t('medicalAppointments.actions.classify');
  },
  get manual() {
    return t('medicalAppointments.actions.manual');
  },
  get loading() {
    return t('medicalAppointments.status.loading');
  },
  get classifying() {
    return t('medicalAppointments.status.classifying');
  },
  get noCandidates() {
    return t('medicalAppointments.status.noCandidates');
  },
  get permissionUnavailable() {
    return t('medicalAppointments.status.permissionUnavailable');
  },
  get providerUnavailable() {
    return t('medicalAppointments.status.providerUnavailable');
  },
  get noProvider() {
    return t('medicalAppointments.status.noProvider');
  },
  get emptyCoverage() {
    return t('medicalAppointments.status.emptyCoverage');
  },
  get manualReview() {
    return t('medicalAppointments.status.manualReview');
  },
  get notClassified() {
    return t('medicalAppointments.status.notClassified');
  },
  get save() {
    return t('medicalAppointments.actions.save');
  },
  get saving() {
    return t('medicalAppointments.actions.saving');
  },
  get saved() {
    return t('medicalAppointments.status.saved');
  },
  get stale() {
    return t('medicalAppointments.status.stale');
  },
  get saveError() {
    return t('medicalAppointments.status.saveError');
  },
  get resultNotice() {
    return t('medicalAppointments.resultNotice');
  },
  get uncertainty() {
    return t('medicalAppointments.uncertainty');
  },
  get reason() {
    return t('medicalAppointments.reason');
  },
  get unclassified() {
    return t('medicalAppointments.unclassified');
  },
  coverage(returned: number, classified: number) {
    return t('medicalAppointments.coverage', { returned, classified });
  },
  get labels() {
    return {
      medical: t('medicalAppointments.labels.medical'),
      non_medical: t('medicalAppointments.labels.nonMedical'),
      uncertain: t('medicalAppointments.labels.uncertain'),
      low: t('medicalAppointments.labels.low'),
      medium: t('medicalAppointments.labels.medium'),
      high: t('medicalAppointments.labels.high'),
    };
  },
};
