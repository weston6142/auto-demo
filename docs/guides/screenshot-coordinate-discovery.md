# Screenshot-Coordinate Discovery CLI

This workflow lets any screenshot-capable agent discover a browser demo through
the local Auto Demo CLI. Auto Demo never calls a model API. The interchange is
PNG plus JSON: the agent reads images, writes bounded coordinate actions, and
receives semantic replay and review artifacts without a provider adapter.

Run every command from the repository root. Build first with `npm run build`.

## Start

Choose `safe`, `public-browse`, `disposable`, or `yolo` before browser activity,
then start one persistent headed session:

```bash
npm run autodemo -- discover start \
  --url https://example.com/ \
  --goal "Select the requested filters and open the first organic result" \
  --risk yolo \
  --grid \
  --json
```

The JSON result contains `sessionId` and `frame.screenshotPath`. Read the PNG at
`frame.screenshotPath`; do not infer controls from hidden page state. The frame
also declares its id, width, height, pointer, and fixed device scale factor.

## Act

Write one JSON action file against the current frame:

```json
{
  "frameId": "frame-1",
  "actions": [
    { "type": "click", "x": 420, "y": 245 },
    { "type": "type", "text": "demo value", "binding": "search-value" }
  ]
}
```

Then submit it:

```bash
npm run autodemo -- discover act \
  --session <session-id> \
  --actions-file <actions.json> \
  --json
```

Stable form controls may share one action batch and one cached screenshot. A
navigation, page scroll, dropdown opening, dropdown scroll, viewport change, or
layout shift invalidates the old frame and returns a fresh frame. Stop the batch
at that boundary, read the new `frame.screenshotPath`, and use only its frame id
for the next action file. A stale frame is rejected without executing actions.

For a long custom dropdown, put the pointer inside its visible menu and send a
targeted `scroll` action. Read the resulting fresh frame before selecting an
option. For a native dropdown, click it first, read the fresh browser-window
frame, then use bounded `keypress` actions such as `ARROWDOWN`, a public-label
character, `ENTER`, or `ESCAPE`. On macOS, native browser-window frames require
Screen Recording permission. If that capture cannot be made honestly, the
command fails closed with `native_window_capture_unavailable`.

Request a fresh frame explicitly when the current view needs to be re-read:

```bash
npm run autodemo -- discover observe --session <session-id> --json
```

Inspect reconnectable session state without changing the browser:

```bash
npm run autodemo -- discover status --session <session-id> --json
```

## Finish and review

Compile coordinate evidence and replay it semantically in a fresh browser:

```bash
npm run autodemo -- discover finish --session <session-id> --json
```

Success returns `review_required`, the replay-validated plan, and its sanitized
review. Coordinates never enter replay, review, approval, recording, or project
artifacts. Present every ordered step, warning, question, assumption, and
blocker. Explicit approval is still required through the existing
`npm run autodemo -- agent approve` workflow before execution.

If finish returns `repairing`, read its bounded failure, request a fresh frame
with `discover observe`, continue only from that image, and finish again. Do not
edit the plan artifact or reuse stale coordinates.

## Abandon

Close a session that should not continue:

```bash
npm run autodemo -- discover abandon --session <session-id> --json
```

Discovery does not record final media. After explicit approval, use the existing
agent execute and handoff commands to create the recording and project. The
editor and export remain separate operator choices.
