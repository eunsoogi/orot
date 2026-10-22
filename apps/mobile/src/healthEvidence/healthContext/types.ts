export const HEALTH_CONTEXT_TOPICS = [
  'medications',
  'measurements',
  'activity',
  'sleep',
  'symptoms',
] as const;
export type HealthContextTopic = (typeof HEALTH_CONTEXT_TOPICS)[number];

export interface HealthContextWindow {
  readonly fromInclusive: string;
  readonly toExclusive: string;
  readonly timeZone: string;
}

export interface HealthContextDay {
  readonly date: string;
  readonly fromInclusive: string;
  readonly toExclusive: string;
  /** A partial day remains visible and must not be compared as a completed sensor day. */
  readonly partial: boolean;
}

export interface HealthQuantityDay {
  readonly date: string;
  readonly samples: number;
  readonly minimum: number;
  readonly maximum: number;
  readonly mean: number;
  readonly sum: number;
  readonly latest: number;
  readonly firstAt: string;
  readonly lastAt: string;
}

export interface HealthQuantitySeries {
  readonly concept: string;
  readonly unit: string;
  /** Separate sensors stay separate: adding overlapping phone/watch samples is not a merged daily total. */
  readonly source: string;
  readonly days: readonly HealthQuantityDay[];
}

export interface HealthMedicationProfile {
  readonly identity: string;
  readonly name: string;
  readonly source:
    | 'healthkit_registration'
    | 'current_user_confirmation'
    | 'prescription_record';
  readonly scheduleRegistered?: boolean;
  readonly dosageInstruction?: string;
  readonly assertedAt?: string;
  readonly archived?: boolean;
  readonly taken: number;
  readonly skipped: number;
  readonly otherDoseRecords: number;
  readonly daysWithDoseRecords: number;
  readonly firstDoseAt?: string;
  readonly lastDoseAt?: string;
}

export interface HealthSleepDay {
  readonly date: string;
  /** Union of asleep intervals, excluding awake and in-bed intervals; never the sum of overlapping stages. */
  readonly asleepSeconds: number;
  readonly stages: Readonly<Record<string, number>>;
  readonly overlappingStageSeconds: number;
  readonly sampleCount: number;
}

export interface HealthContextReport {
  readonly window: HealthContextWindow;
  readonly days: readonly HealthContextDay[];
  readonly quantities: readonly HealthQuantitySeries[];
  readonly medications: readonly HealthMedicationProfile[];
  readonly sleep: readonly HealthSleepDay[];
  readonly symptoms: {
    readonly entryCount: number;
    readonly recordedDays: number;
    readonly latest: readonly {
      readonly effectiveAt: string;
      readonly description: string;
      readonly severity?: number;
    }[];
  };
  readonly limitations: readonly string[];
  /** Internal generation fences never appear in provider prompts or evidence display. */
  readonly mutationGeneration: number;
  readonly deletionGeneration: number;
}
