import Foundation
@testable import Orot
import XCTest

final class TestOperationBrokerTests: OrotFailFastTestCase {
    func testCommandCompletesExactlyOnce() async throws {
        let broker = TestOperationBroker()
        broker.next { value in
            guard let command = value as? [String: Any], let identifier = command["id"] as? String else {
                return XCTFail("Missing test command identity")
            }
            XCTAssertEqual(command["operation"] as? String, "synthetic-command")
            broker.finish(identifier, result: .success(["completed": true]))
            broker.finish(identifier, result: .failure(TestOperationBroker.Failure.javascript("late completion")))
        } reject: {
            _, _, _ in XCTFail("Unexpected concurrent command consumer")
        }
        let result = try await broker.request("synthetic-command")
        XCTAssertEqual(result["completed"] as? Bool, true)
    }

    func testUnconsumedCommandWaitsForCancellation() async {
        let task = Task { try await TestOperationBroker().request("unconsumed") }
        // Cancellation is an explicit failure even without a JavaScript consumer; elapsed time is not a result.
        task.cancel()
        do {
            _ = try await task.value
            XCTFail("An unconsumed cancelled operation must not report success")
        } catch is CancellationError {
        } catch { XCTFail("Unexpected error: \(error)") }
    }

    func testCancellationDoesNotWaitForJavascript() async {
        let broker = TestOperationBroker()
        let task = Task { try await broker.request("cancel-before-consumption") }
        task.cancel()
        do {
            _ = try await task.value
            XCTFail("A cancelled operation must not complete")
        } catch is CancellationError {
            // This also covers cancellation racing the continuation's enqueue.
        } catch { XCTFail("Unexpected error: \(error)") }
    }
}
