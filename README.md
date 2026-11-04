# LendLoop

LendLoop is a neighborhood tool-lending board built with Next.js App Router, Clerk, Convex, TypeScript, and n8n. Neighbors can list tools, request date ranges, approve or decline requests, track loans, and mark returns. n8n handles signed notifications and daily overdue reminders.

## Feature checklist

- Public, read-only catalogue exposing only available tool names and categories
- Clerk sign-in with Convex JWT validation
- Listings, borrowing requests, approval/decline, cancellation, and returns
- All tools, My listings, My requests, Incoming requests, and Loans views
- Category filtering and search
- Convex-enforced owner, participant, and admin permissions
- Admin loan view, moderation, and Trusted Lender assignment
- Date-overlap protection and validated state transitions; approving a request auto-declines overlapping pending requests
- HMAC-signed n8n traffic in both directions, verified over the exact raw body, with timestamp and event-ID replay protection on every receiver
- Daily reminders for every overdue borrower, with sent *and* failed results written back idempotently
- Retried delivery, an error workflow that emails an operator, and per-loan activity ("Overdue reminder sent 2 days ago")
- Local n8n and Mailpit setup through Docker Compose, with workflows imported and linked by one CLI command
- An opt-in end-to-end test that drives the real Convex functions against live n8n and Mailpit

## Architecture

The web application talks directly to Convex using Clerk-issued identity tokens. Convex is the authorization and consistency boundary. Mutations create data-minimized automation events and schedule delivery to n8n. n8n signs its overdue fetches and reminder write-backs to Convex HTTP actions.

See [docs/architecture.md](docs/architecture.md) for lifecycle, trust-boundary, and data-minimization details.

## Prerequisites

- Node.js 22+
- npm 10+
- Docker Desktop (for local n8n and Mailpit)
- A Clerk application
- A free Convex project

## 1. Install and configure the application

```bash
npm install
cp .env.example .env.local
```

On PowerShell, use `Copy-Item .env.example .env.local`.

Create a Clerk application, enable the Convex integration, and copy its publishable and secret keys into `.env.local`. Then start Convex:

```bash
npx convex dev
```

Choose or create a Convex project when prompted. Copy the generated `NEXT_PUBLIC_CONVEX_URL` into `.env.local` if the CLI did not add it.

Set the server-side Convex environment variables:

```bash
npx convex env set CLERK_JWT_ISSUER_DOMAIN https://your-instance.clerk.accounts.dev
npx convex env set ADMIN_CLERK_USER_IDS user_your_clerk_user_id
npx convex env set N8N_SHARED_SECRET "a-random-secret-with-at-least-32-characters"
npx convex env set N8N_REQUEST_WEBHOOK_URL https://your-public-n8n-url/webhook/lendloop-request-events
```

Convex runs in the cloud and therefore cannot call `localhost`. For a local Docker demo, expose port 5678 through an HTTPS tunnel such as `ngrok http 5678` or Cloudflare Tunnel, set `N8N_PUBLIC_URL` to that public origin, and use the resulting production webhook URL above. n8n Cloud already supplies a public URL.

Run the web application in another terminal:

```bash
npm run dev
```

Open `http://localhost:3000`. The Clerk user IDs in the comma-separated `ADMIN_CLERK_USER_IDS` value receive the admin role when their profile synchronizes. There is intentionally no client-callable role escalation function.

## 2. Run n8n and Mailpit

Create the Docker environment file and use the same HMAC secret configured in Convex:

```bash
cp .env.n8n.example .env
docker compose up -d
```

PowerShell:

```powershell
Copy-Item .env.n8n.example .env
docker compose up -d
```

The local services are:

- n8n: `http://localhost:5678`
- Mailpit inbox: `http://localhost:8025`

Import and publish the three workflows with the n8n CLI. The `n8n/` folder is mounted read-only at `/workflows`:

```bash
docker compose exec n8n n8n import:workflow --separate --input=/workflows
docker compose exec n8n n8n publish:workflow --id=LendLoopErrHndlr
docker compose exec n8n n8n publish:workflow --id=LendLoopRequests
docker compose exec n8n n8n publish:workflow --id=LendLoopOverdue1
docker compose restart n8n
```

