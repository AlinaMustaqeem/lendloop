# LendLoop architecture

## Trust boundaries

```text
Browser -- Clerk JWT --> Convex functions -- signed event --> n8n
                         ^                         |
                         |---- signed callback ---|
```

The browser is untrusted. UI visibility improves usability, but every data-changing function identifies the caller from `ctx.auth` and checks ownership or role before accessing records. Public catalogue queries construct a new response object containing only tool ID, name, and category.

n8n is also treated as a separate trust domain. Messages in either direction are signed over a canonical string of `timestamp.method.path.rawBody`, where `rawBody` is the exact bytes on the wire. The n8n webhook keeps the raw body for verification, and the n8n HTTP nodes read Convex responses as text. The receiver verifies HMAC-SHA256, rejects timestamps outside five minutes, and rejects replayed event IDs:

- **n8n webhook:** stores the event IDs of sent notifications in workflow static data and acknowledges a repeat without sending again.
- **Overdue fetch:** Convex records the event ID after a successful read.
- **Reminder write-back:** Convex claims the event ID in the same transaction as the write.

## Domain lifecycle

```text
request: pending --> approved --> loan: active --> returned
                 \-> declined
        pending --> cancelled
```

Transitions are validated in Convex mutations. Approval checks existing active loans for inclusive date overlap inside the same serialized mutation. A tool with historical records is archived rather than physically deleted.

## Automation delivery

Request mutations create `automationEvents` in the same database transaction and schedule an internal action. The action signs a data-minimized event and calls n8n. n8n returns a signed acknowledgement only after its local delivery succeeds, so Convex records the observed state and retries with backoff when delivery fails. Approval events also carry the new loan's ID, so they appear in that loan's activity.

The daily workflow signs a GET for overdue loans. Each result carries an idempotency key of `overdue-reminder:<loanId>:<date>`. The reminder steps run once per loan. A successful send is written back as `sent`, and a failed send goes down the mail node's error branch and is written back as `failed`. Convex upserts on the key, never downgrades a `sent` reminder, and returns failed reminders on the next run. Once every write-back has finished, the execution fails if any send failed. That triggers the error workflow, which emails an operator.

```text
fetch (signed GET) -> verify signed response -> one item per loan -> send mail
     -> sent | failed -> signed write-back -> verify signed ack -> fail run if any failed
```

## Data minimization

- The anonymous catalogue exposes no owner fields.
- Request notifications contain a recipient address, participant display name, tool name, dates, and status only.
- The overdue endpoint returns only the borrower delivery fields required for the reminder.
- n8n error logs deliberately exclude message bodies and secrets.
