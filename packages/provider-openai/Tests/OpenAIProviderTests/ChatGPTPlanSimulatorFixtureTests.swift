#if DEBUG
    @testable import OpenAIProvider
    import XCTest

    final class ChatGPTPlanSimulatorFixtureTests: XCTestCase {
        func testFixtureStreamsACompletedResponseThroughTheProductionClient() async throws {
            let fixture = try ChatGPTPlanSimulatorFixture(scenario: .completed)
            defer { try? fixture.remove() }

            let models = try await fixture.client.listModels(forIssuedClientID: fixture.issuedClientID)
            XCTAssertEqual(models.map(\.slug), ["gpt-synthetic"])

            let request = ChatGPTResponsesRequest(model: "gpt-synthetic", messages: [.user("Hello")])
            let stream = try await fixture.client.streamResponse(request, forIssuedClientID: fixture.issuedClientID)
            var events = [ChatGPTResponsesEvent]()
            for try await event in stream {
                events.append(event)
            }

            XCTAssertEqual(events, [
                .textDelta("안녕"),
                .textDelta("하세요"),
                .completed(ChatGPTResponsesResult(text: "안녕하세요")),
            ])
        }

        func testFixtureYieldsTextBeforeAnOpenResponseEnds() async throws {
            let fixture = try ChatGPTPlanSimulatorFixture(scenario: .cancellable)
            defer { try? fixture.remove() }

            let request = ChatGPTResponsesRequest(model: "gpt-synthetic", messages: [.user("Hello")])
            let stream = try await fixture.client.streamResponse(request, forIssuedClientID: fixture.issuedClientID)
            let firstEvent = try await withThrowingTaskGroup(of: ChatGPTResponsesEvent.self) { group in
                group.addTask {
                    var iterator = stream.makeAsyncIterator()
                    guard let event = try await iterator.next() else { throw ChatGPTResponsesError.interrupted }
                    return event
                }
                group.addTask {
                    try await Task.sleep(nanoseconds: 2_000_000_000)
                    throw FixtureStreamTimedOut.expired
                }
                guard let event = try await group.next() else { throw ChatGPTResponsesError.interrupted }
                group.cancelAll()
                return event
            }

            XCTAssertEqual(firstEvent, .textDelta("취소 대기"))
        }

        func testFixtureCompletesAFullLocalToolRoundTrip() async throws {
            let fixture = try ChatGPTPlanSimulatorFixture(scenario: .toolRoundTrip)
            defer { try? fixture.remove() }
            let definition = ChatGPTResponsesToolDefinition(
                name: "lookup_source",
                description: "Look up a synthetic source.",
                parametersJSON: #"{"type":"object","properties":{"sourceId":{"type":"string"}},"required":["sourceId"],"additionalProperties":false}"#,
            )
            let firstRequest = ChatGPTResponsesRequest(
                model: "gpt-synthetic",
                messages: [.user("Look up source-42.")],
                tools: [definition],
            )
            let firstStream = try await fixture.client.streamResponse(firstRequest, forIssuedClientID: fixture.issuedClientID)
            var firstEvents = [ChatGPTResponsesEvent]()
            for try await event in firstStream {
                firstEvents.append(event)
            }
            let toolCall = ChatGPTResponsesFunctionCall(
                id: "call_synthetic_source",
                name: "lookup_source",
                argumentsJSON: #"{"sourceId":"source-42"}"#,
            )
            XCTAssertEqual(firstEvents, [
                .toolCall(toolCall),
                .completed(ChatGPTResponsesResult(
                    text: "",
                    toolCalls: [toolCall],
                    continuationItems: [
                        #"{"encrypted_content":"synthetic-only","id":"rs_synthetic_source","type":"reasoning"}"#,
                        #"{"arguments":"{\"sourceId\":\"source-42\"}","call_id":"call_synthetic_source","id":"fc_synthetic_source","name":"lookup_source","type":"function_call"}"#,
                    ],
                )),
            ])

            let secondRequest = ChatGPTResponsesRequest(
                model: "gpt-synthetic",
                messages: [
                    .user("Look up source-42."),
                    .continuationItem(json: firstEventsContinuation(firstEvents, at: 0)),
                    .continuationItem(json: firstEventsContinuation(firstEvents, at: 1)),
                    .functionCallOutput(callID: toolCall.id, output: #"{"found":true,"sourceId":"source-42"}"#),
                ],
                tools: [definition],
            )
            let final = try await fixture.client.generateResponse(secondRequest, forIssuedClientID: fixture.issuedClientID)
            XCTAssertEqual(final, ChatGPTResponsesResult(
                text: "Source found.",
                continuationItems: [#"{"content":[{"text":"Source found.","type":"output_text"}],"type":"message"}"#],
            ))
        }

        private func firstEventsContinuation(_ events: [ChatGPTResponsesEvent], at index: Int) -> String {
            guard case let .some(.completed(response)) = events.last else { return "" }
            return response.continuationItems[index]
        }
    }

    private enum FixtureStreamTimedOut: Error {
        case expired
    }
#endif
