import Foundation
import OnnxRuntimeBindings

private struct LocalE5PreparedModel {
    let session: ORTSession
    let tokenizer: OrotSentencePieceTokenizer
}

enum LocalE5EmbeddingRuntimeError: LocalizedError {
    case invalidRequest(String)
    case modelUnavailable(String)
    case invalidOutput(String)

    var code: String {
        switch self {
        case .invalidRequest: "INVALID_REQUEST"
        case .modelUnavailable: "MODEL_UNAVAILABLE"
        case .invalidOutput: "INVALID_MODEL_OUTPUT"
        }
    }

    var errorDescription: String? {
        switch self {
        case let .invalidRequest(message), let .modelUnavailable(message), let .invalidOutput(message): message
        }
    }
}

actor LocalE5EmbeddingRuntime {
    static let shared = LocalE5EmbeddingRuntime()

    private let assetStore = LocalE5ModelAssetStore()
    private var preparedModel: LocalE5PreparedModel?
    private var preparationTask: Task<LocalE5PreparedModel, Error>?
    private var progressHandlers: [String: (Int64, Int64) -> Void] = [:]
    private var downloadMilliseconds: Double?
    private var sessionLoadMilliseconds: Double?
    private var footprintBeforeLoad: UInt64?
    private var footprintAfterLoad: UInt64?
    private var inferenceMilliseconds: Double?
    private var inferencePeakFootprint: UInt64?

    func prepare(
        requestId: String,
        onProgress: @escaping (Int64, Int64) -> Void,
    ) async throws {
        progressHandlers[requestId] = onProgress
        defer { progressHandlers.removeValue(forKey: requestId) }
        if preparedModel != nil {
            onProgress(LocalE5ModelAssets.totalByteCount, LocalE5ModelAssets.totalByteCount)
            return
        }

        // This actor-inheriting task lets concurrent callers share one download, session build, and metrics update.
        let loading: Task<LocalE5PreparedModel, Error>
        if let preparationTask {
            loading = preparationTask
        } else {
            loading = Task { [self, assetStore] in
                let downloadStart = ProcessInfo.processInfo.systemUptime
                let files = try await assetStore.prepare { [weak self] completed, total in
                    Task { await self?.reportProgress(completed, total) }
                }
                recordDownloadTime((ProcessInfo.processInfo.systemUptime - downloadStart) * 1000)
                try Task.checkCancellation()

                let footprintBefore = LocalE5ProcessMetrics.physicalFootprintBytes()
                let sampler = LocalE5MemorySampler()
                sampler.start()
                let loadStart = ProcessInfo.processInfo.systemUptime
                let tokenizer = try OrotSentencePieceTokenizer(modelPath: files.tokenizer.path)
                let environment = try ORTEnv(loggingLevel: ORTLoggingLevel.warning)
                let options = try ORTSessionOptions()
                try options.setIntraOpNumThreads(2)
                // Keep the validated iOS path on ORT's CPU provider; this integration does not claim Core ML or Neural Engine execution.
                let session = try ORTSession(env: environment, modelPath: files.model.path, sessionOptions: options)
                let loadTime = (ProcessInfo.processInfo.systemUptime - loadStart) * 1000
                let footprintAfter = LocalE5ProcessMetrics.physicalFootprintBytes()
                let loadPeak = sampler.stop()
                recordLoadMetrics(loadTime, before: footprintBefore, after: footprintAfter, peak: loadPeak)
                return LocalE5PreparedModel(session: session, tokenizer: tokenizer)
            }
            preparationTask = loading
        }

        do {
            let model = try await loading.value
            preparedModel = model
            preparationTask = nil
        } catch {
            preparationTask = nil
            throw error
        }
    }

    func cancel(requestId: String) {
        progressHandlers.removeValue(forKey: requestId)
        if progressHandlers.isEmpty {
            preparationTask?.cancel()
        }
    }

    func embedBatch(_ texts: [String], role: String, requestId _: String) throws -> [[Double]] {
        try Task.checkCancellation()
        guard let model = preparedModel else {
            throw LocalE5EmbeddingRuntimeError.modelUnavailable("The local embedding model has not been prepared.")
        }
        guard role == "document" || role == "query" else {
            throw LocalE5EmbeddingRuntimeError.invalidRequest("Embedding role must be document or query.")
        }
        guard !texts.isEmpty, texts.count <= 8, texts.allSatisfy({ !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }) else {
            throw LocalE5EmbeddingRuntimeError.invalidRequest("Embedding batches require one to eight non-empty texts.")
        }

        let encoded = try texts.map { try inputIds($0, role: role, tokenizer: model.tokenizer) }
        let sequenceLength = encoded.map(\.count).max() ?? 0
        let batchSize = encoded.count
        var ids: [Int64] = []
        var masks: [Int64] = []
        ids.reserveCapacity(batchSize * sequenceLength)
        masks.reserveCapacity(batchSize * sequenceLength)
        for row in encoded {
            ids.append(contentsOf: row)
            masks.append(contentsOf: repeatElement(1, count: row.count))
            if row.count < sequenceLength {
                // ID 1 is the pad token; mask it out of pooling for rows shorter than the batch maximum.
                ids.append(contentsOf: repeatElement(1, count: sequenceLength - row.count))
                masks.append(contentsOf: repeatElement(0, count: sequenceLength - row.count))
            }
        }
        let tokenTypes = Array(repeating: Int64(0), count: batchSize * sequenceLength)
        let shape = [NSNumber(value: batchSize), NSNumber(value: sequenceLength)]
        let inputs: [String: ORTValue] = try [
            "input_ids": tensor(ids, shape: shape),
            "attention_mask": tensor(masks, shape: shape),
            "token_type_ids": tensor(tokenTypes, shape: shape),
        ]

        let sampler = LocalE5MemorySampler()
        sampler.start()
        let start = ProcessInfo.processInfo.systemUptime
        let outputs = try model.session.run(withInputs: inputs, outputNames: ["last_hidden_state"], runOptions: nil)
        let duration = (ProcessInfo.processInfo.systemUptime - start) * 1000
        let peak = sampler.stop()
        inferenceMilliseconds = duration
        if let peak {
            inferencePeakFootprint = max(inferencePeakFootprint ?? 0, peak)
        }
        try Task.checkCancellation()
        guard let hidden = outputs["last_hidden_state"] else {
            throw LocalE5EmbeddingRuntimeError.invalidOutput("ONNX Runtime omitted last_hidden_state.")
        }
        return try meanPool(hidden, batchSize: batchSize, sequenceLength: sequenceLength, masks: masks)
    }

    func metrics() -> [String: Any] {
        [
            "modelLoaded": preparedModel != nil,
            "downloadMilliseconds": boxed(downloadMilliseconds),
            "sessionLoadMilliseconds": boxed(sessionLoadMilliseconds),
            "footprintBeforeLoadBytes": boxed(footprintBeforeLoad),
            "footprintAfterLoadBytes": boxed(footprintAfterLoad),
            "inferenceMilliseconds": boxed(inferenceMilliseconds),
            "inferencePeakFootprintBytes": boxed(inferencePeakFootprint),
            "executionProvider": "CPUExecutionProvider",
        ]
    }

    private func inputIds(_ text: String, role: String, tokenizer: OrotSentencePieceTokenizer) throws -> [Int64] {
        // E5 uses role prefixes; SentencePiece IDs map into the exported model vocabulary with pad reserved at ID 1.
        let prefix = role == "document" ? "passage: " : "query: "
        let pieces = try tokenizer.encode(prefix + text)
        var tokens = [Int64(0)]
        // Reserve positions for BOS and EOS within the model's 512-token input limit.
        tokens.append(contentsOf: pieces.prefix(510).map { mapSentencePieceId($0.intValue) })
        tokens.append(2)
        return tokens
    }

    private func mapSentencePieceId(_ id: Int) -> Int64 {
        switch id {
        case 0: 3
        case 1: 0
        case 2: 2
        default: Int64(id + 1)
        }
    }

    private func tensor(_ values: [Int64], shape: [NSNumber]) throws -> ORTValue {
        let data = values.withUnsafeBytes { buffer in
            NSMutableData(bytes: buffer.baseAddress!, length: buffer.count)
        }
        return try ORTValue(tensorData: data, elementType: .int64, shape: shape)
    }

    private func meanPool(
        _ output: ORTValue,
        batchSize: Int,
        sequenceLength: Int,
        masks: [Int64],
    ) throws -> [[Double]] {
        // E5 retrieval uses attention-mask mean pooling followed by L2 normalization.
        let data = try output.tensorData()
        let expectedValues = batchSize * sequenceLength * LocalE5ModelAssets.dimension
        guard data.length == expectedValues * MemoryLayout<Float>.size else {
            throw LocalE5EmbeddingRuntimeError.invalidOutput("ONNX Runtime returned an unexpected tensor shape.")
        }
        let values = data.bytes.assumingMemoryBound(to: Float.self)
        var vectors: [[Double]] = []
        for row in 0 ..< batchSize {
            var pooled = Array(repeating: Float.zero, count: LocalE5ModelAssets.dimension)
            var tokenCount: Float = 0
            for token in 0 ..< sequenceLength where masks[row * sequenceLength + token] == 1 {
                tokenCount += 1
                let offset = (row * sequenceLength + token) * LocalE5ModelAssets.dimension
                for dimension in 0 ..< LocalE5ModelAssets.dimension {
                    pooled[dimension] += values[offset + dimension]
                }
            }
            guard tokenCount > 0 else {
                throw LocalE5EmbeddingRuntimeError.invalidOutput("The embedding output has no unmasked tokens.")
            }
            let mean = pooled.map { $0 / tokenCount }
            let norm = sqrt(mean.reduce(0.0) { $0 + Double($1 * $1) })
            guard norm.isFinite, norm > 0 else {
                throw LocalE5EmbeddingRuntimeError.invalidOutput("The embedding output cannot be normalized.")
            }
            vectors.append(mean.map { Double($0) / norm })
        }
        return vectors
    }

    private func reportProgress(_ completed: Int64, _ total: Int64) {
        progressHandlers.values.forEach { $0(completed, total) }
    }

    private func boxed(_ value: Any?) -> Any {
        value ?? NSNull()
    }

    private func recordDownloadTime(_ value: Double) {
        downloadMilliseconds = value
    }

    private func recordLoadMetrics(_ value: Double, before: UInt64?, after: UInt64?, peak: UInt64?) {
        sessionLoadMilliseconds = value
        footprintBeforeLoad = before
        footprintAfterLoad = after ?? peak
    }
}
