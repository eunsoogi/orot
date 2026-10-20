import type { OutboundProcessingRequest } from '@orot/agent-runtime';
import { t } from '../../i18n';

const purposes = {
  calendar_classification:
    'medicalAppointments.inferenceDisclosure.forCalendar',
  symptom_summary: 'medicalAppointments.inferenceDisclosure.forSummary',
  disease_hypotheses: 'medicalAppointments.inferenceDisclosure.forHypotheses',
  record_conversation:
    'medicalAppointments.inferenceDisclosure.forConversation',
  visit_questions: 'medicalAppointments.inferenceDisclosure.forVisit',
  public_medical_search: 'medicalAppointments.inferenceDisclosure.forSearch',
} as const;
const categories = {
  calendar_title_time: 'medicalAppointments.inferenceDisclosure.calendar',
  health_records: 'medicalAppointments.inferenceDisclosure.healthRecords',
  reviewed_memory: 'medicalAppointments.inferenceDisclosure.memory',
  conversation: 'medicalAppointments.inferenceDisclosure.conversation',
  visit_title_time: 'medicalAppointments.inferenceDisclosure.visit',
  medical_literature: 'medicalAppointments.inferenceDisclosure.literature',
  medical_search_terms: 'medicalAppointments.inferenceDisclosure.searchTerms',
} as const;

/** Explain the durable permission boundary, while the expandable preview still shows this exact request. */
export function inferenceConsentCopy(request: OutboundProcessingRequest) {
  const purpose = request.consentScope?.purpose;
  const key =
    purpose && Object.hasOwn(purposes, purpose)
      ? purposes[purpose as keyof typeof purposes]
      : undefined;
  const labels = request.consentScope?.dataCategories.map(category =>
    Object.hasOwn(categories, category)
      ? t(categories[category as keyof typeof categories])
      : t('medicalAppointments.inferenceDisclosure.records'),
  );
  return {
    subtitle: t(key ?? 'medicalAppointments.inferenceDisclosure.subtitle'),
    information: labels?.length
      ? [...new Set(labels)].join(' · ')
      : t('medicalAppointments.inferenceDisclosure.records'),
    publicSearch: purpose === 'public_medical_search',
  };
}
