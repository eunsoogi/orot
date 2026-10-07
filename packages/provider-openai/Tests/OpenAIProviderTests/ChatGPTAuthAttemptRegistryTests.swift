import OpenAIProvider
import XCTest

final class ChatGPTAuthAttemptRegistryTests: XCTestCase {
    func testLateCallbackFromCancelledAttemptCannotFinishRetry() throws {
        var attempts = ChatGPTAuthAttemptRegistry()
        let cancelled = try XCTUnwrap(attempts.begin())

        // Cancellation completes the first attempt before its system callback arrives.
        XCTAssertTrue(attempts.finish(cancelled))
        let retry = try XCTUnwrap(attempts.begin())

        XCTAssertFalse(attempts.finish(cancelled), "A delayed callback must not consume the retry.")
        XCTAssertTrue(attempts.finish(retry))
        XCTAssertFalse(attempts.finish(retry), "A second callback for one attempt must be ignored.")
    }

    func testDoesNotReplaceAnAttemptThatHasNotFinished() throws {
        var attempts = ChatGPTAuthAttemptRegistry()
        let active = try XCTUnwrap(attempts.begin())

        XCTAssertNil(attempts.begin())
        XCTAssertTrue(attempts.finish(active))
    }
}
