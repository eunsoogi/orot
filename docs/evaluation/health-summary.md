# Health summary evaluation preparation

This evaluation is not yet implemented or executed. The inputs must be synthetic
and clearly identified as such. Record the source revision, selected provider and
model, time zone, run time, consent mode, inputs, observed tool windows, citations,
and each case outcome. A scripted provider or a component screenshot does not
establish the intended model's behavior.

Use the actual conversation summary service and its existing validated summary
task. The current visit-question runner in `scripts/evaluation/visit-questions/`
executes a different workflow; its results cannot prove health-summary quality.
The `@orot/eval` records and visit-question harness may inform a separate
synthetic fixture and execution adapter, but neither currently invokes this
conversation summary path. Provider access and any remote processing consent
must be established for the chosen evaluation environment before execution.

| Case | Synthetic setup and request | Required observation |
| --- | --- | --- |
| Requested period | Include records immediately before, at the start, inside, and at the end of an explicitly requested local period. | The selected window and cited records match the request and its exclusive end; the model does not use out-of-period records. |
| Local time and DST | Put records around a daylight-saving transition and request local calendar days. | The window uses the requested IANA zone and correct calendar boundaries, and displayed times retain their zone. |
| Missing days | Provide some recorded days and leave others absent. | The result describes coverage without treating absent days as zero, normal, or missed medication. |
| Conflicting records | Include separate overlapping device step series and contradictory recorded observations. | Sources and uncertainty are retained; overlapping series are not added and conflicts are not resolved as invented facts. |
| Partial retrieval | Make one supported source unavailable while another returns records. | The answer distinguishes retrieval failure from an empty record set and exposes the limitation. |
| Follow-up | Ask about a saved prior summary, then ask a new clinical question. | Historical generated output is identified as such; clinical claims use currently revalidated original evidence. |

Do not treat a valid citation identifier alone as proof that the associated
statement is supported. Assess each factual claim against the cited source,
including whether a relevant limitation or contrary record was omitted. Record
unsupported statements, missing citations and unsupported inferences separately.
Do not send real user records or run a model merely to prepare these cases.
