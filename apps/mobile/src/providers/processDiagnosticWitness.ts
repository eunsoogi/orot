import { NativeModules } from 'react-native';

type Snapshot = {
  readonly launch: boolean;
  readonly bridge: boolean;
  readonly receipts: readonly string[];
};

type Sink = {
  readonly enabled?: boolean;
  report(feature: string, stage: string, outcome: string): void;
  readProcessWitness(): Promise<unknown>;
};

function enabledSink(): Sink | undefined {
  try {
    const sink = NativeModules.OrotProviderDiagnostics as Sink | undefined;
    return sink?.enabled === true ? sink : undefined;
  } catch {
    return undefined;
  }
}

export function processDiagnosticWitnessEnabled() {
  return enabledSink() !== undefined;
}

/** Acknowledgment is independently validated by the native report endpoint. */
export function markProcessDiagnosticBridge() {
  try {
    enabledSink()?.report('pipeline', 'rn_bridge_attached', 'completed');
  } catch {
    // Optional observation must not stop the app from starting.
  }
}

const receiptPattern =
  /^(?:records recent_records_(?:pre_admission|admission|source_read|reproof) (?:started|completed|failed|cancelled|unavailable|stale_evidence)|workout (?:records|overview|shared)_(?:route|protection|database|epoch|cohort|reproof|bridge) (?:started|completed|failed|cancelled|skipped|missing|empty)|workout native (?:bridgeReceived|requestRejected|bridgeBusy|started|unavailable|empty|available|cancelled|timeout|nativeGateRejected|workoutObjectsRead|associatedParentsRead|quantitiesRead))$/;

export async function readProcessDiagnosticWitness(): Promise<Snapshot | null> {
  try {
    const value = (await enabledSink()?.readProcessWitness()) as
      Partial<Snapshot> | undefined;
    if (
      typeof value?.launch !== 'boolean' ||
      typeof value.bridge !== 'boolean' ||
      !Array.isArray(value.receipts) ||
      value.receipts.length > 32 ||
      !value.receipts.every(
        line =>
          typeof line === 'string' &&
          line.trim() === line &&
          receiptPattern.test(line),
      )
    )
      return null;
    return {
      launch: value.launch,
      bridge: value.bridge,
      receipts: value.receipts,
    };
  } catch {
    return null;
  }
}
