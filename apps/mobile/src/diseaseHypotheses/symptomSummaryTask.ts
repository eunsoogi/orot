import { createSymptomSummarySchema } from './symptomSummarySchema';
import { summaryResponseGuidance } from './summaryEnvelopeCorrection';
import {
  prepareSummaryUncertainty,
  SUMMARY_UNCERTAINTY_REASON,
} from './summaryUncertainty';
import {
  normalizeSummarySections,
  summaryPresentationIssue,
  summaryPresentationCorrection,
  SUMMARY_PRESENTATION_REASONS,
} from './summaryPresentation';
import type { JsonValue } from '@orot/model-runtime';
import type { TaskResponderContract } from '@orot/agent-runtime';
import { extractPartialJsonStringAtPath } from '@orot/agent-runtime';
import {
  validateDiseaseHypothesisResult,
  canPreviewDiseaseHypothesisSummary,
} from './resultValidation';
import {
  MAX_SYMPTOM_SUMMARY_SECTIONS,
  type DiseaseHypothesisAnalysis,
} from './types';
import { providerDiagnostic } from '../providers/diagnostics';
import { reportSummaryEmptySection } from './summaryEmptySectionDiagnostic';
import {
  summaryLanguageIssue,
  summaryLanguageCorrection,
  SUMMARY_LANGUAGE_REASONS,
} from './summaryLanguage';
import {
  applySummaryCoverageNotes,
  summaryCoverageCorrection,
} from './summaryCoverageNotes';
import {
  SUMMARY_FACT_REASONS,
  summaryFactCorrection,
  summaryFactIssue,
} from './summaryFactValidation';

