import XCTest

/// Selects the visible leading asset, not Photos' unrelated accessibility enumeration order.
@MainActor
enum MedicalDocumentPhotoSelectionUITestConditions {
    static func selectLeadingPhotoAndAwaitReview(_ app: XCUIApplication, testCase: XCTestCase) throws {
        let picker = XCUIApplication(bundleIdentifier: "com.apple.mobileslideshow.photospicker")
        let images = picker.images.matching(identifier: "PXGGridLayout-Info")
        XCTAssertTrue(images.firstMatch.waitForAppearance(), app.debugDescription)
        // The host has just seeded the synthetic document. Retain the candidate evidence:
        // leading position is not identity, so the journey must still assert its actual OCR text.
        let candidates = images.allElementsBoundByIndex.map { image in
            (image: image, frame: image.frame, label: image.label, hittable: image.isHittable)
        }
        let report = candidates.map { "\($0.label): \($0.frame), hittable=\($0.hittable)" }.joined(separator: "\n")
        let bounds = XCTAttachment(string: report)
        bounds.name = "photo-picker-candidates"
        bounds.lifetime = .keepAlways
        testCase.add(bounds)
        let screenshot = XCTAttachment(screenshot: picker.screenshot())
        screenshot.name = "photo-picker-before-selection"
        screenshot.lifetime = .keepAlways
        testCase.add(screenshot)
        let visible = candidates.filter { $0.hittable && !$0.frame.isEmpty }.sorted {
            if $0.frame.minY != $1.frame.minY { return $0.frame.minY < $1.frame.minY }
            return $0.frame.minX < $1.frame.minX
        }
        let selected = try XCTUnwrap(visible.first, "No visible Photos asset: \(report)")
        selected.image.tap()
        let review = UITestConditions.element(app, "medical-document-review-title")
        let emptyDocument = app.staticTexts["문서에서 가져올 텍스트가 없어요."]
        // An explicit extraction failure is terminal, not an indefinitely pending review.
        let settled = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            review.exists || emptyDocument.exists
        }, object: nil)
        XCTAssertEqual(UITestConditions.wait(for: [settled]), .completed)
        guard review.exists, !emptyDocument.exists else {
            throw NSError(domain: "MedicalDocumentPhotoJourney", code: 1,
                          userInfo: [NSLocalizedDescriptionKey: "Photo OCR did not reach review: \(app.debugDescription)"])
        }
    }
}
