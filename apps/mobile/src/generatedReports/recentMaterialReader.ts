import { listRecentMaterial, type RecentMaterialRow } from './catalog';

export type RecentMaterialLoader = (
  before?: Pick<RecentMaterialRow, 'createdAt' | 'key'>,
) => Promise<readonly RecentMaterialRow[]>;

/** Opening protected storage is deferred until an eligible Records read, not app module import. */
export const loadRecentMaterial: RecentMaterialLoader = async before => {
  const { openLocalAgentMemoryDatabase } =
    await import('../storage/secureDatabase');
  return listRecentMaterial(await openLocalAgentMemoryDatabase(), before);
};
