# On-device agent memory

Orot uses [Rememori 0.7.0](https://github.com/GiorgioDotcom/rememori), pinned exactly under the MIT license, for memory importance, temporal decay, reinforcement, recall, and forgetting. `@orot/agent-memory` wraps that engine with Orot's explicit write policy, provenance, idempotency, correction, and LangChain tools. The library has no automatic LLM extraction or consolidation; Orot does not recreate those capabilities.

## Bounded candidate comparison

The screen compared four maintained candidates against on-device runtime, memory-management scope, persistence seams, and license. Korean semantic quality is provided by the selected embedder, not by these memory libraries; the lifecycle fixture below does not establish that quality.

| Candidate | Runtime, license, and memory role | iOS fit and decision |
| --- | --- | --- |
| [Rememori 0.7.0](https://github.com/GiorgioDotcom/rememori) | Pure TypeScript memory engine with pluggable storage and embedding; MIT. | Integrated through Orot's mobile adapter and SQLCipher-backed storage. A fail-fast Metro alias blocks its unused Node `FileStorage` path. Initial-release app integration and Simulator verification remain part of #42. |
| [LangMem](https://github.com/langchain-ai/langmem) ([MIT](https://github.com/langchain-ai/langmem/blob/main/LICENSE)) | Memory-management tools and background extraction, distributed as a Python package and backed by LangGraph storage. | The required Python runtime or service does not fit the on-device React Native constraint. Excluded. |
| [Mem0 OSS 3.3.1](https://docs.mem0.ai/open-source/node-quickstart) | Apache-2.0 TypeScript memory SDK with add/search/update/delete and configurable model, embedder, and vector store; its Node SDK requires Node.js 18+. | A React Native/Hermes-profile Metro probe fails on a Node `crypto` import from the OSS entry point. Avoiding the Node-only package path would require broader compatibility work. Excluded. |
| [sqlite-memory 1.3.5](https://github.com/sqliteai/sqlite-memory/releases/tag/1.3.5) | Elastic License 2.0 with an additional grant for open-source projects; SQLite extension for file/text embedding, hybrid search, and deletion. | Upstream ships iOS and iOS Simulator artifacts, but its core is document retrieval infrastructure rather than an agent-memory manager, overlapping #23–25. Its license requires a commercial grant for non-open-source production use. Excluded. |

Sources: [Mem0 OSS configuration](https://docs.mem0.ai/open-source/configuration), [Mem0 license](https://github.com/mem0ai/mem0/blob/main/LICENSE), [sqlite-memory API](https://github.com/sqliteai/sqlite-memory/blob/main/API.md), and [sqlite-memory license](https://github.com/sqliteai/sqlite-memory/blob/main/LICENSE.md). Runtime package probes used the exact versions shown; LangMem was screened from its upstream source.

## Boundary with RAG

Agent memory stores explicit preferences, reviewed interaction summaries, and task context. It can keep source IDs and dates as provenance, but it does not copy the medical record corpus. The #23–25 RAG pipeline remains responsible for record chunking, embeddings, hybrid retrieval, and evidence citations. Memory recall searches only memory entries.

## Local persistence and providers

The mobile adapter stores Rememori records in a dedicated table in the existing SQLCipher database opened by `secureDatabase.ts`. The encryption key remains in Keychain. The adapter uses parameterized statements and one SQLCipher transaction for a correction or deletion batch. Source removal deletes linked memories and writes a durable source tombstone in the same transaction, then removes the source record. Writes referencing a tombstoned source are rejected after service reopen and at the storage transaction boundary. Repeated writes with the same caller-owned `memoryKey` are idempotent; corrected text replaces the previous entry atomically.

The app supplies Orot's selected `EmbeddingProvider` through `createRememoriEmbedder`. This adds no cloud provider. The adapter does not generate or infer facts: writes require either `user_confirmed` or `human_reviewed` provenance and retain source identifiers, optional source dates, and review state. The LangChain tools receive provenance from a caller authorization policy; model-provided text alone cannot set a verified review state. In current #30 code, `queryService.searchMemory` retrieves reviewed memory and the explicit review-save path persists source-linked question memory. `createAgentMemoryTools` remains an available bounded LangChain adapter; the #30 workflow does not call that tool factory directly. The workflow and screen are implemented as modules, but the default `App.tsx` route remains open under #30 and #32.

Rememori's built-in FileStorage dynamically imports Node `fs/promises`. Metro maps only that unused import to a module that throws if invoked. The app always injects the SQLCipher adapter. A default FileStorage call is therefore a configuration error, not a fallback persistence mode.

`removeLocalSourceWithMemory` is the source-removal integration point. The memory service serializes cleanup and source deletion with all memory operations. It marks the source as removed before releasing that operation, so queued writes and writes from another open service cannot restore source-linked memories. A memory-storage failure leaves the source available for retry; if source-record deletion fails after memory cleanup, the durable tombstone remains and retrying the helper completes source deletion.

## Limits and verification

Rememori 0.7.0 is an early pre-1.0 release and its upstream API has no update operation; Orot implements correction as an atomic replacement keyed by the caller's stable memory key. The default entity extractor is disabled because it uses capitalization heuristics and is not suitable for Korean. The lifecycle probe uses synthetic Korean text and a deterministic local embedding fixture to verify SQLCipher save, app-process relaunch, recall, correction, idempotency, source removal, and deletion. It does not demonstrate Korean semantic quality. That depends on the local multilingual embedder from #24, which remains separate. Source removal now has a confirmation path in the recording library and connects audio cleanup with SQLCipher/RAG cascades and memory deletion (#147). Full dependency cleanup and relaunch/resume verification remain open in #34. The #30 recommendation workflow and screen exist in source, but a default app route integrating Calendar, provider selection, generation, review, and save remains open under #30 and #32.

The source integration and deterministic lifecycle probe do not satisfy the still-open initial-release end-to-end acceptance in #42. Keep the integrated iOS app flow and its provider, account, and Simulator limits distinct from unit/component and synthetic evidence.

The root lint, typecheck, and unit-test commands include `@orot/agent-memory`. Root Detox build and test commands invoke the default app, memory, and graph configurations separately; the CI summary guard requires a non-empty successful Jest result for each run.
