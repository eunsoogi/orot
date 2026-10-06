# Local multilingual RAG embeddings

The iOS app uses `intfloat/multilingual-e5-small` for on-device document and query vectors. The selected Hugging Face revision is pinned to `614241f622f53c4eeff9890bdc4f31cfecc418b3`; its ONNX model and SentencePiece tokenizer are downloaded on first use, checked against pinned byte counts and SHA-256 digests, and kept in the app's purgeable cache. The model produces 384-dimensional vectors. E5 document and query inputs use the `passage:` and `query:` prefixes, respectively.

The native path uses ONNX Runtime 1.24.2 on its CPU execution provider and SentencePiece at commit `48f1241971c19dc79c314e5a9c5b9c38cbf25a53`. It does not claim Core ML or Neural Engine execution. The provider-neutral RAG service stores model identity, revision, dimension, and float32 vectors in the existing SQLCipher database. Embedding batches accept up to eight texts and report progress for model preparation; cancelling rejects the caller's request and prevents later batches, while a synchronous ONNX call already in progress runs to completion.

## Simulator measurement

The recorded run used a Release build on an iPhone 17 Pro simulator running iOS 27.0, with the pinned model, six synthetic Korean records, and five Korean retrieval queries. The fixture covers medication, a stomach symptom, sleep, walking, and a lab appointment. It contains no personal records.

| Measurement | First indexing run | App relaunch run |
| --- | ---: | ---: |
| Model asset preparation | 16.14 s, including cold download and integrity checks | 192 ms from the cached files and integrity checks |
| ONNX session load | 379 ms | 397 ms |
| Search latency for five queries | 3, 4, 4, 5, 5 ms (4.2 ms mean) | 609, 3, 3, 3, 3 ms |
| Top-1 / recall@3 / MRR | 5/5 / 5/5 / 1.00 | 5/5 / 5/5 / 1.00 |
| Persisted vectors read | 6 | 6 |
| Model preparation progress callbacks | 1,321, monotonic | Not applicable; this pass reads the saved index without re-indexing |

The first run's app-process physical footprint was 39,979,792 bytes (38.1 MiB) before model load and 520,342,744 bytes (496.2 MiB) after load. The peak sampled across embedding inference was 908,643,904 bytes (866.6 MiB); that probe includes a separate cancellation batch of eight long inputs, so it is not the peak for an ordinary short query alone. Footprint values are absolute process measurements, not memory deltas attributable solely to the model.

The eight-item cancellation probe returned the cancellation result in 15 ms. A queued actor call completed after 644 ms, showing how long the synchronous ONNX inference took to drain after the caller had been cancelled. `inferenceMilliseconds` records the most recent native inference call; per-query search times above measure the full `service.search` call, including query embedding and ranking against the six-record fixture.

These figures are one Simulator run, not a device-wide performance guarantee. The small synthetic fixture verifies Korean semantic retrieval for these five queries only. Physical-device measurements and Core ML/Neural Engine performance were not collected.

## Reproducing the probe

From `apps/mobile`, set `OROT_ISSUE24_SIMULATOR_UDID` to a dedicated iOS Simulator UUID and `OROT_ISSUE24_DERIVED_DATA_PATH` to a writable DerivedData directory, then run:

```sh
pnpm exec detox build --config-path e2e/local-e5-embedding.detox.config.js --configuration ios.sim.release.local-e5
pnpm exec detox test --config-path e2e/local-e5-embedding.detox.config.js --configuration ios.sim.release.local-e5 --no-start
```

The E2E probe clears the app and Keychain before its first pass, downloads and verifies the model, measures retrieval and cancellation, then relaunches the app and checks that the SQLCipher-backed vectors remain searchable.
