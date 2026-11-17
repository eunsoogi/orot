import { providerDiagnostic } from './diagnostics';

export type ReportTargetDiagnostic =
  | 'report_target_cancelled'
  | 'report_target_stale'
  | 'report_target_deleted'
  | 'report_target_unavailable'
  | 'report_target_empty'
  | 'report_target_item_limit'
  | 'report_target_registry_missing'
  | 'report_target_source_unavailable'
  | 'report_target_item_payload'
  | 'report_target_batch_payload'
  | 'report_target_recheck'
  | 'report_target_resolver_missing';

/** Fixed preflight reasons only; a sink failure must not change source validation. */
export function reportTargetFailure(code: ReportTargetDiagnostic): null {
  try {
    providerDiagnostic('rag', 'validation', code);
  } catch {
    /* Optional diagnostic sink. */
  }
  return null;
}
