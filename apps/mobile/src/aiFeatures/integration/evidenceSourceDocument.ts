import type { PersistedMemoryRecord } from '@orot/agent-memory';
import type { LocalHealthEvidenceRecord } from '../../healthEvidence/localEvidenceRepository';
import type { HealthContextReport } from '../../healthEvidence/healthContext/types';
import type { HealthContextScope } from '../../healthEvidence/healthContext/scope';
import type { ManualHistoryEvidence } from '@orot/domain';

/** Original rows and computed period sources have distinct storage and revalidation contracts. */
export type EvidenceSourceDocument =
  | {
      readonly sourceKind: 'health_context_period';
      readonly scope: HealthContextScope;
      readonly report: HealthContextReport;
    }
  | {
      readonly sourceKind: 'personal_record';
      readonly records: readonly LocalHealthEvidenceRecord[];
    }
  | {
      readonly sourceKind: 'manual_history';
      readonly evidence: ManualHistoryEvidence;
    }
  | {
      readonly sourceKind: 'reviewed_memory';
      readonly record: PersistedMemoryRecord;
    };

export type EvidenceSourceReadResult =
  | { readonly status: 'available'; readonly document: EvidenceSourceDocument }
  | { readonly status: 'missing' | 'changed' | 'unavailable' };
