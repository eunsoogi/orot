import CryptoKit
import Foundation

struct LocalE5ModelFiles {
    let model: URL
    let tokenizer: URL
}

struct LocalE5ModelAsset {
    let path: String
    let byteCount: Int64
    let sha256: String
}

enum LocalE5ModelAssets {
    static let identifier = "intfloat/multilingual-e5-small"
    static let revision = "614241f622f53c4eeff9890bdc4f31cfecc418b3"
    static let dimension = 384
    static let model = LocalE5ModelAsset(
        path: "onnx/model.onnx",
        byteCount: 470_268_510,
        sha256: "ca456c06b3a9505ddfd9131408916dd79290368331e7d76bb621f1cba6bc8665",
    )
    static let tokenizer = LocalE5ModelAsset(
        path: "onnx/sentencepiece.bpe.model",
        byteCount: 5_069_051,
        sha256: "cfc8146abe2a0488e9e2a0c56de7952f7c11ab059eca145a0a727afce0db2865",
    )
    static let totalByteCount = model.byteCount + tokenizer.byteCount
}

/// Keeps model files in the purgeable cache and accepts them only when both size and digest match the pinned revision.
final class LocalE5ModelAssetStore {
    private let fileManager = FileManager.default

    func prepare(
        onProgress: @escaping (Int64, Int64) -> Void,
    ) async throws -> LocalE5ModelFiles {
        let root = try cacheDirectory()
        try fileManager.createDirectory(at: root, withIntermediateDirectories: true)
        let modelURL = try await ensure(LocalE5ModelAssets.model, root: root, completedBefore: 0, onProgress: onProgress)
        let tokenizerURL = try await ensure(
            LocalE5ModelAssets.tokenizer,
            root: root,
            completedBefore: LocalE5ModelAssets.model.byteCount,
            onProgress: onProgress,
        )
        return LocalE5ModelFiles(model: modelURL, tokenizer: tokenizerURL)
    }

    private func cacheDirectory() throws -> URL {
        guard let caches = fileManager.urls(for: .cachesDirectory, in: .userDomainMask).first else {
            throw LocalE5AssetError.cacheUnavailable
        }
        return caches
            .appendingPathComponent("orot-local-embeddings", isDirectory: true)
            .appendingPathComponent(LocalE5ModelAssets.revision, isDirectory: true)
    }

    private func ensure(
        _ asset: LocalE5ModelAsset,
        root: URL,
        completedBefore: Int64,
        onProgress: @escaping (Int64, Int64) -> Void,
    ) async throws -> URL {
        let destination = asset.path.split(separator: "/").reduce(root) {
            $0.appendingPathComponent(String($1), isDirectory: false)
        }
        try fileManager.createDirectory(at: destination.deletingLastPathComponent(), withIntermediateDirectories: true)
        if try isValid(destination, asset: asset) {
            onProgress(completedBefore + asset.byteCount, LocalE5ModelAssets.totalByteCount)
            return destination
        }

        try? fileManager.removeItem(at: destination)
        let downloadURL = URL(string: "https://huggingface.co/\(LocalE5ModelAssets.identifier)/resolve/\(LocalE5ModelAssets.revision)/\(asset.path)?download=true")!
        let temporary = try await LocalE5URLSessionDownloader().download(from: downloadURL) { written in
            onProgress(completedBefore + min(written, asset.byteCount), LocalE5ModelAssets.totalByteCount)
        }
        defer { try? fileManager.removeItem(at: temporary) }
        try Task.checkCancellation()

        guard try fileSize(temporary) == asset.byteCount, try digest(temporary) == asset.sha256 else {
            throw LocalE5AssetError.checksumMismatch(asset.path)
        }
        try fileManager.moveItem(at: temporary, to: destination)
        onProgress(completedBefore + asset.byteCount, LocalE5ModelAssets.totalByteCount)
        return destination
    }

    private func isValid(_ url: URL, asset: LocalE5ModelAsset) throws -> Bool {
        guard fileManager.fileExists(atPath: url.path), try fileSize(url) == asset.byteCount else {
            return false
        }
        return try digest(url) == asset.sha256
    }

    private func fileSize(_ url: URL) throws -> Int64 {
        let attributes = try fileManager.attributesOfItem(atPath: url.path)
        guard let size = attributes[.size] as? NSNumber else {
            throw LocalE5AssetError.fileMetadataUnavailable(url.lastPathComponent)
        }
        return size.int64Value
    }

    private func digest(_ url: URL) throws -> String {
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }
        var hasher = SHA256()
        while let bytes = try handle.read(upToCount: 1_048_576), !bytes.isEmpty {
            try Task.checkCancellation()
            hasher.update(data: bytes)
        }
        return hasher.finalize().map { String(format: "%02x", $0) }.joined()
    }
}

enum LocalE5AssetError: LocalizedError {
    case cacheUnavailable
    case checksumMismatch(String)
    case fileMetadataUnavailable(String)

    var errorDescription: String? {
        switch self {
        case .cacheUnavailable:
            "The local model cache directory is unavailable."
        case let .checksumMismatch(path):
            "The downloaded model asset failed integrity verification: \(path)."
        case let .fileMetadataUnavailable(path):
            "The local model asset metadata is unavailable: \(path)."
        }
    }
}
