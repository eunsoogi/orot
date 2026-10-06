import Foundation

/// Uses URLSession's file-backed download task so the 470 MB graph is never buffered in memory.
final class LocalE5URLSessionDownloader: NSObject, URLSessionDownloadDelegate {
    private let lock = NSLock()
    private var continuation: CheckedContinuation<URL, Error>?
    private var downloadTask: URLSessionDownloadTask?
    private var session: URLSession?
    private var progress: ((Int64) -> Void)?

    func download(from url: URL, progress: @escaping (Int64) -> Void) async throws -> URL {
        try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<URL, Error>) in
                lock.lock()
                self.continuation = continuation
                self.progress = progress
                let configuration = URLSessionConfiguration.ephemeral
                configuration.timeoutIntervalForRequest = 60
                configuration.timeoutIntervalForResource = 1800
                let delegateQueue = OperationQueue()
                delegateQueue.maxConcurrentOperationCount = 1
                session = URLSession(configuration: configuration, delegate: self, delegateQueue: delegateQueue)
                downloadTask = session?.downloadTask(with: url)
                let task = downloadTask
                lock.unlock()
                task?.resume()
            }
        } onCancel: {
            self.cancel()
        }
    }

    func urlSession(
        _: URLSession,
        downloadTask _: URLSessionDownloadTask,
        didWriteData _: Int64,
        totalBytesWritten: Int64,
        totalBytesExpectedToWrite _: Int64,
    ) {
        lock.lock()
        let callback = progress
        lock.unlock()
        callback?(totalBytesWritten)
    }

    func urlSession(
        _: URLSession,
        downloadTask: URLSessionDownloadTask,
        didFinishDownloadingTo location: URL,
    ) {
        guard let response = downloadTask.response as? HTTPURLResponse, (200 ..< 300).contains(response.statusCode) else {
            complete(.failure(LocalE5DownloadError.invalidResponse))
            return
        }
        do {
            let staging = FileManager.default.temporaryDirectory.appendingPathComponent("orot-e5-\(UUID().uuidString).partial")
            try FileManager.default.moveItem(at: location, to: staging)
            complete(.success(staging))
        } catch {
            complete(.failure(error))
        }
    }

    func urlSession(_: URLSession, task _: URLSessionTask, didCompleteWithError error: Error?) {
        if let error {
            complete(.failure(error))
        }
    }

    private func cancel() {
        lock.lock()
        let task = downloadTask
        lock.unlock()
        task?.cancel()
    }

    private func complete(_ result: Result<URL, Error>) {
        lock.lock()
        let continuation = continuation
        self.continuation = nil
        progress = nil
        downloadTask = nil
        let session = session
        self.session = nil
        lock.unlock()
        session?.finishTasksAndInvalidate()
        continuation?.resume(with: result)
    }
}

private enum LocalE5DownloadError: LocalizedError {
    case invalidResponse

    var errorDescription: String? {
        "The local model server returned an invalid response."
    }
}