> Git Bash on Windows rewrites `/workflows` into a Windows path. Prefix the commands with `MSYS_NO_PATHCONV=1`, or run them from PowerShell.

The exports carry fixed workflow IDs, and both main workflows already name `LendLoopErrHndlr` as their **Error Workflow**, so no manual linking is needed. The error handler must be published too, because n8n does not run an unpublished error workflow. If you import through the UI instead, n8n assigns new IDs. In that case, select **LendLoop - Automation error handler** under each main workflow's *Settings → Error Workflow*.

Then create the first local n8n owner at `http://localhost:5678`. Open **LendLoop - Daily overdue reminders** and click *Execute workflow* (it has a **Run now (manual)** trigger next to the daily schedule) to check the connection. Reminders, notifications and failure alerts all land in Mailpit, so no external mail account is needed.

> The request workflow must use its production `/webhook/` URL. n8n's temporary `/webhook-test/` path is intentionally rejected because the URL path is covered by the signature.

## Environment variables

| Variable | Location | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Next.js | Browser-safe Clerk key |
| `CLERK_SECRET_KEY` | Next.js | Clerk server SDK |
| `NEXT_PUBLIC_CONVEX_URL` | Next.js | Convex client deployment |
| `CLERK_JWT_ISSUER_DOMAIN` | Convex | Validate Clerk JWTs |
| `ADMIN_CLERK_USER_IDS` | Convex | Comma-separated admin bootstrap allowlist |
| `N8N_REQUEST_WEBHOOK_URL` | Convex | Request notification webhook |
| `N8N_SHARED_SECRET` | Convex + n8n | HMAC key; values must match |
| `CONVEX_HTTP_URL` | n8n | The deployment's `.convex.site` URL |
| `N8N_PUBLIC_URL` | Docker/n8n | Public tunnel origin used to generate webhook URLs |
| `N8N_ENCRYPTION_KEY` | n8n | Encrypt local n8n credentials/state |
| `GENERIC_TIMEZONE` | n8n | Schedule timezone |
| `OPS_ALERT_EMAIL` | n8n | Recipient of error-workflow alerts (default `ops@lendloop.local`, visible in Mailpit) |

Secrets belong in `.env.local`, Convex environment settings, Docker environment, or n8n credentials. They are absent from source and workflow exports.

## Security and reliability choices

### Authorization

Every protected Convex function derives the user from `ctx.auth`. Listing ownership, request participation, lender decisions, return participation, and admin-only operations are checked again in backend code. The UI is not a security boundary.

### Signed integration

Messages use HMAC-SHA256 over:

```text
timestamp.METHOD.path.exactRawBody
```

The signature, timestamp, and unique event ID travel as headers. Receivers reject malformed signatures, timestamps outside a five-minute window, and replayed event IDs. HMAC secrets are never included in workflow JSON: n8n reads them from its environment.

Signatures are always checked over the bytes that were actually sent, never a re-serialised copy:

- **Convex → n8n:** the webhook node keeps the raw request body (`rawBody` option), and the verify step hashes those bytes before parsing them. The signed body's `eventId` must match the header.
- **n8n → Convex:** HTTP actions read `request.text()` before parsing.
- **Signed responses:** Convex signs its responses, and n8n signs its acknowledgement. The n8n HTTP nodes request the response as text, so the overdue workflow verifies Convex's signature over the raw response before using the data.

Each receiver rejects a replayed event ID as follows:

| Receiver | Replay handling |
| --- | --- |
| n8n request webhook | Event IDs of sent notifications are kept in workflow static data for 15 minutes, longer than the timestamp window. A replay, or a Convex retry after a lost acknowledgement, gets a signed `duplicate: true` acknowledgement and no second email. An ID is stored only after its email was sent, so a retry after a failed send is still processed. |
| `GET /api/n8n/overdue` | Convex records the event ID once the read succeeds. A retry after a transient failure is accepted, while a replayed request gets `409`. |
| `POST /api/n8n/reminders` | The receipt claim and the reminder upsert run in one Convex transaction. A retried write-back is acknowledged as a duplicate and writes nothing. |

