import Foundation
@testable import Orot
import XCTest

final class TestOperationBrokerTests: OrotFailFastTestCase {
    func testCommandCompletesExactlyOnce() async throws {
        let broker = TestOperationBroker()
        broker.next { value in
            guard let command = value as? [String: Any], let identifier = command["id"] as? String else {
                return XCTFail("Missing native command identity")
            }
            XCTAssertEqual(command["operation"] as? String, "synthetic-command")
            broker.finish(identifier, result: .success(["completed": true]))
            broker.finish(identifier, result: .failure(TestOperationBroker.Failure.javascript("late completion")))
        } reject: {
            _, _, _ in XCTFail("Unexpected concurrent command consumer")
        }
        let result = try await broker.request("synthetic-command", timeout: 1)
        XCTAssertEqual(result["completed"] as? Bool, true)
    }

    func testUnconsumedCommandTimesOut() async {
        do {
            _ = try await TestOperationBroker().request("unconsumed", timeout: 0.02)
            XCTFail("An unconsumed operation must not report success")
        } catch TestOperationBroker.Failure.timedOut("unconsumed") {
            // The operation-specific deadline fails the test rather than silently returning an empty result.
        } catch { XCTFail("Unexpected error: \(error)") }
    }

    func testCancellationDoesNotWaitForJavascript() async {
        let broker = TestOperationBroker()
        let task = Task { try await broker.request("cancel-before-consumption", timeout: 1) }
        task.cancel()
        do {
            _ = try await task.value
            XCTFail("A cancelled operation must not complete")
        } catch is CancellationError {
            // This also covers cancellation racing the continuation's enqueue.
        } catch { XCTFail("Unexpected error: \(error)") }
    }
}
