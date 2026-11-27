import { conversationReceiptSelection } from './conversationReceiptSelection';
import { providerDiagnostic } from '../../providers/diagnostics';
import {
  resolveSelectedAiProvider,
  type SelectedAiResolution,
} from './provider';
import type {
  DailyReportRunInput,
  DailyReportServiceRequest,
} from './dailyReportTypes';

/** Look up only the selected provider. No consent or model work starts here. */
export async function selectDailyReportProvider(
  input: DailyReportRunInput,
  request: DailyReportServiceRequest,
  stillCurrent = () => true,
) {
  const current = () => !request.signal.aborted && stillCurrent();
  if (!current()) return { status: 'cancelled' as const };
  try {
    input.deadlineContext.stage = 'provider_selection';
    providerDiagnostic('daily_report', 'selection', 'started');
    let selected: SelectedAiResolution;
    try {
      const resolved = await (
        input.resolveSelected ?? resolveSelectedAiProvider
      )();
      if (!current()) return { status: 'cancelled' as const };
      selected = conversationReceiptSelection(resolved, request.observer);
    } catch {
      if (!current()) return { status: 'cancelled' as const };
      providerDiagnostic('daily_report', 'selection', 'unavailable');
      return { status: 'unavailable' as const };
    }
    if (!current()) return { status: 'cancelled' as const };
    if (selected.status !== 'ready') {
      providerDiagnostic('daily_report', 'selection', 'unavailable');
      return { status: 'unavailable' as const };
    }
    providerDiagnostic('daily_report', 'selection', 'completed');
    return selected;
  } finally {
    if (stillCurrent() && input.deadlineContext.stage === 'provider_selection')
      input.deadlineContext.stage = 'workflow';
  }
}
