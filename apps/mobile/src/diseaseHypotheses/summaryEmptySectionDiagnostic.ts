import { providerDiagnostic } from '../providers/diagnostics';

/** The position identifies a visible draft section without logging its prose, source IDs or health values. */
export function reportSummaryEmptySection(index: number) {
  const outcomes = [
    'task_summary_empty_section_1',
    'task_summary_empty_section_2',
    'task_summary_empty_section_3',
    'task_summary_empty_section_4',
    'task_summary_empty_section_5',
    'task_summary_empty_section_6',
    'task_summary_empty_section_7',
    'task_summary_empty_section_8',
  ] as const;
  const outcome = Number.isInteger(index) ? outcomes[index] : undefined;
  if (outcome) providerDiagnostic('disease', 'validation', outcome);
}
