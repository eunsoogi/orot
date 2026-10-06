# Local multilingual RAG embeddings

The iOS app uses `intfloat/multilingual-e5-small` for on-device document and query vectors. The selected Hugging Face revision is pinned to `614241f622f53c4eeff9890bdc4f31cfecc418b3`; its ONNX model and SentencePiece tokenizer are downloaded on first use, checked against pinned byte counts and SHA-256 digests, and kept in the app's purgeable cache. The model produces 384-dimensional vectors. E5 document and query inputs use the `passage:` and `query:` prefixes, respectively.

The native path uses ONNX Runtime 1.24.2 on its CPU execution provider and SentencePiece at commit `48f1241971c19dc79c314e5a9c5b9c38cbf25a53`. It does not claim Core ML or Neural Engine execution. The provider-neutral RAG service stores model identity, revision, dimension, and float32 vectors in the existing SQLCipher database. Embedding batches accept up to eight texts and report progress for model preparation; cancelling rejects the caller's request and prevents later batches, while a synchronous ONNX call already in progress runs to completion.

## Hybrid retrieval

Search filters the supplied evidence chunks before asking either local candidate store for results. `timeRange.start` and `timeRange.end` are inclusive ISO timestamps with explicit offsets and compare against `effectiveTime`; a chunk without an effective time is excluded when a time bound is set. Record-type and review-state filters require exact matches. Encounter filtering uses only an explicit encounter ID on the chunk, including an encounter record's own ID or an appointment's `encounterId`; it does not infer an encounter from provenance IDs.

The mobile full-text store builds an FTS5 index from the current chunk snapshot inside the existing SQLCipher connection, with `temp_store` set to memory. It drops the temporary table after each query and does not keep a second persistent copy of source text. Query text is normalized into quoted Unicode prefix terms, and FTS5 BM25 order supplies the lexical rank. The shared RAG package combines that list with the locally stored E5 vector ranking using reciprocal-rank fusion. Defaults are `lexicalWeight: 0.5`, `vectorWeight: 0.5`, `rrfConstant: 60`, and `candidateLimit: 20`; callers may override them, and invalid weights or limits are rejected. Results include the original evidence chunk and locator plus nullable lexical and vector ranks.

The issue-specific SQLCipher/FTS probe uses synthetic chunks and a dedicated app entry so its native result remains separate from the general smoke probe. From `apps/mobile`, set `OROT_ISSUE25_SIMULATOR_UDID` to a dedicated Simulator UUID, then run:

```sh
pnpm exec detox build --config-path e2e/issue25-hybrid.detox.config.js --configuration ios.sim.release.issue25-hybrid
pnpm exec detox test --config-path e2e/issue25-hybrid.detox.config.js --configuration ios.sim.release.issue25-hybrid --no-start --headless
```

The probe checks SQLCipher and FTS5 on the native connection, removes one synthetic vector to prove lexical-only retrieval, checks a vector-only E5 result, verifies the requested filters and evidence locators, and confirms that the temporary FTS table is gone after each search. It then relaunches the app and repeats both searches without re-indexing, so the vector result comes from the persisted SQLCipher row.

## Simulator measurement

The recorded run used a Release build on an iPhone 17 Pro simulator running iOS 27.0, with the pinned model, six synthetic Korean records, and five Korean retrieval queries. The fixture covers medication, a stomach symptom, sleep, walking, and a lab appointment. It contains no personal records.

| Measurement | First indexing run | App relaunch run |
| --- | ---: | ---: |
| Model asset preparation | 18.20 s, including cold download and integrity checks | 202 ms from the cached files and integrity checks |
| ONNX session load | 414 ms | 370 ms |
| Search latency for five queries | 5, 4, 3, 5, 4 ms (4.2 ms mean) | 588, 2, 3, 3, 2 ms |
| Top-1 / recall@3 / MRR | 5/5 / 5/5 / 1.00 | 5/5 / 5/5 / 1.00 |
| Persisted vectors read | 6 | 6 |
| Model preparation progress callbacks | 1,382, monotonic | Not applicable; this pass reads the saved index without re-indexing |

The first run's app-process physical footprint was 39,914,280 bytes (38.1 MiB) before model load and 520,162,520 bytes (496.2 MiB) after load. The peak sampled across embedding inference was 908,250,688 bytes (866.2 MiB); that probe includes a separate cancellation batch of eight long inputs, so it is not the peak for an ordinary short query alone. Footprint values are absolute process measurements, not memory deltas attributable solely to the model. After relaunch, the fresh process measured 506,350,688 bytes (482.7 MiB) before the new session load and 988,646,952 bytes (942.8 MiB) after load; the inference peak was 512,429,320 bytes (488.7 MiB).

The eight-item cancellation probe returned the cancellation result in 13 ms. A queued actor call completed after 651 ms, showing how long the synchronous ONNX inference took to drain after the caller had been cancelled. `inferenceMilliseconds` records the most recent native inference call; per-query search times above measure the full `service.search` call, including query embedding and ranking against the six-record fixture. The first search after relaunch includes lazy session setup, so it should not be averaged with the later warm searches.

These figures are one Simulator run, not a device-wide performance guarantee. The small synthetic fixture verifies Korean semantic retrieval for these five queries only. Physical-device measurements and Core ML/Neural Engine performance were not collected.

## Reproducing the probe

From `apps/mobile`, set `OROT_ISSUE24_SIMULATOR_UDID` to a dedicated iOS Simulator UUID and `OROT_ISSUE24_DERIVED_DATA_PATH` to a writable DerivedData directory, then run:

```sh
pnpm exec detox build --config-path e2e/local-e5-embedding.detox.config.js --configuration ios.sim.release.local-e5
pnpm exec detox test --config-path e2e/local-e5-embedding.detox.config.js --configuration ios.sim.release.local-e5 --no-start
```

The E2E probe clears the app and Keychain before its first pass, downloads and verifies the model, measures retrieval and cancellation, then relaunches the app and checks that the SQLCipher-backed vectors remain searchable.
