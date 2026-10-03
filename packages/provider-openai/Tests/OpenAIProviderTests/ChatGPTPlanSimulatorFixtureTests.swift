#if DEBUG
import XCTest
@testable import OpenAIProvider

final class ChatGPTPlanSimulatorFixtureTests: XCTestCase {
    func testFixtureStreamsACompletedResponseThroughTheProductionClient() async throws {
        let fixture = try ChatGPTPlanSimulatorFixture(scenario: .completed)
        defer { try? fixture.remove() }

        let models = try await fixture.client.listModels(forIssuedClientID: fixture.issuedClientID)
        XCTAssertEqual(models.map(\.slug), ["gpt-synthetic"])

        let request = ChatGPTResponsesRequest(model: "gpt-synthetic", messages: [.user("Hello")])
        let stream = try await fixture.client.streamResponse(request, forIssuedClientID: fixture.issuedClientID)
        var events = [ChatGPTResponsesEvent]()
        for try await event in stream { events.append(event) }

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
}

private enum FixtureStreamTimedOut: Error {
    case expired
}
#endif
