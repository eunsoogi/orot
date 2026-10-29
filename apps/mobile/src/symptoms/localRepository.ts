import { createSymptomEntry, editSymptomEntry } from '@orot/storage';
import type {
  CreateSymptomEntryInput,
  EditSymptomEntryInput,
  SymptomEntry,
} from '@orot/storage';
import type { SymptomRepository } from '@orot/storage';
import type { NewSymptomDraft, SymptomEdit, SymptomFilter } from './types';
import { toLocalSymptomDateTime } from './dateTime';

declare const require: (path: string) => {
  openLocalSymptomRepository: () => Promise<SymptomRepository>;
};

export interface SymptomJournalRepository {
  list(filter?: SymptomFilter): Promise<SymptomEntry[]>;
  create(draft: NewSymptomDraft): Promise<SymptomEntry>;
  update(id: string, changes: SymptomEdit): Promise<SymptomEntry | null>;
  resolve(id: string): Promise<SymptomEntry | null>;
}

export interface SymptomJournalOptions {
  now?: () => string;
  createId?: () => string;
}

/** Requires Web Crypto; missing secure randomness fails rather than falling back to predictable IDs. */
function createSecureSymptomId(): string {
  const source = (
    globalThis as unknown as {
      crypto?: { getRandomValues?: (target: Uint8Array) => Uint8Array };
    }
  ).crypto;
  if (!source || typeof source.getRandomValues !== 'function') {
    throw new Error('A secure random source is unavailable.');
  }
  const bytes = source.getRandomValues(new Uint8Array(16));
  return (
    'symptom-' +
    Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('')
  );
}

export function createSymptomJournalRepository(
  storage: SymptomRepository,
  options: SymptomJournalOptions = {},
): SymptomJournalRepository {
  const now = options.now ?? (() => new Date().toISOString());
  const createId = options.createId ?? createSecureSymptomId;
  return {
    async list(filter = {}) {
      const { localFrom, localThrough, fromOnsetAt, throughOnsetAt, status } =
        filter;
      // A repeated local hour is discontinuous in UTC; query broadly and compare displayed minutes after retrieval.
      const entries = await storage.list({
        ...(status ? { status } : {}),
        ...(!localFrom && fromOnsetAt ? { fromOnsetAt } : {}),
        ...(!localThrough && throughOnsetAt ? { throughOnsetAt } : {}),
      });
      return entries.filter(entry => {
        const local = toLocalSymptomDateTime(entry.effectiveAt);
        const minute = `${local.date}T${local.time}`;
        return (
          (!localFrom || minute >= localFrom) &&
          (!localThrough || minute <= localThrough)
        );
      });
    },
    async create(draft) {
      // Recording and ingestion capture journal entry time; the user supplies onset separately.
      const timestamp = now();
      const input: CreateSymptomEntryInput = {
        id: createId(),
        ...draft,
        recordedAt: timestamp,
        ingestedAt: timestamp,
      };
      return storage.create(createSymptomEntry(input));
    },
    async update(id, changes: EditSymptomEntryInput) {
      const current = await storage.get(id);
      if (!current) return null;
      return storage.update(editSymptomEntry(current, changes));
    },
    async resolve(id) {
      return storage.resolve(id, now());
    },
  };
}

export async function openLocalSymptomJournal(): Promise<SymptomJournalRepository> {
  const secureDatabase = require('../storage/secureDatabase');
  return createSymptomJournalRepository(
    await secureDatabase.openLocalSymptomRepository(),
  );
}
