/** These stable permissions describe a feature's data boundary, not a particular record or model reply. */
export const calendarConsentScope = {
  purpose: 'calendar_classification',
  dataCategories: ['calendar_title_time'],
  policyVersion: 'upcoming-year-v1',
} as const;

export const visitConsentScope = {
  purpose: 'visit_questions',
  dataCategories: ['health_records', 'reviewed_memory', 'visit_title_time'],
  policyVersion: 'local-records-v1',
} as const;

export const publicMedicalSearchConsentScope = {
  purpose: 'public_medical_search',
  dataCategories: ['medical_search_terms'],
  policyVersion: 'public-query-v1',
} as const;
