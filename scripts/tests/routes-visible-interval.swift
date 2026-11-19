import CoreGraphics

@main
enum RoutesVisibleIntervalRegression {
    static func main() {
        let baseline = CGRect(x: 0, y: 62, width: 402, height: 812)
        let keyboard = CGRect(x: 0, y: 546, width: 402, height: 328)
        let keyboardAX = CGRect(x: 0, y: 590, width: 402, height: 226)
        let contracted = CGRect(x: 0, y: 62, width: 402, height: 484)
        precondition(RoutesKeyboardReadiness.ready(keyboardEvent: keyboard, keyboardAX: keyboardAX, baseline: baseline, shared: contracted, host: contracted, workspace: contracted))
        precondition(RoutesKeyboardReadiness.ready(keyboardEvent: keyboard, keyboardAX: keyboardAX, baseline: baseline, shared: contracted, host: baseline, workspace: contracted))
        precondition(!RoutesKeyboardReadiness.ready(keyboardEvent: keyboard, keyboardAX: keyboardAX, baseline: baseline, shared: baseline, host: baseline, workspace: baseline))
        precondition(!RoutesKeyboardReadiness.ready(keyboardEvent: keyboard, keyboardAX: keyboardAX, baseline: baseline, shared: contracted, host: contracted, workspace: baseline))
        // Send remains outside readiness: the original clearance assertion must reject this overlap.
        let overlappedSend = CGRect(x: 286, y: 706, width: 44, height: 44)
        precondition(overlappedSend.maxY > keyboardAX.minY + 1)
        precondition(RoutesVisibleInterval.revealDistance(overflow: 5, slack: 100, viewportHeight: 800) == 55)
        precondition(RoutesVisibleInterval.revealDistance(overflow: 500, slack: 100, viewportHeight: 800) == 320)
        precondition(RoutesVisibleInterval.advance(covered: 0, start: 0, end: 600, height: 1066) == 600)
        precondition(RoutesVisibleInterval.advance(covered: 600, start: 550, end: 1066, height: 1066) == 1066)
        precondition(RoutesVisibleInterval.advance(covered: 600, start: 602, end: 1066, height: 1066) == nil)
        precondition(RoutesVisibleInterval.advance(covered: 600, start: 500, end: 600, height: 1066) == nil)
        precondition(RoutesVisibleInterval.advance(covered: 0, start: 0, end: .nan, height: 1066) == nil)
    }
}
