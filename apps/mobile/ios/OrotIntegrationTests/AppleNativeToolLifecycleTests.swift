import Foundation
import XCTest
#if canImport(Orot)
    @testable import Orot
#else
    @testable import NativeToolLifecycle
#endif

/// Exercises callback ownership with injected producers, not the Foundation Models SDK.
final class AppleNativeToolLifecycleTests: OrotFailFastTestCase {
    func testCallbackResultDrainsBeforeFreshGeneration() async throws {
        let registry = AppleNativeToolRegistry()
        let first = try await registry.run([:], requestId: "first") { generation in
            let result = try await generation.invoke(name: "search", arguments: ["query": "synthetic"])
            XCTAssertEqual(result, "{\"sourceIds\":[\"source-1\"]}")
            return ["text": "obsolete acknowledgement"]
        }
        XCTAssertEqual(first["finishReason"] as? String, "tool_calls")
        let call = try XCTUnwrap((first["toolCalls"] as? [[String: Any]])?.first)
        let id = try XCTUnwrap(call["id"] as? String)
        XCTAssertTrue(id.contains("-bridge-tool-"))
        let updated: [String: Any] = ["nativeToolCalls": [call], "nativeToolResults": [
            ["toolCallId": id, "result": ["sourceIds": ["source-1"]]],
        ]]
        let second = try await registry.run(updated, requestId: "second") { _ in
            ["text": "fresh answer", "structuredOutput": ["sourceIds": ["source-1"]]]
        }
        XCTAssertEqual(second["text"] as? String, "fresh answer")
        do {
            _ = try await registry.run(updated, requestId: "duplicate") { _ in
                XCTFail("A consumed tool result cannot start another generation"); return [:]
            }
            XCTFail("Expected duplicate rejection")
        } catch {}
    }

    func testCancellationReleasesWaitingCallback() async throws {
        let registry = AppleNativeToolRegistry()
        let first = try await registry.run([:], requestId: "cancelled") { generation in
            _ = try await generation.invoke(name: "search", arguments: [:])
            XCTFail("Cancelled callback must not receive a result")
            return [:]
        }
        XCTAssertEqual(first["finishReason"] as? String, "tool_calls")
        registry.cancel("cancelled")
        registry.cancel("cancelled")
    }

    func testDrainFailureDoesNotStartFreshGeneration() async throws {
        let registry = AppleNativeToolRegistry()
        let first = try await registry.run([:], requestId: "error") { generation in
            _ = try await generation.invoke(name: "search", arguments: [:])
            throw AppleNativeToolGeneration.failure("Synthetic SDK failure after result")
        }
        let call = try XCTUnwrap((first["toolCalls"] as? [[String: Any]])?.first)
        let id = try XCTUnwrap(call["id"] as? String)
        do {
            _ = try await registry.run(["nativeToolCalls": [call], "nativeToolResults": [
                ["toolCallId": id, "result": [:]],
            ]], requestId: "fresh") { _ in XCTFail("Drain errors cannot be swallowed"); return [:] }
            XCTFail("Expected drain failure")
        } catch {
            XCTAssertTrue(error.localizedDescription.contains("Synthetic SDK failure"))
        }
    }

    func testSecondCallbackDuringDrainIsRejected() async throws {
        let generation = AppleNativeToolGeneration(requestId: "extra", onTermination: {})
        let response = try await generation.start {
            _ = try await generation.invoke(name: "search", arguments: [:])
            let rejected = try await generation.invoke(name: "search", arguments: [:])
            XCTAssertTrue(rejected.contains("not_executed"))
            return [:]
        }
        let call = try XCTUnwrap((response["toolCalls"] as? [[String: Any]])?.first)
        // Refusing an extra SDK proposal must not cancel the accepted call or prevent draining.
        try await generation.consume(call: call, result: [:])
        XCTAssertEqual((response["toolCalls"] as? [[String: Any]])?.count, 1)
    }

    func testCancellationDuringDrainReleasesTheNextRequest() async throws {
        let enteredDrain = expectation(description: "Tool result returned to producer")
        let generation = AppleNativeToolGeneration(requestId: "drain-cancel", onTermination: {})
        let response = try await generation.start {
            _ = try await generation.invoke(name: "search", arguments: [:])
            enteredDrain.fulfill()
            try await Task.sleep(nanoseconds: 30_000_000_000)
            return [:]
        }
        let call = try XCTUnwrap((response["toolCalls"] as? [[String: Any]])?.first)
        let drain = Task { try await generation.consume(call: call, result: [:]) }
        await fulfillment(of: [enteredDrain], timeout: 1)
        XCTAssertFalse(generation.permitsSnapshot())
        generation.cancel()
        do { try await drain.value; XCTFail("Cancelled drain must fail") }
        catch { XCTAssertTrue(error is CancellationError) }
    }

    func testWatchdogReleasesAnOrphanedCallback() async throws {
        let ended = expectation(description: "Native watchdog terminated")
        let generation = AppleNativeToolGeneration(requestId: "orphan", timeoutSeconds: 0.02) { ended.fulfill() }
        let response = try await generation.start {
            _ = try await generation.invoke(name: "search", arguments: [:])
            XCTFail("An orphaned callback cannot complete successfully")
            return [:]
        }
        XCTAssertEqual(response["finishReason"] as? String, "tool_calls")
        XCTAssertFalse(generation.permitsSnapshot())
        await fulfillment(of: [ended], timeout: 1)
        generation.cancel()

        // Interactive requests have no elapsed cutoff while a user reviews consent or a tool result.
        let interactive = AppleNativeToolGeneration(requestId: "interactive", onTermination: {})
        defer { interactive.cancel() }
        _ = try await interactive.start {
            _ = try await interactive.invoke(name: "search", arguments: [:])
            return [:]
        }
        try await Task.sleep(nanoseconds: 91_000_000_000)
        XCTAssertTrue(interactive.hasInvokedTool(), "A default generation must remain owned until caller cancellation")
    }

    func testParallelCallbackFailsWithoutPublishingAnotherTool() async throws {
        let generation = AppleNativeToolGeneration(requestId: "parallel", onTermination: {})
        let response = try await generation.start {
            _ = try await generation.invoke(name: "search", arguments: [:])
            return [:]
        }
        let rejected = try await generation.invoke(name: "second", arguments: [:])
        XCTAssertTrue(rejected.contains("not_executed"))
        XCTAssertEqual((response["toolCalls"] as? [[String: Any]])?.count, 1)
        let call = try XCTUnwrap((response["toolCalls"] as? [[String: Any]])?.first)
        XCTAssertTrue(generation.hasInvokedTool(), "The accepted callback must remain owned")
        try await generation.consume(call: call, result: ["sourceIds": ["source-1"]])
    }
}
