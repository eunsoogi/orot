# Conversation A2UI local scratch surface

Conversation task v23 can admit one local scratch input and reset button at
the end of a coherent, finalized ordinary conversation surface. v20–v22
retain their existing schemas and restore policies. The optional control
suffix uses [A2UI 1.0 Basic Catalog](https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json)
TextField, Button and a Text child. It
admits only the app's fixed labels, one empty initial local string at
`/local/draft`, and the app-owned `orot:reset-local-draft` action with no
context. Reject mismatches, aliases, extra action parameters, external
functions and unknown handlers. The normal parser still checks the full
ordinary layout and its exact accepted prose.

The renderer can mount the controls only for the exact current completed
assistant response of the active app-owned session. No draft stamp from
the model becomes the real owner. Every native callback rechecks the
current route, app and session. Losing ownership clears the draft and
revokes pending work. The reset button consumes a new gesture receipt
locally and restores the original empty string.

The copy menu, persistence and restored history receive only original
prose and the existing arrangement skeleton. No field contents, action
event or binding is logged, stored, put in conversation history or sent
to any provider. Other templates and ordinary responses are unchanged.

## Temporary acknowledgment

From Conversation task v35, a coherent final ordinary surface can instead end
in one Basic Catalog CheckBox. The model can request that control only through a
final, exact `false` seed at `/local/checked` and a root Column update
appending the single bound control. The app supplies the fixed visible label
`이 화면에서만 확인 표시`. An unrelated binding, earlier field declaration,
different seed or extra action metadata fails admission.

The native switch writes only a Boolean to the existing ephemeral owner
store. It has no registered action, cannot submit or save anything, and is
retired on owner loss. A later reply and reopened history do not inherit the
checked state or show the old control. Versions through v34 are unchanged.

## Temporary choice between answer parts

From task v36, an ordinary final surface with two distinct accepted answer
parts can instead append one v1 Basic Catalog ChoicePicker. Its literal
mutually exclusive options are the app-owned first and second labels and
enums. The protocol seeds the exact local choice path with an empty list.
The renderer projects that list as an empty or one-choice scalar in the
same ephemeral owner store and provides a local clear control.

Choice options do not add claims to the answer. The active view can change
or clear its selection without an action event, provider response, or saved
state. Switching owners or restoring the archived answer cannot transfer a
previous choice. Previous task versions retain their original admissions.
