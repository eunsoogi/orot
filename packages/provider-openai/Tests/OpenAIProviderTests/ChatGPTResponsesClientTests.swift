import Foundation
@testable import OpenAIProvider
import XCTest

final class ChatGPTResponsesClientTests: XCTestCase {
    private let request = ChatGPTResponsesRequest(
        model: "model-slug",
        messages: [.system("Keep it brief."), .user("Say hello.")],
    )

    func testSendsPlanRequestAndNormalizesDeltasBeforeCompleted() async throws {
        let text = "Hello 🌍"
        let source = try deltaEvent(text) + completedEvent(text) + "data: [DONE]\n\n"
        let transport = StubChatGPTResponsesHTTPTransport(chunks: sseChunks(source, chunkSize: 3))
        let client = try responsesClient(transport)
        let stream = try await client.streamResponse(request, for: accountAccess())
        var received = [ChatGPTResponsesEvent]()
        for try await event in stream {
            received.append(event)
        }

        XCTAssertEqual(received, [.textDelta(text), .completed(ChatGPTResponsesResult(
            text: text,
            continuationItems: [#"{"content":[{"text":"Hello 🌍","type":"output_text"}],"type":"message"}"#],
        ))])
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
        XCTAssertEqual(object["include"] as? [String], ["reasoning.encrypted_content"])
        XCTAssertEqual(object["instructions"] as? String, "Keep it brief.")
        XCTAssertNil(object["max_output_tokens"])
        XCTAssertNil(object["temperature"])
        let input = try XCTUnwrap(object["input"] as? [[String: String]])
        XCTAssertEqual(input, [["role": "user", "content": "Say hello."]])
    }

    func testToolResultsReplayFunctionCallItemsAndDefinitions() async throws {
        let reasoning = #"{"type":"reasoning","id":"rs_synthetic","encrypted_content":"opaque"}"#
        let functionCall = #"{"type":"function_call","id":"fc_synthetic","call_id":"call_synthetic","name":"lookup_source","arguments":"{\"sourceId\":\"source-42\"}"}"#
        let events = try deltaEvent("Found") + completedEvent("Found")
        let transport = StubChatGPTResponsesHTTPTransport(chunks: sseChunks(events))
        let client = try responsesClient(transport)
        let request = ChatGPTResponsesRequest(
            model: "model-slug",
            messages: [
                .user("Look up source-42."),
                .continuationItem(json: reasoning),
                .continuationItem(json: functionCall),
                .functionCallOutput(callID: "call_synthetic", output: #"{"found":true}"#),
            ],
            tools: [ChatGPTResponsesToolDefinition(
                name: "lookup_source",
                description: "Look up one source.",
                parametersJSON: #"{"type":"object","properties":{"sourceId":{"type":"string"}}}"#,
            )],
        )

        let result = try await client.generateResponse(request, for: accountAccess())
        XCTAssertEqual(result.text, "Found")

        let recordedRequest = await transport.recordedRequest()
        let recorded = try XCTUnwrap(recordedRequest)
        let bodyData = try XCTUnwrap(recorded.httpBody)
        let body = try XCTUnwrap(JSONSerialization.jsonObject(with: bodyData) as? [String: Any])
        let input = try XCTUnwrap(body["input"] as? [[String: Any]])
        XCTAssertEqual(input[0]["role"] as? String, "user")
        XCTAssertEqual(input[0]["content"] as? String, "Look up source-42.")
        XCTAssertEqual(input[1]["type"] as? String, "reasoning")
        XCTAssertEqual(input[1]["encrypted_content"] as? String, "opaque")
        XCTAssertEqual(input[2]["type"] as? String, "function_call")
        XCTAssertEqual(input[2]["call_id"] as? String, "call_synthetic")
        XCTAssertEqual(input[3]["type"] as? String, "function_call_output")
        XCTAssertEqual(input[3]["output"] as? String, #"{"found":true}"#)
        let tools = try XCTUnwrap(body["tools"] as? [[String: Any]])
        XCTAssertEqual(tools[0]["type"] as? String, "function")
        XCTAssertEqual(tools[0]["name"] as? String, "lookup_source")
        XCTAssertEqual(tools[0]["strict"] as? Bool, false)
    }

    func testGenerateRequiresCompletedInsteadOfDoneSentinel() async throws {
        let transport = try StubChatGPTResponsesHTTPTransport(
            chunks: sseChunks(deltaEvent("partial") + "data: [DONE]\n\n"),
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
            guard case let .incomplete(diagnostics) = error as? ChatGPTResponsesError else {
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
            guard case let .responseFailure(diagnostics) = error as? ChatGPTResponsesError else {
                return XCTFail("Expected response failure, got \(error).")
            }
            XCTAssertEqual(diagnostics.code, "subscription_sharing_usage_limit_exceeded")
            XCTAssertEqual(diagnostics.parameter, "model")
            XCTAssertEqual(diagnostics.requestID, "req_fixture")
        }
    }

    func testFailureAfterStreamedToolCallRemainsAnError() async throws {
        let events = Self.functionCallEvents
            + "event: response.failed\ndata: {\"type\":\"response.failed\",\"response\":{\"status\":\"failed\",\"error\":{\"code\":\"subscription_sharing_usage_limit_exceeded\"}}}\n\n"
        let client = try responsesClient(StubChatGPTResponsesHTTPTransport(chunks: sseChunks(events)))
        let stream = try await client.streamResponse(request, for: accountAccess())
        var iterator = stream.makeAsyncIterator()

        let firstEvent = try await iterator.next()
        XCTAssertEqual(firstEvent, .toolCall(ChatGPTResponsesFunctionCall(
            id: "call_synthetic",
            name: "lookup_source",
            argumentsJSON: #"{"sourceId":"source-42"}"#,
        )))
        do {
            _ = try await iterator.next()
            XCTFail("A failed response after a function call must remain an error.")
        } catch {
            guard case let .responseFailure(diagnostics) = error as? ChatGPTResponsesError else {
                return XCTFail("Expected response failure, got \(error).")
            }
            XCTAssertEqual(diagnostics.code, "subscription_sharing_usage_limit_exceeded")
        }
    }

    func testInterruptedStreamAfterToolCallYieldsCallThenInterruption() async throws {
        let client = try responsesClient(StubChatGPTResponsesHTTPTransport(
            chunks: sseChunks(Self.functionCallEvents),
        ))
        let stream = try await client.streamResponse(request, for: accountAccess())
        var iterator = stream.makeAsyncIterator()

        let firstEvent = try await iterator.next()
        XCTAssertEqual(firstEvent, .toolCall(ChatGPTResponsesFunctionCall(
            id: "call_synthetic",
            name: "lookup_source",
            argumentsJSON: #"{"sourceId":"source-42"}"#,
        )))
        do {
            _ = try await iterator.next()
            XCTFail("A stream without response.completed must remain interrupted.")
        } catch {
            XCTAssertEqual(error as? ChatGPTResponsesError, .interrupted)
        }
    }

    func testDirectAdmissionFailurePreservesStatusBodyShapeAndRequestID() async throws {
        let body = Data(#"{"detail":"route not available"}"#.utf8)
        let client = try responsesClient(StubChatGPTResponsesHTTPTransport(
            statusCode: 403,
            chunks: [body],
            contentType: "application/json",
            requestID: "req_admission",
        ))

        do {
            _ = try await client.streamResponse(request, for: accountAccess())
            XCTFail("An admission failure must not open a stream.")
        } catch {
            guard case let .httpFailure(diagnostics) = error as? ChatGPTResponsesError else {
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
            scopes: ["openid"],
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

    private static let functionCallEvents = #"""
    event: response.output_item.added
    data: {"type":"response.output_item.added","item":{"type":"function_call","id":"fc_synthetic","call_id":"call_synthetic","name":"lookup_source","arguments":""}}

    event: response.function_call_arguments.delta
    data: {"type":"response.function_call_arguments.delta","item_id":"fc_synthetic","delta":"{\"sourceId\":\"source-42\"}"}

    event: response.function_call_arguments.done
    data: {"type":"response.function_call_arguments.done","item_id":"fc_synthetic","arguments":"{\"sourceId\":\"source-42\"}"}

    """# + "\n"
}
