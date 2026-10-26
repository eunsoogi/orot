import Foundation
@testable import Orot
import XCTest

final class StandardAdapterIntegrationTests: OrotFailFastTestCase {
    func testStandardAdaptersPreserveNativeDispatchSchemasToolsUsageAndCancellation() async throws {
        // Synthetic raw SDK/transport replies traverse Hermes and shipping native modules.
        // The receipt proves adapter integration, not live inference or physical-device behavior.
        let result = try await TestOperationBroker.shared.request("standard-adapters")
        XCTAssertEqual(result["platform"] as? String, "ios")
        XCTAssertEqual(result["runtime"] as? String, "Hermes")
        XCTAssertEqual(result["modelExecution"] as? String, "mock")
        XCTAssertEqual(result["actualModel"] as? String, "not-run")
        let apple = try XCTUnwrap(result["apple"] as? [String: Any])
        let native = try XCTUnwrap(apple["mockObservation"] as? [String: Any])
        XCTAssertEqual((native["requests"] as? [Any])?.count, 4)
        XCTAssertEqual(native["remainingReplies"] as? Int, 0)
        XCTAssertEqual(apple["invalidRejected"] as? Bool, true)
        XCTAssertEqual(apple["schema"] as? String, "validated")
        XCTAssertEqual(apple["bufferedFinal"] as? String, "revised final")
        XCTAssertEqual(apple["usageAbsent"] as? Bool, true)
        let openai = try XCTUnwrap(result["openai"] as? [String: Any])
        XCTAssertEqual(openai["dispatches"] as? Int, 5)
        XCTAssertEqual(openai["cancellationEvents"] as? Int, 2)
        XCTAssertEqual(openai["callbackEvents"] as? Int, 0)
        XCTAssertEqual(openai["toolExecutions"] as? Int, 0)
        XCTAssertEqual(openai["toolCallId"] as? String, "call_synthetic_source")
        XCTAssertEqual(openai["inferenceStop"] as? String, "unverified")
        let usage = try XCTUnwrap(openai["usage"] as? [String: Any])
        XCTAssertEqual(usage["input_tokens"] as? Int, 7)
        XCTAssertEqual(usage["output_tokens"] as? Int, 3)
        XCTAssertEqual(usage["total_tokens"] as? Int, 10)
        let attachment = try XCTAttachment(data: JSONSerialization.data(withJSONObject: result), uniformTypeIdentifier: "public.json")
        attachment.name = "standard-adapter-native-receipt"
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
