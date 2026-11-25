import Vision
import XCTest

@MainActor
enum RenderedTextUITestConditions {
    struct Sample {
        let frame: CGRect
        let appFrame: CGRect
        let text: String
        let screenshot: XCUIScreenshot
    }

    /// Keep geometry and compositor pixels from the same settled observation.
    static func sample(_ element: XCUIElement, in app: XCUIApplication) -> Sample {
        Sample(frame: element.frame, appFrame: app.frame, text: UITestConditions.text(element), screenshot: app.screenshot())
    }

    /// Static text may have no activation point. Check its exact accessible text and actual rendered pixels instead of inferring visibility from hittability.
    static func verify(_ element: XCUIElement, equals expected: String, in app: XCUIApplication, testCase: XCTestCase) throws {
        XCTAssertTrue(element.exists)
        try verify(sample(element, in: app), equals: expected, attachmentName: "rendered-synthetic-review-question", testCase: testCase)
    }

    static func verify(_ sample: Sample, equals expected: String, attachmentName: String, testCase: XCTestCase) throws {
        let elementFrame = sample.frame
        let applicationFrame = sample.appFrame
        let screenshot = sample.screenshot
        let attachment = XCTAttachment(screenshot: screenshot)
        attachment.name = attachmentName
        attachment.lifetime = .keepAlways
        testCase.add(attachment)
        XCTAssertFalse(elementFrame.isEmpty)
        XCTAssertFalse(applicationFrame.isEmpty)
        XCTAssertEqual(sample.text, expected)
        let cgImage = try XCTUnwrap(screenshot.image.cgImage)
        let scaleX = CGFloat(cgImage.width) / applicationFrame.width
        let scaleY = CGFloat(cgImage.height) / applicationFrame.height
        let frame = elementFrame.offsetBy(dx: -applicationFrame.minX, dy: -applicationFrame.minY)
        let crop = CGRect(x: frame.minX * scaleX, y: frame.minY * scaleY,
                          width: frame.width * scaleX, height: frame.height * scaleY)
        let image = try XCTUnwrap(cgImage.cropping(to: crop))
        let request = VNRecognizeTextRequest()
        request.recognitionLanguages = ["ko-KR", "en-US"]
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = false
        try VNImageRequestHandler(cgImage: image).perform([request])
        let strings = request.results?.compactMap { $0.topCandidates(1).first?.string } ?? []
        /// Layout can wrap or split OCR words. The separate accessible-text assertion retains exact punctuation and spaces.
        func compact(_ value: String) -> String {
            value.components(separatedBy: .whitespacesAndNewlines).joined()
        }
        XCTAssertEqual(compact(strings.joined(separator: " ")), compact(expected), "Observed rendered text: \(strings)")
    }
}
