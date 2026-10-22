import { providerDiagnostic } from '../../providers/diagnostics';
import { unsupportedDateOrValueKind } from './questionFacts';

/** Final validation reports a closed category only; provisional streamed text never produces diagnostics. */
export function hasUnsupportedQuestionFacts(
  ...input: Parameters<typeof unsupportedDateOrValueKind>
) {
  const kind = unsupportedDateOrValueKind(...input);
  const codes = {
    date: 'task_date',
    quantity_ratio: 'task_quantity_ratio',
    quantity_unit: 'task_quantity_unit',
    quantity_precision: 'task_quantity_precision',
    quantity_value: 'task_quantity_value',
  } as const;
  if (kind) providerDiagnostic('visit', 'validation', codes[kind]);
  return kind !== undefined;
}
