import Foundation
@testable import Orot
import XCTest

/// Exercises request ownership without substituting for the system picker journey.
final class MedicalDocumentPhotoPickerCompletionTests: XCTestCase {
    func testInteractiveDismissCompletesOnceAndLateCallbacksCannotRetireNextRequest() throws {
        let state = MedicalDocumentPhotoPickerCompletion()
        var first = 0
        var second = 0
        let firstID = try XCTUnwrap(state.start { result in
            first += 1
            switch result {
            case let .success(document): XCTAssertNil(document)
            case .failure: XCTFail("Interactive dismissal must resolve as cancellation")
            }
        })
        state.interactiveDismiss(firstID)
        XCTAssertEqual(first, 1)
        let secondID = try XCTUnwrap(state.start { _ in second += 1 })
        state.interactiveDismiss(firstID)
        state.dismissed(firstID)
        state.resolved(firstID, .success(nil))
        state.presentationFailed(firstID, error: CocoaError(.fileReadUnknown))
        XCTAssertTrue(state.isActive)
        XCTAssertEqual(second, 0)
        state.interactiveDismiss(secondID)
        XCTAssertEqual(second, 1)
        XCTAssertFalse(state.isActive)
    }

    func testSelectionCompletesAfterBothResultAndDismissalInEitherOrder() throws {
        for resultFirst in [true, false] {
            let state = MedicalDocumentPhotoPickerCompletion()
            var outcomes = 0
            let id = try XCTUnwrap(state.start { result in
                outcomes += 1
                XCTAssertEqual((try? result.get())?["id"] as? String, "synthetic")
            })
            XCTAssertTrue(state.beginSelection(id))
            XCTAssertFalse(state.beginSelection(id))
            state.interactiveDismiss(id)
            XCTAssertTrue(state.isActive)
            if resultFirst {
                state.resolved(id, .success(["id": "synthetic"]))
                XCTAssertEqual(outcomes, 0)
                state.dismissed(id)
            } else {
                state.dismissed(id)
                XCTAssertEqual(outcomes, 0)
                state.resolved(id, .success(["id": "synthetic"]))
            }
            state.resolved(id, .success(nil))
            state.dismissed(id)
            XCTAssertEqual(outcomes, 1)
            XCTAssertFalse(state.isActive)
        }
    }

    func testExplicitCancelAndPresentationFailureCompleteOnce() throws {
        let state = MedicalDocumentPhotoPickerCompletion()
        var count = 0
        let cancel = try XCTUnwrap(state.start { result in
            count += 1
            switch result {
            case let .success(document): XCTAssertNil(document)
            case .failure: XCTFail("Explicit cancellation must not be an error")
            }
        })
        XCTAssertTrue(state.beginSelection(cancel))
        state.resolved(cancel, .success(nil))
        XCTAssertTrue(state.isActive)
        state.dismissed(cancel)
        XCTAssertEqual(count, 1)
        let failure = try XCTUnwrap(state.start { result in
            if case .failure = result {
                count += 1
            }
        })
        state.presentationFailed(failure, error: CocoaError(.fileReadUnknown))
        state.presentationFailed(failure, error: CocoaError(.fileReadUnknown))
        XCTAssertEqual(count, 2)
        XCTAssertFalse(state.isActive)
    }

    func testProviderFailureWaitsForDismissalAndRejectsConcurrentRequests() throws {
        let state = MedicalDocumentPhotoPickerCompletion()
        var failures = 0
        let id = try XCTUnwrap(state.start { result in
            if case .failure = result {
                failures += 1
            }
        })
        XCTAssertNil(state.start { _ in XCTFail("A concurrent request must not start") })
        XCTAssertTrue(state.beginSelection(id))
        state.resolved(id, .failure(CocoaError(.fileReadUnknown)))
        state.resolved(id, .success(nil))
        XCTAssertEqual(failures, 0)
        state.dismissed(id)
        XCTAssertEqual(failures, 1)
        XCTAssertFalse(state.isActive)
    }
}
