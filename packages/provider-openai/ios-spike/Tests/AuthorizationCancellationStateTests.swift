import XCTest
@testable import ChatGPTOAuthSpikeSupport

final class AuthorizationCancellationStateTests: XCTestCase {
    func testCancellationBeforeCredentialPersistenceReportsNoSavedSession() {
        let state = AuthorizationCancellationState.awaitingAuthorization

        XCTAssertEqual(state.cancelButtonTitle, "로그인 취소")
        XCTAssertEqual(
            state.cancellationMessage,
            "로그인이 취소되었습니다. 인증 정보는 저장하지 않았습니다."
        )
    }

    func testCancellationDuringDelayedModelRequestReportsPersistedSession() async {
        let state = AuthorizationCancellationState.credentialsStored
        let requestStarted = expectation(description: "The model request started.")
        let modelRequest = Task {
            requestStarted.fulfill()
            try await Task.sleep(nanoseconds: 5_000_000_000)
        }

        await fulfillment(of: [requestStarted], timeout: 1)
        modelRequest.cancel()

        do {
            try await modelRequest.value
            XCTFail("Cancelling a pending model request must throw.")
        } catch {
            XCTAssertEqual(
                state.failureMessage(for: error, taskIsCancelled: modelRequest.isCancelled),
                state.cancellationMessage
            )
        }

        XCTAssertEqual(state.cancelButtonTitle, "모델 확인 취소")
        XCTAssertTrue(state.cancellationMessage.contains("인증 정보는 저장되어 있습니다"))
    }
}
