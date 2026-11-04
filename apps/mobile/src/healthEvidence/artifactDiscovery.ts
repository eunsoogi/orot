import type { EvidenceReference } from '@orot/agent-runtime';

/** Durable identities stay local; provider-facing tools must replace them with scoped aliases. */
export interface ArtifactIdentity {
  readonly type: string;
  readonly id: string;
}

export interface ArtifactMetadata extends ArtifactIdentity {
  readonly originFeature: string;
  readonly originSession: string | null;
  readonly createdAt: string;
  readonly eventTime: string | null;
  readonly revision: string;
  readonly providerId: string | null;
  readonly modelId: string | null;
  readonly completion: 'complete' | 'partial' | 'unknown';
  readonly review: 'approved' | 'unreviewed' | 'unknown';
}

export interface ArtifactPage<T extends ArtifactMetadata> {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
  /** Rows that could not be safely read; callers must not describe the page as complete. */
  readonly unavailableCount: number;
}

export interface ArtifactDetail<T extends ArtifactMetadata, Content> {
  readonly metadata: T;
  readonly content: Content;
  readonly sources: readonly EvidenceReference[];
  readonly sourceStatus: 'current' | 'changed' | 'unknown';
}

/** Implementations read authoritative storage; a page may be empty while its cursor has more candidates. */
export interface ArtifactDiscovery<T extends ArtifactMetadata, Content> {
  search(input: {
    readonly query: string;
    readonly cursor?: string;
    readonly limit: number;
    readonly signal?: AbortSignal;
  }): Promise<ArtifactPage<T>>;
  read(
    id: string,
    signal?: AbortSignal,
  ): Promise<ArtifactDetail<T, Content> | null>;
}
