// Feature exports keep app routing injectable while the parent owns App.tsx integration.
export { default as MedicalAppointmentClassificationScreen } from './MedicalAppointmentClassificationScreen';
export { default as ManualAppointmentScreen } from './ManualAppointmentScreen';
export { classifyCalendarEvents } from './classificationWorkflow';
export {
  CALENDAR_QUERY_EVENT_LIMIT,
  CALENDAR_QUERY_HORIZON_YEARS,
  MAX_CLASSIFICATION_EVIDENCE_ITEMS,
  createCalendarEvidenceBatch,
  readUpcomingCalendarCandidates,
} from './calendarEvidence';
export type {
  CalendarCandidateSet,
  CalendarEvidenceBatch,
} from './calendarEvidence';
export { createAppointmentClassificationTask } from './classificationTask';
export type {
  CandidateReview,
  ClassifyCalendarEventsInput,
  ClassificationExecutionServices,
  ClassificationRunResult,
} from './classificationWorkflow';
export type {
  AppointmentClassification,
  AppointmentClassificationResult,
  ClassificationUncertainty,
  MedicalRelevance,
} from './classificationTask';
