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
// Local embedding exports keep E5 batching, index persistence, and cosine search in the RAG boundary.
export {
  LOCAL_EMBEDDING_IDENTITY,
  LOCAL_EMBEDDING_MODEL,
  LocalEmbeddingJobError,
  runLocalEmbeddingJob,
} from './localEmbeddings';
export type {
  DocumentQueryEmbeddingProvider,
  LocalEmbeddingBackend,
  LocalEmbeddingFailure,
  LocalEmbeddingModelIdentity,
  LocalEmbeddingProgress,
  LocalEmbeddingRequest,
  LocalEmbeddingResponse,
  LocalEmbeddingResult,
  LocalEmbeddingRole,
  LocalEmbeddingRunOptions,
} from './localEmbeddings';
export { indexEvidenceChunks, searchEvidenceChunks } from './embeddingRetrieval';
export type {
  EmbeddingIndexOptions,
  EmbeddingIndexProgress,
  LocalEmbeddingSearchHit,
  LocalEmbeddingVectorStore,
  PersistedLocalEmbedding,
} from './embeddingRetrieval';
export { searchHybridEvidenceChunks, DEFAULT_HYBRID_SEARCH_RANKING } from './hybridRetrieval';
export type {
  HybridEvidenceSearchHit,
  HybridSearchOptions,
  HybridSearchRankingConfig,
} from './hybridRetrieval';
export type { LocalFullTextSearchMatch, LocalFullTextSearchStore } from './localTextSearch';
export { filterEvidenceChunks } from './retrievalFilters';
export type { EvidenceSearchFilters } from './retrievalFilters';
