/** The retained editor is selected only for the explicit UIKit observation run. */
export function retainedVisitObservationEnabled(
  settings: Readonly<Record<string, unknown>>,
) {
  return settings.OROT_TEST_RETAINED_VISIT_OBSERVATION === 'YES';
}
