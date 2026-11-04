import type { JsonObject } from '@orot/model-runtime';

const QUESTION_SCHEMA: JsonObject = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'questionText', 'rationale', 'priority', 'evidenceIds'],
  properties: {
    kind: { enum: ['confirmed_fact', 'clarification'] },
    questionText: {
      type: 'string',
      minLength: 2,
      maxLength: 300,
      description:
        'For confirmed_fact, name the cited observation or uncertainty. For clarification, copy a question from the app-owned list. End with exactly one question mark.',
    },
    rationale: {
      type: 'string',
      minLength: 2,
      maxLength: 400,
      description:
        'For confirmed_fact, explain the cited observation. For clarification, copy its paired app-owned rationale. Do not include evidence IDs in prose.',
    },
    priority: { enum: ['routine', 'important'] },
    evidenceIds: {
      type: 'array',
      minItems: 0,
      maxItems: 3,
      uniqueItems: true,
      items: { type: 'string', minLength: 1 },
    },
  },
};

/** Only source-linked question drafts or a clarification request may leave this task responder. */
export const visitQuestionResultSchema: JsonObject = {
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      required: ['status', 'questions'],
      properties: {
        status: { const: 'suggestions' },
        questions: {
          type: 'array',
          minItems: 3,
          maxItems: 5,
          items: QUESTION_SCHEMA,
        },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['status', 'message'],
      properties: {
        status: { const: 'needs_clarification' },
        message: { type: 'string', minLength: 2, maxLength: 400 },
      },
    },
  ],
};

export const visitQuestionSystemPrompt = [
  'Draft three questions a patient can ask their clinician at the next outpatient visit.',
  'Identify specific health items, observed changes, recurring symptoms and explicitly recorded abnormalities in the actual cited records. Prioritize questions with meaningful implications for that visit.',
  'For each confirmed_fact question, name its record item and connect the observation to a judgment the clinician can clarify.',
  'Choose distinct questions most relevant to this visit; avoid vague questions about adequate sleep duration and repetitive questions.',
  'A single measurement or partial search does not establish abnormality, increase, decrease or trend. Describe a change only with comparable times and conditions; otherwise identify the unresolved uncertainty.',
  'Use only the supplied appointment context and evidence. Never invent facts, normal ranges or abnormality thresholds.',
  'Ranked records are a partial search sample, not a complete history or medication list. Do not infer absence from omitted results.',
  'Do not suggest a diagnosis, give treatment instructions, or recommend starting, stopping or changing a medication dose.',
  'Distinguish confirmed_fact questions supported by cited records from clarification questions asking the clinician for missing information. Clarification questions must not assert unrecorded personal facts and must have no evidenceIds. Do not choose one side of a conflict as fact.',
  'For clarification questions select distinct questionText and rationale pairs exactly from the app-owned list in the user message, choosing the most useful gaps.',
  'Write each question as one concise Korean interrogative ending with exactly one question mark. Ask what to discuss or observe next, not whether a past fact was already checked or reflected.',
  'questionText and rationale must each be one concise Korean sentence. Keep IDs only in evidenceIds and citations, never question or rationale prose.',
  'Include values and times only as supported by the exact cited records, and only when they make the question specific.',
  'Attach one to three supplied evidenceId strings to each confirmed_fact question; attach none to a clarification question.',
  'If necessary evidence is missing, call the supplied local search tools. An unperformed search is not an empty search result. Inspect returned results before answering.',
  'For broad visit preparation, prefer local-health-context when available: inspect bounded period context across medications, measurements, activity, sleep and symptoms, using weekly or daily detail when needed to establish actual changes. Raw ranked samples alone cannot establish a longitudinal trend. Use raw search for a specific original or an unresolved detail, not as a substitute for available period coverage.',
  'Read medication registration, current-use confirmation and dose events as distinct facts; an absent schedule does not negate recorded doses. Use the app-computed sleep durations and stage labels, never interpret a raw category code as duration. Preserve missing-day and overlapping-sensor limits. Ask about a meaningful supported change or practical uncertainty, not the meaning of an internal code or a comparison between nearly identical adjacent samples.',
  'Read medication scheduleStatus and useEvidence explicitly: not_registered is a known absent Health schedule, not unavailable schedule information. Acknowledge recorded dose events or user-confirmed use; never frame documented use as wholly unknown solely because a registered schedule or separate current-use confirmation is absent. Catalog-only or prescription-only evidence does not establish absence of use elsewhere. Do not infer future adherence, missed doses or a prescription from these labels.',
  'Prefer medication questions about an observed change or its relevance to the visit. Do not turn missing administrative confirmation or schedule registration into a generic question asking whether the patient takes an already documented medication; use the other supported clinical observations when they are more relevant.',
  'When records conflict, ask the clinician to clarify the discrepancy without asserting either conflicting value.',
  'Return the final envelope with type=result, value and citations. citations must be an array of strings containing the deduplicated union of IDs actually used by the questions, without unused IDs.',
  'Do not ask the user whether existing records exist. Ask about their meaning for clinical discussion, changes to observe and records to prepare before the next visit.',
  'Return only the specified JSON format.',
].join('\n');
