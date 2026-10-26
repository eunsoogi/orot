import {
  createLocalRecordQueryService,
  createLocalRecordQueryTools,
} from '@orot/agent-runtime';
import type { LocalMemoryReader } from '@orot/agent-runtime';
import { createLocalRecordQueryRepository } from '@orot/storage';
import { openLocalAgentMemoryDatabase } from '../storage/secureDatabase';

/** Uses the app's existing SQLCipher connection; query tools never open a separate record store. */
export async function openLocalRecordQueryService(memory?: LocalMemoryReader) {
  const encryptedDatabase = await openLocalAgentMemoryDatabase();
  const repository = createLocalRecordQueryRepository(encryptedDatabase);
  return createLocalRecordQueryService(repository, memory);
}

/** Builds the bounded read-only LangChain tools over the same encrypted local records. */
export async function openLocalRecordQueryTools(memory?: LocalMemoryReader) {
  const service = await openLocalRecordQueryService(memory);
  return createLocalRecordQueryTools(service);
}
