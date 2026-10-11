---
name: delegate-to-nyako
description: Delegate a user-requested task to the Nyako agent team from an external agent over HTTP. Use when asked to hand work to Nyako, then track progress, supply clarification, retrieve the final result, and release the task's temporary Session resources.
---

# Delegate to Nyako

Use the authenticated HTTP task API. The caller needs no Nyakore Agent registration or runtime
tools. Each submission creates an independent Nyako entry Session; Nyako handles delegation to
its team and aggregates the result.

## Prepare the request

Use the caller's configured `NYAKO_API_URL` (the full API base, including `/api`) and
`NYAKO_GATEWAY_TOKEN` from its secret mechanism. If unavailable, ask for the endpoint and credential
setup; do not guess a host, read unrelated credentials, or ask to paste a token into chat. Keep
tokens out of task text, saved request/result files, logs and source control.

Write a JSON request file containing only:

```json
{
   "idempotencyKey": "external-agent/unique-logical-task-id",
   "task": "Complete objective, relevant context, exact target, authorized scope, constraints, and required deliverables."
}
```

Generate the key once per logical task and retain it with the exact request. Use a new key for a
new task. State the user's existing scope faithfully; delegation does not grant extra publication,
deployment or other permissions. Include any permission already granted so the team can act within
it. Explain what counts as complete, and request artifact URLs or structured results when useful.
`task` accepts at most 64,000 characters and the key at most 256; the body limit is 256,000 bytes.
Serialize JSON safely instead of interpolating task text into shell code.

## Submit and retain the task address

With the variables already supplied securely, submit the saved JSON file:

```bash
curl --silent --show-error --fail-with-body --connect-timeout 10 --max-time 30 \
  -H "Authorization: Bearer $NYAKO_GATEWAY_TOKEN" \
  -H 'Content-Type: application/json' \
  --data-binary @request.json \
  "${NYAKO_API_URL%/}/tasks"
```

HTTP 202 confirms durable admission. Save the returned `taskId`, `requestId` and `correlationId`
beside the request, and tell the user the work was accepted. Acceptance is not completion. If the
response is lost or a transient request fails, retry the same file and key, with at most three
attempts and increasing delays. A new key could duplicate the work. Reusing a key with different
text returns 409; correct the mismatch instead of changing keys to bypass it.

## Check progress and supply clarification

Read the returned task address:

```bash
curl --silent --show-error --fail-with-body --connect-timeout 10 --max-time 30 \
  -H "Authorization: Bearer $NYAKO_GATEWAY_TOKEN" \
  "${NYAKO_API_URL%/}/tasks/$TASK_ID"
```

Use a bounded wait, initially every 5 seconds, increasing to 15 seconds. Check for at most five
minutes per active wait; then preserve the task address and report the latest meaningful state
so it can be resumed. An elapsed wait never cancels the task or grants permission. Keep the user's
requested notification behavior; do not narrate unchanged status on every poll.

| State                | Action                                                                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `queued` / `running` | Continue the bounded wait; receipt consumption or Session idle does not mean completion.                                                   |
| `needs_input`        | Read `progress.text`; answer from existing authorized context or ask for the missing detail.                                               |
| `blocked`            | Report `blocker.messageId`, its status and error. Preserve the address; delivery recovery requires the operator's explicit NNP resolution. |
| `succeeded`          | Retrieve and save `result.text`, optional `result.data`, and needed artifacts before cleanup.                                              |
| `failed`             | Save and report `result` or `blocker`/`delivery` diagnostics, then clean up when allowed.                                                  |

For clarification, create another JSON file with `{ "idempotencyKey": "unique-input-key", "task":
"The clarification or correction" }` and POST it to the same task:

```bash
curl --silent --show-error --fail-with-body --connect-timeout 10 --max-time 30 \
  -H "Authorization: Bearer $NYAKO_GATEWAY_TOKEN" \
  -H 'Content-Type: application/json' \
  --data-binary @clarification.json \
  "${NYAKO_API_URL%/}/tasks/$TASK_ID/messages"
```

HTTP 202 returns `messageId`. Reuse that input's exact key/body if its response is lost. New input
has a new key; it retains the original task Session and context. Completed tasks reject new input.

For 400/413/415, fix the request. For 401, correct credential setup. A 404 may mean the task API is
disabled or the task address is wrong; 503 may mean the Gateway token is not configured. Report
the concrete error instead of inventing progress or repeatedly submitting a new task.

## Retrieve the result and release resources

Only `succeeded` or `failed` is terminal. Save the final view and any needed files outside the
task's temporary workspace, then deliver the result with useful artifact links. Once outputs
are retained, clean up the task unless the user explicitly requested keeping its workspace:

```bash
curl --silent --show-error --fail-with-body --connect-timeout 10 --max-time 30 \
  -X DELETE -H "Authorization: Bearer $NYAKO_GATEWAY_TOKEN" \
  "${NYAKO_API_URL%/}/tasks/$TASK_ID"
```

Confirm HTTP 200 and `cleanedUp: true`. DELETE is idempotent. A 409 means the task is unfinished
or its entry Session still has active deliveries; reread state and, after completion, retry at
5-second intervals for at most one minute. If still busy, retain the task address and report
cleanup pending. Do not force archive or delete files directly.

Cleanup archives the independent Nyako entry Session and removes its default temporary workspace.
Results, NNP history, metadata, runs and transcripts remain queryable, and retrying the original
submission never reactivates the task. Delegated business Sessions and their worktrees retain
their own lifecycle. DELETE does not cancel running work or erase the audit archive.
