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
export {
  clearEvidenceIndex,
  deleteEvidenceChunks,
  indexEvidenceChunks,
  searchEvidenceChunks,
} from './embeddingRetrieval';
export type {
  EmbeddingIndexOptions,
  EmbeddingIndexProgress,
  LocalEmbeddingWrite,
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
// Standard consumers receive Documents; app consumers can retain the same operation's ranking fields.
export { HybridRetriever } from './hybridRetriever';
export type {
  HybridRetrieverInput,
  HybridCandidateRequest,
  CandidateRetriever,
} from './hybridRetriever';