/** A separately selected factual summary never retries or disguises a refused disease assessment. */
export const symptomSummaryTask: TaskResponderContract<DiseaseHypothesisAnalysis> =
  {
    taskType: 'symptom_record_summary',
    taskVersion: '5',
    requiredToolEvidenceKinds: ['personal_record', 'external_medical'],
    // Every revised request below already includes all current facts; keep tool history as receipts.
    nativeToolResultMode: 'evidence_references',
    ...summaryResponseGuidance,
    allowRankedLocalEvidence: true,
    allowBoundedExternalEvidence: true,
    systemPrompt:
      'Summarize explicit facts in saved medication, dose, activity, step-count, health-measurement and symptom records. This is a factual record summary, not a disease assessment. ' +
      'For this broad summary prefer local-health-context with days=30 and detail=summary across all available topics. It aggregates the whole period, not a few recent samples. If unavailable, use the personal-record tool with view=health_overview. Preserve dates, units and recorded-day coverage; describe only supplied comparisons. ' +
      'Use a separate concise section for each available record topic, plus separate medical-context sections, up to eight total. Each cited topic must state concrete supplied facts: medication names, measurement values with units, activity counts, and sleep stages or individual intervals. Never substitute an empty heading or a promise that records follow. A missing source display does not make a normalized amount or unit unavailable. ' +
      'Convert clock times to displayTimeZone, or explicitly label the retained source time zone such as UTC. For step_count, count means steps, not occurrences. Express sleep interval durations readably in minutes and seconds. ' +
      'Medication, activity and measurement records are usable without symptom notes, transcripts or photographs. Present confirmed observations first; do not lead with an empty symptom section or claim all evidence is missing. State limits on subjective symptoms, causes and associations only where relevant. ' +
      'Search activity, steps, blood pressure, heart rate, body mass and sleep as well as medications. Do not make the summary medication-only when other relevant facts are available. ' +
      'Use permitted follow-up searches for missing dates, values or sleep intervals. A partial search does not establish that the app lacks those records or that the user must enter them again. ' +
      'Distinguish current user-confirmed medication use, Health medication registration, prescription records and individual dose completion. Registration alone does not prove a prescription. Missing dose records never mean unknown medication use or missed doses. For health_context use its computed coverage, daily means and comparisons: no raw category codes, no adding sensor step series, and calendar-day sleep union is not a complete night. For raw sleep samples describe the individual interval. Keep evidence IDs in citation arrays, never prose. ' +
      'Use uncertaintyNotes only for actual interpretive limits, as an array of concise Korean notes; omit it or use an empty array when no limit applies. Do not return a scalar uncertainty field or an English placeholder. Include missingData only when it is necessary for this summary and could not be established through permitted searches; otherwise omit it or use an empty array. ' +
      'Do not create a standalone section that only states missing subjective-symptom coverage. When that limit matters and all supplied clinical records are typed non-symptom records, use coverageNotes=["no_symptom_entries_in_supplied_records"] instead; the app verifies this supplied-subset limit and places it in uncertainty. Omit coverageNotes otherwise. ' +
      'The request includes both a personal-record summary and public medical context explaining the recorded concepts. After searching personal records, use the public medical literature tool for related general concepts. Queries must contain only generic medical concepts, never names, identifiers or verbatim private records. ' +
      "Keep record facts and medical context in separate sections. Cite only retrieved publications for medical context. If tool errors, denied consent or insufficient sources prevent completing research, state that actual limitation and do not invent an explanation. Population-level findings never establish this person's diagnosis or cause. " +
      "Do not describe appointment times or locations as symptoms. Do not infer the person's disease, cause, clinical risk or abnormality, or recommend treatment. Distinguish unavailable evidence from negative findings. " +
      'Use exact evidence IDs for every section. Write titles, summaries, uncertaintyNotes and missing information in Korean.',
    resultSchema: createSymptomSummarySchema(),
    createResultSchema: createSymptomSummarySchema,
    createMessages(input) {
      return [
        {
          role: 'user',
          content: JSON.stringify({
            request: input.request,
            // Source timestamps remain exact; the model receives the device's display zone explicitly.
            displayTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            records: input.evidence.items.map(item => ({
              content: item.content,
              evidenceId: item.evidenceId,
              // Final/correction requests rebuild messages without tool history; retain authoritative provenance.
              sourceKind: item.sourceKind,
              effectiveTime: item.effectiveTime,
            })),
            coverage: input.evidence.coverage,
            outputInstructions:
              'Write section titles, summaries, uncertaintyNotes and missingData in Korean. Omit uncertaintyNotes or use an empty array if no actual interpretive limit applies. Group sections by records.sourceKind: personal_record facts and external_medical context must be in separate sections, with supportingEvidence IDs from that kind only. Return contraryEvidence as an empty array. Top-level citations must match the used IDs.',
          }),
        },
      ];
    },
    projectStreamedText(raw) {
      // Show each bounded topic while retaining the unfinished-draft notice and every section's safety guard.
      const summaries = Array.from(
        { length: MAX_SYMPTOM_SUMMARY_SECTIONS },
        (_, index) =>
          extractPartialJsonStringAtPath(raw, [
            'value',
            'sections',
            index,
            'summary',
          ]),
      ).filter(
        (text): text is string =>
          typeof text === 'string' && canPreviewDiseaseHypothesisSummary(text),
      );
      return summaries.length ? summaries.join('\n\n') : undefined;
    },
    correctionInstructionForInvalidResult(reason) {
      if (reason === SUMMARY_UNCERTAINTY_REASON)
        return 'Return uncertaintyNotes as an array of actual limitations written in Korean, or an empty array when none applies. Do not return the old scalar uncertainty field or untranslated placeholders. Keep valid facts and citation IDs unchanged. Do not request new sources.';
      const presentationCorrection = summaryPresentationCorrection(reason);
      if (presentationCorrection) return presentationCorrection;
      const languageCorrection = summaryLanguageCorrection(reason);
      if (languageCorrection) return languageCorrection;
      const coverageCorrection = summaryCoverageCorrection(reason);
      if (coverageCorrection) return coverageCorrection;
      const factCorrection = summaryFactCorrection(reason);
      if (factCorrection) return factCorrection;
      if (reason === 'Keep record facts and medical context separate.')
        return 'Separate personal-record facts and medical context into different sections. Cite personal records for facts and publications for medical context. Use only existing evidence.';
      if (reason === 'Medication registration is not confirmed use.')
        return 'Medication registration alone does not confirm an individual dose. Describe registered medications and explicitly recorded schedules, with any limits on dose confirmation. Use only existing evidence and the specified JSON format.';
      return undefined;
    },
    validateResult(value, input) {
      if (
        !value ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        Object.keys(value).some(
          key => !['sections', 'coverageNotes'].includes(key),
        )
      ) {
        providerDiagnostic('disease', 'validation', 'task_summary_fields');
        return { status: 'invalid', reason: 'Expected summary sections.' };
      }
      // Reuse exact-current-reference and uncertainty validation; the app sets the presentation mode.
      const prepared = prepareSummaryUncertainty(
        (value as Record<string, JsonValue>).sections,
      );
      if (prepared.status === 'invalid') {
        providerDiagnostic(
          'disease',
          'validation',
          'task_summary_uncertainty_notes',
        );
        return { status: 'invalid', reason: SUMMARY_UNCERTAINTY_REASON };
      }
      const validated = validateDiseaseHypothesisResult(
        {
          hypotheses: normalizeSummarySections(prepared.sections, input),
        } as JsonValue,
        input,
        {
          allowEmptyUncertainty: true,
          maxSections: MAX_SYMPTOM_SUMMARY_SECTIONS,
          // Only closed categories reach the opt-in native sink, never raw validation reasons.
          onInvalid: code =>
            providerDiagnostic('disease', 'validation', `task_summary_${code}`),
        },
      );
      if (validated.status === 'valid') {
        const presentationIssue = summaryPresentationIssue(validated.value);
        if (presentationIssue) {
          providerDiagnostic(
            'disease',
            'validation',
            `task_summary_${presentationIssue}`,
          );
          return {
            status: 'invalid',
            reason: SUMMARY_PRESENTATION_REASONS[presentationIssue],
          };
        }
        if (
          validated.value.hypotheses.some(item => {
            const kinds = item.supportingEvidence.map(
              ref => ref.sourceKind === 'external_medical',
            );
            return kinds.some(Boolean) && !kinds.every(Boolean);
          })
        ) {
          providerDiagnostic('disease', 'validation', 'task_summary_sources');
          return {
            status: 'invalid',
            reason: 'Keep record facts and medical context separate.',
          };
        }
        const factIssue = summaryFactIssue(
          validated.value,
          input.evidence.items,
          issue =>
            providerDiagnostic(
              'disease',
              'validation',
              `task_summary_medication_${issue}`,
            ),
          reportSummaryEmptySection,
        );
        if (factIssue) {
          providerDiagnostic(
            'disease',
            'validation',
            factIssue === 'missing'
              ? 'task_summary_medication'
              : `task_summary_${factIssue}`,
          );
          return {
            status: 'invalid',
            reason: SUMMARY_FACT_REASONS[factIssue],
          };
        }
      }
      // A valid schema alone must not publish an untranslated provider response.
      const languageIssue =
        validated.status === 'valid'
          ? summaryLanguageIssue(validated.value)
          : undefined;
      if (languageIssue) {
        providerDiagnostic(
          'disease',
          'validation',
          `task_summary_language_${languageIssue.field}`,
        );
        providerDiagnostic(
          'disease',
          'validation',
          `task_summary_language_${languageIssue.shape}`,
        );
        return {
          status: 'invalid',
          reason: SUMMARY_LANGUAGE_REASONS[languageIssue.field],
        };
      }
      if (validated.status !== 'valid') return validated;
      const covered = applySummaryCoverageNotes(
        validated.value,
        (value as Record<string, JsonValue>).coverageNotes,
        input.evidence.items,
      );
      if (covered.status !== 'valid') {
        providerDiagnostic('disease', 'validation', 'task_summary_coverage');
        return covered;
      }
      return {
        ...covered,
        value: { ...covered.value, presentation: 'symptom_summary' },
      };
    },
  };
