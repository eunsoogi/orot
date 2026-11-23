import { listRecentMaterial, type RecentMaterialRow } from './catalog';

export type RecentMaterialLoader = (
  before?: Pick<RecentMaterialRow, 'createdAt' | 'key'>,
  options?: { readonly signal: AbortSignal },
) => Promise<readonly RecentMaterialRow[]>;

/** Opening protected storage is deferred until an eligible Records read, not app module import. */
export const loadRecentMaterial: RecentMaterialLoader = async (
  before,
  options,
) => {
  const signal = options?.signal;
  if (signal?.aborted) return [];
  const { openLocalAgentMemoryDatabase } =
    await import('../storage/secureDatabase');
  if (signal?.aborted) return [];
  const database = await openLocalAgentMemoryDatabase();
  return listRecentMaterial(database, before, signal);
};
