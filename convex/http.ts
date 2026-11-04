import { httpRouter } from "convex/server";
import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import { canonicalMessage, signMessage, verifyMessage } from "./lib/hmac";

const http = httpRouter();
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

function json(data: unknown, status = 200, headers?: HeadersInit) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

async function authenticate(request: Request, rawBody: string) {
  const secret = process.env.N8N_SHARED_SECRET;
  if (!secret) return { ok: false as const, error: "Server integration is not configured" };
  const timestamp = request.headers.get("x-lendloop-timestamp") ?? "";
  const signature = request.headers.get("x-lendloop-signature") ?? "";
  const eventId = request.headers.get("x-lendloop-event-id") ?? "";
  const timestampNumber = Number(timestamp);
  if (!timestamp || !eventId || !Number.isFinite(timestampNumber)) {
    return { ok: false as const, error: "Missing authentication headers" };
  }
  if (Math.abs(Date.now() - timestampNumber) > MAX_CLOCK_SKEW_MS) {
    return { ok: false as const, error: "Request timestamp is stale" };
  }
  const url = new URL(request.url);
  const path = `${url.pathname}${url.search}`;
  const valid = await verifyMessage(
    secret,
    canonicalMessage(timestamp, request.method, path, rawBody),
    signature,
  );
  return valid
    ? { ok: true as const, eventId, timestamp, secret, path }
    : { ok: false as const, error: "Invalid signature" };
}

async function signedJson(
  data: unknown,
  auth: { timestamp: string; secret: string; path: string },
  status = 200,
) {
  const body = JSON.stringify(data);
  const signature = await signMessage(
    auth.secret,
    canonicalMessage(auth.timestamp, status.toString(), auth.path, body),
  );
  return new Response(body, {
    status,
    headers: {
      "content-type": "application/json",
      "x-lendloop-timestamp": auth.timestamp,
      "x-lendloop-signature": signature,
    },
  });
}

http.route({
  path: "/api/n8n/overdue",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const auth = await authenticate(request, "");
    if (!auth.ok) return json({ error: auth.error }, 401);
    const today = new URL(request.url).searchParams.get("date") ?? new Date().toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) return json({ error: "Invalid date" }, 400);
    const items = await ctx.runQuery(internal.webhooks.overdueLoans, { today });
    // Claim the event ID only after the read succeeded, so a retry after a
    // transient failure is still accepted while a replayed request is not.
    const claimed = await ctx.runMutation(internal.webhooks.claimReceipt, {
      eventId: auth.eventId,
      source: "n8n.overdue.fetch",
    });
    if (!claimed) return json({ error: "Replayed event ID" }, 409);
    return signedJson({ items }, auth);
  }),
});

http.route({
  path: "/api/n8n/reminders",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const rawBody = await request.text();
    const auth = await authenticate(request, rawBody);
    if (!auth.ok) return json({ error: auth.error }, 401);
    let body: {
      idempotencyKey?: string;
      loanId?: string;
      reminderDate?: string;
      status?: "sent" | "failed";
      error?: string;
    };
    try {
      body = JSON.parse(rawBody) as typeof body;
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }
    if (!body.idempotencyKey || !body.loanId || !body.reminderDate || !body.status) {
      return json({ error: "Missing reminder fields" }, 400);
    }
    if (body.status !== "sent" && body.status !== "failed") {
      return json({ error: "Invalid reminder status" }, 400);
    }
    const loanId = await ctx.runQuery(internal.webhooks.normalizeLoanId, { loanId: body.loanId });
    if (!loanId) return json({ error: "Unknown loan" }, 400);
    // The receipt claim and the reminder upsert run in one transaction, so a
    // retried write-back (same event ID) is acknowledged without writing twice.
    const result = await ctx.runMutation(internal.webhooks.recordReminder, {
      receiptEventId: auth.eventId,
      idempotencyKey: body.idempotencyKey,
      loanId,
      reminderDate: body.reminderDate,
      status: body.status,
      error: body.error?.slice(0, 300),
    });
    return signedJson(result.duplicate ? { duplicate: true } : { ok: true }, auth);
  }),
});

export default http;
