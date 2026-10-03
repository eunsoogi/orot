import type { SymptomEntry } from '@orot/storage';

export type SymptomStatus = SymptomEntry['status'];

export type NewSymptomDraft =
  | {
      onsetAt: string;
      description: string;
      bodySite?: string;
      severity?: number;
      status: 'active';
    }
  | {
      onsetAt: string;
      description: string;
      bodySite?: string;
      severity?: number;
      status: 'resolved';
      resolvedAt: string;
    };

export interface SymptomEdit {
  description: string;
  bodySite: string | null;
  severity: number | null;
}

export interface SymptomFilter {
  status?: SymptomStatus;
  fromOnsetAt?: string;
  throughOnsetAt?: string;
}
