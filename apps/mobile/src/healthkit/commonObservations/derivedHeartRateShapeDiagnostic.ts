import { NativeModules } from 'react-native';

type Stage = 'derived_mapped' | 'derived_committed';

/** Sends only bounded counts from the existing sync; no new reads or sampling. */
export function reportDerivedHeartRateShape(
  feature: string,
  stage: Stage,
  count: number,
) {
  if (
    (feature !== 'restingHeartRate' && feature !== 'walkingHeartRateAverage') ||
    (stage !== 'derived_mapped' && stage !== 'derived_committed') ||
    !Number.isSafeInteger(count) ||
    count < 0 ||
    count > 200
  )
    return;
  try {
    const diagnostics = NativeModules.OrotProviderDiagnostics;
    if (diagnostics?.derivedHeartRateShapeEnabled === true) {
      diagnostics.report(feature, stage, String(count));
    }
  } catch {
    // Do not let diagnosis affect authorization, storage, or screen state.
  }
}
