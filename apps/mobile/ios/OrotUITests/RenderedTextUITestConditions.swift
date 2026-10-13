import Vision
import XCTest

@MainActor
enum RenderedTextUITestConditions {
    /// Static text may have no activation point. Check its exact accessible text and actual rendered pixels instead of inferring visibility from hittability.
    static func verify(_ element: XCUIElement, equals expected: String, in app: XCUIApplication, testCase: XCTestCase) throws {
        XCTAssertTrue(element.exists && !element.frame.isEmpty)
        XCTAssertEqual(UITestConditions.text(element), expected)
        let screenshot = app.screenshot()
        let cgImage = try XCTUnwrap(screenshot.image.cgImage)
        let scaleX = CGFloat(cgImage.width) / app.frame.width
        let scaleY = CGFloat(cgImage.height) / app.frame.height
        let frame = element.frame.offsetBy(dx: -app.frame.minX, dy: -app.frame.minY)
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
        let attachment = XCTAttachment(screenshot: screenshot)
        attachment.name = "rendered-synthetic-review-question"
        attachment.lifetime = .keepAlways
        testCase.add(attachment)
    }
}
