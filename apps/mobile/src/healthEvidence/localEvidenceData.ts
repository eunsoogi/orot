import type { SqlDatabase } from '@orot/storage';
import { createManualHistoryRepository } from '@orot/storage';
import type { ManualHistoryRepository } from '@orot/storage';
import type { EvidenceChunk } from '@orot/rag';
import {
  findEvidenceIdentifiers,
  readEvidenceCandidates,
} from './evidenceCandidates';
import type { LocalEvidenceCandidates } from './evidenceCandidates';
import type { EvidenceCandidateScope } from './evidenceCandidateScope';
import { readManualHistoryCandidates } from './manualHistoryCandidates';
import type { ManualHistoryCandidateSelection } from './manualHistoryCandidates';
import {
  readCurrentEvidenceChunks,
  readSelectedStaleArtifacts,
} from './currentEvidenceChunks';
import type { EvidenceRecordIdentity } from './currentEvidenceChunks';
import {
  createHealthContextReader,
  type HealthContextReader,
} from './healthContext/reader';

export interface LocalEvidenceData {
  readonly readHealthContext?: HealthContextReader;
  readonly manualHistory: ManualHistoryRepository;
  readManualHistoryCandidates(
    query: string,
    signal?: AbortSignal,
    scope?: EvidenceCandidateScope,
  ): Promise<ManualHistoryCandidateSelection>;
  readCandidates(
    query: string,
    signal?: AbortSignal,
    scope?: EvidenceCandidateScope,
  ): Promise<LocalEvidenceCandidates>;
  loadCurrentChunks(
    identities: readonly EvidenceRecordIdentity[],
    signal?: AbortSignal,
  ): Promise<EvidenceChunk[]>;
  loadStaleArtifacts(
    identities: readonly EvidenceRecordIdentity[],
    signal?: AbortSignal,
  ): Promise<readonly EvidenceRecordIdentity[]>;
  findIdentifiers(
    text: string,
    signal?: AbortSignal,
  ): Promise<readonly string[]>;
}

/** Shares bounded evidence reads between all AI routes without opening another storage copy. */
export function createLocalEvidenceData(
  database: SqlDatabase,
): LocalEvidenceData {
  let prepared: Promise<void> | undefined;
  const readHealthContext = createHealthContextReader(database);
  const manualHistory = createManualHistoryRepository(database);
  const prepare = () => {
    // SQL ranking may sort private values. Keep temporary query state off plaintext disk.
    prepared ??= database
      .execute('PRAGMA temp_store = MEMORY')
      .then(() => undefined)
      .catch(error => {
        prepared = undefined;
        throw error;
      });
    return prepared;
  };
  return {
    manualHistory,
    readManualHistoryCandidates: (query, signal, scope) =>
      readManualHistoryCandidates(manualHistory, query, signal, scope),
    async readHealthContext(window, topics, signal, trace) {
      await prepare();
      return readHealthContext(window, topics, signal, trace);
    },
    async readCandidates(query, signal, scope) {
      await prepare();
      return readEvidenceCandidates(database, query, signal, scope);
    },
    loadCurrentChunks: (identities, signal) =>
      readCurrentEvidenceChunks(database, identities, signal),
    loadStaleArtifacts: (identities, signal) =>
      readSelectedStaleArtifacts(database, identities, signal),
    findIdentifiers: (text, signal) =>
      findEvidenceIdentifiers(database, text, signal),
  };
}
