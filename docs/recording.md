# Consultation recording

The mobile app records a consultation only after the user checks the in-app
consent acknowledgement. The screen asks the user to tell every participant
about the recording and obtain their consent. iOS microphone permission is
requested only after that acknowledgement.

On a device, `AVAudioRecorder` writes AAC audio in an `.m4a` file under the
app's Application Support `Recordings` directory. The file and directory use
complete iOS file protection, and the recording is excluded from device backup.
Audio remains on the device and is not uploaded to the Orot server.

When a recording ends, its UUID, start time, and completion time are linked to
the local record repository as an `audio_recording` source. The source is marked
`user_reported` and `unreviewed`. Saving a recording does not automatically
create a transcript, interpret the recording, or add it to RAG. The user can
request a separate Apple on-device transcription from the saved recording. Its
transcript segments are stored locally as derived, unreviewed evidence linked
to the recording and to millisecond audio ranges; selecting a segment seeks to
that range. Engine and operating-system runtime versions remain attached as
provenance. Corrections append user-reported revisions that retain the earlier
revision, audio range, and engine provenance, and derived records based on an
earlier revision are marked stale instead of being silently rewritten. If
writing source metadata fails
after file protection was verified, the audio remains on the device and the
screen offers a retry. If the native module cannot verify file protection at
completion, it withholds the source link and does not offer that retry.
While a verified source link is pending, the screen keeps its recording details
available and prevents leaving or starting another recording. A failed attempt
to start a new recording keeps the previous completed recording and its local
file.

Pausing, an audio-session interruption, or the app leaving the active state
stops capture. An interruption does not resume automatically. The user must
choose Resume, or Stop to keep the recording and its source metadata. The app
does not record in the background.

Debug iOS Simulator builds expose a separate probe that creates a synthetic
440 Hz tone in a `.caf` file and can simulate an audio interruption. The probe
does not use the microphone and is not included in device or Release builds.
The probe still requests complete file protection and verifies backup
exclusion. If the Simulator does not report the protection attribute, the
result is marked `unverified`; the app withholds its source-record link. This
probe exercises recording state, duration, identity, and interruption handling,
but does not prove device file encryption. Device and Release recording paths
fail closed unless complete file protection is read back successfully.
