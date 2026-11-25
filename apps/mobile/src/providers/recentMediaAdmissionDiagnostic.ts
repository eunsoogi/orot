import { NativeModules } from 'react-native';

type Outcome =
  | 'recovered'
  | 'owner_missing'
  | 'owner_detached'
  | 'settlement_failed'
  | 'wait_expired'
  | 'budget_expired'
  | 'cap_missing_witness'
  | 'cap_revision_changed'
  | 'readmission_refused'
  | 'missing_witness'
  | 'revision_changed'
  | 'cancelled';

/** Closed opt-in terminal receipt after an independent media witness miss. */
export function reportRecentMediaAdmission(
  page: 'first_page' | 'next_page',
  outcome: Outcome,
) {
  try {
    const sink = NativeModules.OrotProviderDiagnostics;
    if (sink?.enabled === true)
      sink.report('records_media_admission', page, outcome);
  } catch {
    // Observation cannot affect native admission or a read.
  }
}
