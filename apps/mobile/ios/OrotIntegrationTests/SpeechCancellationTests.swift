import Foundation
@testable import Orot
import XCTest

final class SpeechCancellationTests: XCTestCase {
    func testProductionDeadlineCancellationPropagatesAndCancelsWorker() async {
        let began = expectation(description: "operation began")
        let cancelled = expectation(description: "operation received cancellation")
        let operation = Task {
            try await SpeechTranscriptionDeadline.run {
                began.fulfill()
                do {
                    try await Task.sleep(nanoseconds: 60_000_000_000)
                    return "unexpected completion"
                } catch {
                    cancelled.fulfill()
                    throw error
                }
            }
        }
        await fulfillment(of: [began], timeout: 5)
        operation.cancel()
        do {
            _ = try await operation.value
            XCTFail("Cancellation must not resolve a successful result")
        } catch let failure as SpeechTranscriptionFailure {
            XCTAssertEqual(failure.code, "TRANSCRIPTION_CANCELLED")
        } catch {
            XCTFail("Unexpected cancellation error: \(error)")
        }
        await fulfillment(of: [cancelled], timeout: 5)
    }
}
