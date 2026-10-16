import Foundation
@testable import Orot
import XCTest

final class SpeechCancellationTests: OrotFailFastTestCase {
    func testProductionDeadlineCancellationPropagatesAndCancelsWorker() async {
        let (began, beganSignal) = AsyncStream<Void>.makeStream()
        let (cancelled, cancelledSignal) = AsyncStream<Void>.makeStream()
        let operation = Task {
            try await SpeechTranscriptionDeadline.run {
                beganSignal.yield()
                beganSignal.finish()
                do {
                    // A suspended worker has no test deadline; explicit cancellation must still reach it.
                    let suspended = AsyncStream<Void> { _ in }
                    for await _ in suspended {}
                    try Task.checkCancellation()
                    return "unexpected completion"
                } catch {
                    cancelledSignal.yield()
                    cancelledSignal.finish()
                    throw error
                }
            }
        }
        for await _ in began {
            break
        }
        operation.cancel()
        do {
            _ = try await operation.value
            XCTFail("Cancellation must not resolve a successful result")
        } catch let failure as SpeechTranscriptionFailure {
            XCTAssertEqual(failure.code, "TRANSCRIPTION_CANCELLED")
        } catch {
            XCTFail("Unexpected cancellation error: \(error)")
        }
        for await _ in cancelled {
            break
        }
    }
}
