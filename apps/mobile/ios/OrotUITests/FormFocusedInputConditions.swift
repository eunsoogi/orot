import UIKit
import XCTest

/// Verify editing readiness from current post-tap frames, retaining the original form occlusion boundaries.
@MainActor
enum FormFocusedInputConditions {
    private struct Observation {
        let application: CGRect
        let input: CGRect
        let keyboardFrame: CGRect?
        let geometry: FormScrollGeometry
        let contained: Bool
        let hittable: Bool
    }

    /// A refocus tap does not prove visibility; verify current editing readiness after the one journal reveal.
    static func verify(_ input: XCUIElement, referenceSize: CGSize, in app: XCUIApplication, scroll: XCUIElement, journal: Bool, observeFocusGesture: ((String, CGRect?) -> Void)?) -> (application: CGRect, input: CGRect)? {
        guard var actual = observe(input, referenceSize: referenceSize, in: app, scroll: scroll, journal: journal) else { return nil }
        let needsReveal = !actual.contained || !actual.hittable
        if journal, needsReveal {
            let completed = FormUITestConditions.reveal(input, in: app, scroll: scroll, towardTop: actual.input.minY <= actual.geometry.viewport.minY, avoidTarget: true, referenceSize: referenceSize, observeFocusGesture: observeFocusGesture) != nil
            // Even a failed reveal gets fresh visibility assertions before any focus restoration.
            let revealed = observe(input, referenceSize: referenceSize, in: app, scroll: scroll, journal: journal)
            let contained = revealed?.contained ?? false
            let hittable = revealed?.hittable ?? input.isHittable
            XCTAssertTrue(contained, "The refocused input must fit the actual keyboard viewport before editing")
            XCTAssertTrue(hittable, "The refocused input must be accessibility-hittable before editing")
            guard completed, contained, hittable, let revealed else { return nil }
            actual = revealed
        }
        guard actual.contained, actual.hittable else {
            XCTFail("The refocused input must fit the actual keyboard viewport before editing")
            return nil
        }
        if journal {
            let isEditableTextInput = input.elementType == .textField || input.elementType == .textView
            var focused = app.descendants(matching: .any).matching(NSPredicate(format: "identifier == %@ AND hasKeyboardFocus == true", input.identifier)).count > 0
            if needsReveal, !focused, actual.keyboardFrame == nil, isEditableTextInput {
                // Journal scrolling dismisses the keyboard; tap the visible editor once to model the next text-entry action.
                input.tap()
                focused = app.descendants(matching: .any).matching(NSPredicate(format: "identifier == %@ AND hasKeyboardFocus == true", input.identifier)).count > 0
                XCTContext.runActivity(named: "Journal post-dismissal field focus: focused=\(focused)") { _ in }
                guard let restored = observe(input, referenceSize: referenceSize, in: app, scroll: scroll, journal: journal) else { return nil }
                actual = restored
            }
            guard focused else {
                XCTFail("The refocused input must retain keyboard focus before editing")
                return nil
            }
        }
        // Restoring focus may reintroduce the keyboard and navigation occlusion; editing still requires current full visibility.
        guard actual.contained, actual.hittable else {
            XCTFail("The refocused input must fit the actual keyboard viewport before editing")
            return nil
        }
        return (application: actual.application, input: actual.input)
    }

    /// Re-read after each gesture; pre-tap success cannot stand in for the current keyboard, scroll, or navigation geometry.
    private static func observe(_ input: XCUIElement, referenceSize: CGSize, in app: XCUIApplication, scroll: XCUIElement, journal: Bool) -> Observation? {
        // Bound sequential AX reads in the same epoch clock used by the opted-in RN trace.
        let observationStartedAtMs = Date().timeIntervalSince1970 * 1000
        let keyboard = app.keyboards.firstMatch
        let keyboardFrame = keyboard.exists ? keyboard.frame : nil
        let applicationFrame = app.frame
        let scrollFrame = scroll.frame
        let inputFrame = input.frame
        let usableScroll = journal ? SymptomJournalUITestObservations.navigationClipping(app, scroll: scrollFrame, target: inputFrame, clip: FormUITestConditions.unobstructedScrollFrame) : FormUITestConditions.unobstructedScrollFrame(scrollFrame, target: inputFrame, in: app)
        guard let geometry = FormScrollGeometry.current(application: applicationFrame, scroll: usableScroll, keyboard: keyboardFrame, input: journal ? inputFrame : nil, referenceSize: referenceSize) else {
            XCTFail("The refocused input has no finite keyboard viewport")
            return nil
        }
        let contained = geometry.contains(inputFrame, referenceSize: referenceSize)
        let hittable = journal ? input.isHittable : contained && input.isHittable
        XCTContext.runActivity(named: "Refocused form viewport: startedAtMs=\(observationStartedAtMs), endedAtMs=\(Date().timeIntervalSince1970 * 1000), application=\(applicationFrame), scroll=\(scrollFrame), keyboard=\(String(describing: keyboardFrame)), input=\(inputFrame), viewport=\(geometry.viewport), referenceSize=\(referenceSize), contained=\(contained), hittable=\(hittable)") { _ in }
        return Observation(application: applicationFrame, input: inputFrame, keyboardFrame: keyboardFrame, geometry: geometry, contained: contained, hittable: hittable)
    }
}
