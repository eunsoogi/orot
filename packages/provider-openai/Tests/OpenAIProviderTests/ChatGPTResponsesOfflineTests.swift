import Foundation
@testable import OpenAIProvider
import XCTest

/// The transport is synthetic and never makes a network request.
private struct FailingTransport: ChatGPTResponsesHTTPTransport {
    let code: URLError.Code
    func stream(for _: URLRequest) async throws -> (URLResponse, AsyncThrowingStream<Data, Error>) {
        throw URLError(code)
    }
}

final class ChatGPTResponsesOfflineTests: XCTestCase {
    func testNotConnectedIsDistinguishedFromOtherTransportFailures() async throws {
        for (code, expected) in [(URLError.Code.notConnectedToInternet, ChatGPTResponsesError.offline), (.timedOut, .transportUnavailable), (.cannotFindHost, .transportUnavailable)] {
            let client = try responsesClient(FailingTransport(code: code))
            do {
                _ = try await client.generateResponse(ChatGPTResponsesRequest(model: "fixture", messages: [.user("synthetic")]), for: accountAccess())
                XCTFail("Expected synthetic transport failure")
            } catch {
                XCTAssertEqual(error as? ChatGPTResponsesError, expected)
            }
        }
    }

    func testCancelledTransportRemainsCancellation() async throws {
        let client = try responsesClient(FailingTransport(code: .cancelled))
        do {
            _ = try await client.generateResponse(ChatGPTResponsesRequest(model: "fixture", messages: [.user("synthetic")]), for: accountAccess())
            XCTFail("Expected cancellation")
        } catch {
            XCTAssertTrue(error is CancellationError)
        }
    }
}
