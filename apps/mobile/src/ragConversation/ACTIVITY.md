# Conversation activity contract

This contract is being integrated with the session request lifecycle. Until that
integration lands, the tracker is not an activity source for the app.

Each running request owns one tracker and exposes its frozen snapshot through
its session. Both visual consumers must read that same snapshot; one consumer
owns accessibility announcements. Reading or rendering a snapshot must not
start a request, send data, or schedule a timer. A null snapshot means there is
no live activity, including after process restoration unless a real request is
resumed by its owner.

The snapshot contains only session and request identities and a stage. It does
not contain prompts, model reasoning, tool arguments, results, or health text.
Preparation is set when a request starts; waiting begins when preparation has
finished and remains the fallback when no more specific event is observable.
Only an actual output text event marks streaming. Tool starts and terminal
events use the runtime's operation and call identities. Cancellation takes
priority, followed by active record tools, active literature tools, streaming,
and the remaining preparation or waiting phase. Other tools do not claim a
specific stage. A terminal call cannot be reopened by a delayed start.

The request owner must settle the tracker on completion, failure, interruption,
or cancellation, and ignore callbacks from superseded requests. Navigation and
backgrounding must retain the session-owned snapshot while its request really
runs. A retry gets a new request identity. The announcement owner and localized
copy are integration decisions for the two visual consumers, which must agree
on one owner rather than announce independently.
