export {
  chunkEvidenceSpan,
  chunkStructuredRecord,
  chunkTranscriptSegment,
  STRUCTURED_RECORD_KINDS,
} from './chunking';
export type {
  ChunkEvidenceLocator,
  ChunkRecordType,
  EvidenceChunk,
  EvidenceChunkMetadata,
  StructuredRecordKind,
  TranscriptRevisionMetadata,
} from './chunking';
export { buildPersistedEvidenceChunks } from './persistedRecords';
export type { PersistedEvidenceReader } from './persistedRecords';
// Expose conversion at the package boundary while retaining evidence IDs and citation metadata.
export { documentToEvidenceChunk, evidenceChunkToDocument } from './langchain/documents';
// Native E5 batching and model identity remain shared by standard embedding adapters.
export {
  LOCAL_EMBEDDING_IDENTITY,
  LOCAL_EMBEDDING_MODEL,
  LocalEmbeddingJobError,
  runLocalEmbeddingJob,
} from './localEmbeddings';
export type {
  LocalEmbeddingBackend,
  LocalEmbeddingModelIdentity,
  LocalEmbeddingProgress,
  LocalEmbeddingResponse,
  LocalEmbeddingRole,
  LocalEmbeddingRunOptions,
} from './localEmbeddings';
export { clearEvidenceIndex, deleteEvidenceChunks } from './embeddingRetrieval';
export type {
  EmbeddingIndexOptions,
  EmbeddingIndexProgress,
  LocalEmbeddingWrite,
  LocalEmbeddingVectorStore,
  PersistedLocalEmbedding,
} from './embeddingRetrieval';
export { DEFAULT_HYBRID_SEARCH_RANKING } from './hybridRetrieval';
export type {
  HybridEvidenceSearchHit,
  HybridSearchOptions,
  HybridSearchRankingConfig,
} from './hybridRetrieval';
export type { LocalFullTextSearchMatch, LocalFullTextSearchStore } from './localTextSearch';
export { filterEvidenceChunks } from './retrievalFilters';
export type { EvidenceSearchFilters } from './retrievalFilters';
// Standard consumers receive Documents; app consumers can retain the same operation's ranking fields.
export { HybridRetriever } from './hybridRetriever';
export type {
  HybridRetrieverInput,
  HybridCandidateRequest,
  CandidateRetriever,
} from './hybridRetriever';
