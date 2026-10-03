import { createSymptomEntry, editSymptomEntry } from '@orot/storage';
import type {
  CreateSymptomEntryInput,
  EditSymptomEntryInput,
  SymptomEntry,
  SymptomEntryFilter,
} from '@orot/storage';
import type { SymptomRepository } from '@orot/storage';
import type { NewSymptomDraft, SymptomEdit } from './types';

declare const require: (path: string) => {
  openLocalSymptomRepository: () => Promise<SymptomRepository>;
};

export interface SymptomJournalRepository {
  list(filter?: SymptomEntryFilter): Promise<SymptomEntry[]>;
  create(draft: NewSymptomDraft): Promise<SymptomEntry>;
  update(id: string, changes: SymptomEdit): Promise<SymptomEntry | null>;
  resolve(id: string): Promise<SymptomEntry | null>;
}

export interface SymptomJournalOptions {
  now?: () => string;
  createId?: () => string;
}

function createSecureSymptomId(): string {
  const source = (globalThis as unknown as {
    crypto?: { getRandomValues?: (target: Uint8Array) => Uint8Array };
  }).crypto;
  if (!source || typeof source.getRandomValues !== 'function') {
    throw new Error('A secure random source is unavailable.');
  }
  const bytes = source.getRandomValues(new Uint8Array(16));
  return 'symptom-' + Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
}

export function createSymptomJournalRepository(
  storage: SymptomRepository,
  options: SymptomJournalOptions = {},
): SymptomJournalRepository {
  const now = options.now ?? (() => new Date().toISOString());
  const createId = options.createId ?? createSecureSymptomId;
  return {
    list: filter => storage.list(filter),
    async create(draft) {
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
  return createSymptomJournalRepository(await secureDatabase.openLocalSymptomRepository());
}
