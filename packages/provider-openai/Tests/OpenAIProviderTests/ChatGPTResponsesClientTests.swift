import Foundation
import XCTest
@testable import OpenAIProvider

final class ChatGPTResponsesClientTests: XCTestCase {
    private let request = ChatGPTResponsesRequest(
        model: "model-slug",
        messages: [.system("Keep it brief."), .user("Say hello.")]
    )

    func testSendsPlanRequestAndNormalizesDeltasBeforeCompleted() async throws {
        let text = "Hello 🌍"
        let source = try deltaEvent(text) + completedEvent(text) + "data: [DONE]\n\n"
        let transport = StubChatGPTResponsesHTTPTransport(chunks: sseChunks(source, chunkSize: 3))
        let client = try responsesClient(transport)
        let stream = try await client.streamResponse(request, for: accountAccess())
        var received = [ChatGPTResponsesEvent]()
        for try await event in stream { received.append(event) }

        XCTAssertEqual(received, [.textDelta(text), .completed(ChatGPTResponsesResult(text: text))])
        let recordedRequest = await transport.recordedRequest()
        let recorded = try XCTUnwrap(recordedRequest)
        XCTAssertEqual(recorded.url?.absoluteString, "https://api.openai.com/v1/responses")
        XCTAssertEqual(recorded.httpMethod, "POST")
        XCTAssertEqual(recorded.value(forHTTPHeaderField: "Authorization"), "Bearer fixture-access-token")
        let body = try XCTUnwrap(recorded.httpBody)
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
        XCTAssertEqual(object["model"] as? String, "model-slug")
        XCTAssertEqual(object["store"] as? Bool, false)
        XCTAssertEqual(object["stream"] as? Bool, true)
        XCTAssertEqual(object["instructions"] as? String, "Keep it brief.")
        XCTAssertNil(object["max_output_tokens"])
        XCTAssertNil(object["temperature"])
        let input = try XCTUnwrap(object["input"] as? [[String: String]])
        XCTAssertEqual(input, [["role": "user", "content": "Say hello."]])
    }

    func testGenerateRequiresCompletedInsteadOfDoneSentinel() async throws {
        let transport = StubChatGPTResponsesHTTPTransport(
            chunks: try sseChunks(deltaEvent("partial") + "data: [DONE]\n\n")
        )
        let client = try responsesClient(transport)

        do {
            _ = try await client.generateResponse(request, for: accountAccess())
            XCTFail("A stream without response.completed must not succeed.")
        } catch {
            XCTAssertEqual(error as? ChatGPTResponsesError, .interrupted)
        }
    }

    func testIncompleteAfterDeltaRemainsAnError() async throws {
        let source = try deltaEvent("partial") + "event: response.incomplete\ndata: {\"type\":\"response.incomplete\",\"response\":{\"status\":\"incomplete\",\"incomplete_details\":{\"reason\":\"max_output_tokens\"}}}\n\n"
        let client = try responsesClient(StubChatGPTResponsesHTTPTransport(chunks: sseChunks(source)))
        let stream = try await client.streamResponse(request, for: accountAccess())

        do {
            for try await _ in stream {}
            XCTFail("An incomplete response must not become a completed result.")
        } catch {
            guard case .incomplete(let diagnostics) = error as? ChatGPTResponsesError else {
                return XCTFail("Expected incomplete error, got \(error).")
            }
            XCTAssertEqual(diagnostics.reason, "max_output_tokens")
        }
    }

    func testUsageFailureAfterDeltaPreservesProviderCode() async throws {
        let failure = "event: response.failed\ndata: {\"type\":\"response.failed\",\"response\":{\"status\":\"failed\",\"error\":{\"code\":\"subscription_sharing_usage_limit_exceeded\",\"param\":\"model\"}}}\n\n"
        let source = try deltaEvent("partial") + failure
        let client = try responsesClient(StubChatGPTResponsesHTTPTransport(chunks: sseChunks(source)))
        let stream = try await client.streamResponse(request, for: accountAccess())

        do {
            for try await _ in stream {}
            XCTFail("A failed response must not become a completed result.")
        } catch {
            guard case .responseFailure(let diagnostics) = error as? ChatGPTResponsesError else {
                return XCTFail("Expected response failure, got \(error).")
            }
            XCTAssertEqual(diagnostics.code, "subscription_sharing_usage_limit_exceeded")
            XCTAssertEqual(diagnostics.parameter, "model")
            XCTAssertEqual(diagnostics.requestID, "req_fixture")
        }
    }

    func testDirectAdmissionFailurePreservesStatusBodyShapeAndRequestID() async throws {
        let body = Data(#"{"detail":"route not available"}"#.utf8)
        let client = try responsesClient(StubChatGPTResponsesHTTPTransport(
            statusCode: 403,
            chunks: [body],
            contentType: "application/json",
            requestID: "req_admission"
        ))

        do {
            _ = try await client.streamResponse(request, for: accountAccess())
            XCTFail("An admission failure must not open a stream.")
        } catch {
            guard case .httpFailure(let diagnostics) = error as? ChatGPTResponsesError else {
                return XCTFail("Expected HTTP failure, got \(error).")
            }
            XCTAssertEqual(diagnostics.httpStatusCode, 403)
            XCTAssertEqual(diagnostics.bodyShape, "detail_object")
            XCTAssertEqual(diagnostics.requestID, "req_admission")
        }
    }

    func testAccountScopeAndIdentityAreVerifiedBeforeInference() async throws {
        let transport = StubChatGPTResponsesHTTPTransport(chunks: [])
        let noPlan = syntheticAccount(
            expiresAt: Date().addingTimeInterval(3600),
            scopes: ["openid"]
        )
        let client = try responsesClient(transport, account: noPlan)
        do {
            _ = try await client.streamResponse(request, for: accountAccess())
            XCTFail("Inference must require the direct ChatGPT plan scope.")
        } catch {
            XCTAssertEqual(error as? ChatGPTOAuthError, .planPermissionMissing)
        }
        let recordedRequest = await transport.recordedRequest()
        XCTAssertNil(recordedRequest)
    }
}
