import type { JsonObject } from '@orot/model-runtime';

const QUESTION_SCHEMA: JsonObject = {
  type: 'object',
  additionalProperties: false,
  required: ['questionText', 'rationale', 'priority', 'evidenceIds'],
  properties: {
    questionText: {
      type: 'string',
      minLength: 2,
      maxLength: 300,
      description:
        'One Korean question naming the cited record item and its observed change or unresolved uncertainty. Include source-supported values or times only when they make the question specific. End with exactly one question mark.',
    },
    rationale: {
      type: 'string',
      minLength: 2,
      maxLength: 400,
      description:
        'One concise Korean sentence explaining the cited observation or change that supports the question. Do not include evidence IDs in prose.',
    },
    priority: { enum: ['routine', 'important'] },
    evidenceIds: {
      type: 'array',
      minItems: 1,
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
  'Name the record item in each question and connect the observation to a judgment the clinician can clarify. Even an observation-plan question must make its supporting record identifiable.',
  'Avoid generic questions that could apply to anyone, vague questions about adequate sleep duration, and repetitions of the same general question.',
  'A single measurement or partial search does not establish abnormality, increase, decrease or trend. Describe a change only with comparable times and conditions; otherwise identify the unresolved uncertainty.',
  'Use only the supplied appointment context and evidence. Never invent facts, normal ranges or abnormality thresholds.',
  'Ranked records are a partial search sample, not a complete history or medication list. Do not infer absence from omitted results.',
  'Do not suggest a diagnosis, give treatment instructions, or recommend starting, stopping or changing a medication dose.',
  'Turn uncertainty into a question for the clinician instead of asserting a conclusion. Request clarification rather than inventing questions when important conflicts or insufficient evidence prevent supported questions.',
  'Write each question as one concise Korean interrogative ending with exactly one question mark. Ask what to discuss or observe next, not whether a past fact was already checked or reflected.',
  'questionText and rationale must each be one concise Korean sentence. Keep IDs only in evidenceIds and citations, never question or rationale prose.',
  'Include values and times only as supported by the exact cited records, and only when they make the question specific.',
  'Attach one to three supplied evidenceId strings that actually support each question.',
  'If necessary evidence is missing, call the supplied local search tools. An unperformed search is not an empty search result. Inspect returned results before answering.',
  'When important record conflicts are already visible, return needs_clarification instead of using further search to arbitrarily select one side.',
  'Return the final envelope with type=result, value and citations. citations must be the deduplicated union of IDs actually used by the questions, without unused IDs.',
  'Do not ask the user whether existing records exist. Ask about their meaning for clinical discussion, changes to observe and records to prepare before the next visit.',
  'Return only the specified JSON format.',
].join('\n');