### Idempotency and failures

- **Every borrower is reminded.** The overdue endpoint returns one item per overdue loan, and the reminder steps run once per item.
- **Failures are written back, not dropped.** The mail step has an error branch: a failed send is recorded in Convex as `failed` with a short error. Failed reminders stay in the next run's overdue list and are retried; sent ones are not.
- **No duplicates on retry.** Reminder keys are `overdue-reminder:<loanId>:<date>`. Convex upserts on that key, never downgrades a `sent` reminder, and keeps one activity entry per reminder. HTTP retries reuse the write-back event ID, and Convex acknowledges them without writing again.
- **Failed runs are visible.** HTTP nodes retry transient errors. Once all write-backs are done, the overdue workflow fails the execution if any reminder failed. Both main workflows point at the error workflow, which logs a sanitized record and emails an operator (`OPS_ALERT_EMAIL`, visible in Mailpit locally). n8n keeps the execution data for every failed run.
- **Convex keeps its own record.** It stores each request-notification delivery attempt and retries failed deliveries with backoff (three attempts).

### Per-loan activity

Each loan shows its latest automation events, for example "Approval notice sent 3 hours ago", "Overdue reminder sent 2 days ago" or "Overdue reminder failed". The approval notification and the reminders are stored with the loan's ID. Only the borrower, the lender and admins can read a loan's activity.

### Data minimization

The public query returns a purpose-built object with no owner data. Automation payloads contain only the delivery address, display names, tool name, dates and status. The overdue endpoint does not expose unrelated account or listing fields. Error alerts carry workflow metadata and the error message only, never message bodies or recipients.

## Quality checks

```bash
npm run typecheck
npm test
npm run lint
npm run build
```

CI runs all four checks on pushes and pull requests. `npm test` covers the authorization boundaries, request lifecycle, overlap handling, reminder idempotency, dates and signing.

### End-to-end automation test

`tests/n8n.e2e.test.ts` runs the real Convex functions with `convex-test`. It serves the Convex HTTP router on the host and drives the live n8n and Mailpit containers. It checks that:

- a request notification is delivered and a redelivery is acknowledged without a second email;
- a body that is valid but formatted differently passes raw-body verification, while a forged one is rejected and triggers the operator alert;
- the overdue workflow reminds every borrower, records both sent and failed sends, and creates no duplicates when it runs again.

It is skipped unless `N8N_E2E_SHARED_SECRET` is set. To run it, start the Docker stack with `CONVEX_HTTP_URL=http://host.docker.internal:3999`, import and publish the workflows as above, then:

```bash
N8N_E2E_SHARED_SECRET=<the N8N_SHARED_SECRET in .env> npm run test:e2e
```

## Production changes

- Deploy Next.js to Vercel and Convex to separate production deployments with production Clerk keys and a custom domain.
- Run n8n behind TLS with PostgreSQL, encrypted backups, a pinned container digest, external task runners, queue mode/workers if volume requires it, and restricted administrative access.
- Replace Mailpit with a transactional provider such as Postmark or SES using an n8n credential; retain the same minimal payload.
- Put independent rotating secrets on each integration direction, add a key ID header, and rotate without downtime.
- Use a durable dead-letter/replay process for failed automation events and alert on age/attempt thresholds.
- Add rate limiting and abuse controls to borrowing/listing mutations.
- Add pagination and replace small-dataset joins with denormalized read models as usage grows.
- Retain webhook receipts and execution payloads according to a documented privacy policy.
- Add end-to-end browser tests against dedicated Clerk and Convex test tenants plus monitoring for workflow and endpoint health.

## Repository map

```text
app/                 Next.js App Router pages and styles
components/          Shared public UI
convex/              Schema, authorization, domain logic, HTTP actions
n8n/                 Importable workflow exports (no credentials)
tests/               Authorization, domain, date, signing, and opt-in n8n end-to-end tests
docs/                Architecture and threat-boundary notes
docker-compose.yml   Local n8n and Mailpit
```
