// @vitest-environment node
/**
 * Opt-in end-to-end test: real Convex functions (run by convex-test) <-> real n8n + Mailpit.
 *
 * The Convex HTTP actions are served on the host so the n8n container can reach them at
 * CONVEX_HTTP_URL=http://host.docker.internal:3999. See "End-to-end automation test" in the README.
 * Skipped unless N8N_E2E_SHARED_SECRET is set to the same secret the n8n container uses.
 */
import { convexTest } from "convex-test";
import { execFile } from "node:child_process";
import { createHmac } from "node:crypto";
import { createServer, type Server } from "node:http";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, internal } from "@/convex/_generated/api";
import schema from "@/convex/schema";

const secret = process.env.N8N_E2E_SHARED_SECRET;
const N8N_URL = process.env.N8N_E2E_URL ?? "http://localhost:5678";
const MAILPIT_URL = process.env.N8N_E2E_MAILPIT_URL ?? "http://localhost:8025";
const CONVEX_PORT = Number(process.env.N8N_E2E_CONVEX_PORT ?? 3999);
const WEBHOOK_PATH = "/webhook/lendloop-request-events";

const exec = promisify(execFile);
const modules = import.meta.glob("../convex/**/*.ts");

type Mail = { Subject: string; To: Array<{ Address: string }> };

async function mailbox(): Promise<Mail[]> {
  const response = await fetch(`${MAILPIT_URL}/api/v1/messages?limit=200`);
  return ((await response.json()) as { messages: Mail[] }).messages;
}

async function waitFor<T>(check: () => Promise<T | undefined | false>, timeoutMs = 20_000): Promise<T> {
  const started = Date.now();
  for (;;) {
    const result = await check();
    if (result) return result;
    if (Date.now() - started > timeoutMs) throw new Error("Timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

async function runOverdueWorkflow() {
  // Uses COMPOSE_PROJECT_NAME from the environment when set.
  const { stdout } = await exec("docker", ["compose", "ps", "-q", "n8n"]);
  const container = stdout.trim();
  try {
    // Async on purpose: the workflow calls back into the Convex server running in this process.
    // The CLI starts its own task broker, so it needs a port the running n8n is not using.
    const result = await exec("docker", ["exec", "-e", "N8N_RUNNERS_BROKER_PORT=5690", container, "n8n", "execute", "--id=LendLoopOverdue1"]);
    return result.stdout;
  } catch (error) {
    // The workflow intentionally fails when a reminder could not be sent.
    return String((error as { stdout?: string }).stdout ?? "");
  }
}

describe.skipIf(!secret)("n8n automation end to end", () => {
  const t = convexTest(schema, modules);
  let server: Server;
  let ids: Record<string, string>;

  beforeAll(async () => {
    process.env.N8N_SHARED_SECRET = secret;
    process.env.N8N_REQUEST_WEBHOOK_URL = `${N8N_URL}${WEBHOOK_PATH}`;

    // Expose the Convex HTTP router (convex/http.ts) to the n8n container.
    server = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const headers = Object.fromEntries(
        Object.entries(req.headers).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
      );
      const response = await t.fetch(req.url!, {
        method: req.method,
        headers,
        body: req.method === "GET" ? undefined : Buffer.concat(chunks).toString("utf8"),
      });
      res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
      res.end(await response.text());
    });
    await new Promise<void>((resolve) => server.listen(CONVEX_PORT, "0.0.0.0", resolve));
    await fetch(`${MAILPIT_URL}/api/v1/messages`, { method: "DELETE" });

    ids = await t.run(async (ctx) => {
      const now = Date.now();
      const user = (key: string, email: string) =>
        ctx.db.insert("users", { clerkUserId: key, name: key[0].toUpperCase() + key.slice(1), email, role: "user", isTrustedLender: false, updatedAt: now });
      const aliceId = await user("alice", "alice@example.test");
      const bobId = await user("bob", "bob@example.test");
      const carolId = await user("carol", "carol@example.test");
      // An address Mailpit rejects, to exercise the failure branch.
      const daveId = await user("dave", "not-an-email");
      const tool = (name: string) =>
        ctx.db.insert("tools", { ownerId: aliceId, name, category: "power tools", condition: "good", description: name, isArchived: false, createdAt: now, updatedAt: now });
      const drillId = await tool("Cordless drill");
      const loan = async (borrowerId: typeof bobId, name: string) => {
        const toolId = await tool(name);
        const requestId = await ctx.db.insert("borrowRequests", { toolId, borrowerId, lenderId: aliceId, startDate: "2020-01-01", endDate: "2020-01-02", status: "approved", createdAt: now, updatedAt: now });
        return ctx.db.insert("loans", { requestId, toolId, borrowerId, lenderId: aliceId, startDate: "2020-01-01", dueDate: "2020-01-02", status: "active", createdAt: now, updatedAt: now });
      };
      return {
        aliceId, bobId, drillId,
        bobLoan: await loan(bobId, "Ladder"),
        carolLoan: await loan(carolId, "Hedge trimmer"),
        daveLoan: await loan(daveId, "Tent"),
      };
    });
  }, 30_000);

  afterAll(() => new Promise<void>((resolve) => server?.close(() => resolve())));

  it("delivers a signed request notification and acknowledges a redelivery without a second email", async () => {
    const bob = t.withIdentity({ subject: "bob" });
    await bob.mutation(api.requests.create, { toolId: ids.drillId as never, startDate: "2099-01-01", endDate: "2099-01-03" });

    const event = await waitFor(async () => {
      const [row] = await t.run((ctx) => ctx.db.query("automationEvents").collect());
      return row && row.status !== "pending" ? row : undefined;
    });
    expect(event).toMatchObject({ status: "delivered", attemptCount: 1 });
    await waitFor(async () => (await mailbox()).find((mail) => mail.Subject === "New request for Cordless drill"));

    // Simulate Convex retrying after a lost acknowledgement: same event ID, fresh signature.
    await t.run((ctx) => ctx.db.patch(event._id, { status: "pending" }));
    await t.action(internal.automations.deliverEvent, { eventId: event._id });
    const redelivered = await t.run((ctx) => ctx.db.get(event._id));
    expect(redelivered?.status).toBe("delivered");
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect((await mailbox()).filter((mail) => mail.Subject === "New request for Cordless drill")).toHaveLength(1);
  }, 40_000);

  it("verifies the exact raw body and alerts an operator when a forged webhook is rejected", async () => {
    const send = (rawBody: string, signedBody = rawBody) => {
      const timestamp = Date.now().toString();
      const signature = createHmac("sha256", secret!).update(`${timestamp}.POST.${WEBHOOK_PATH}.${signedBody}`).digest("hex");
      const eventId = JSON.parse(rawBody).eventId as string;
      return fetch(`${N8N_URL}${WEBHOOK_PATH}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-lendloop-timestamp": timestamp, "x-lendloop-signature": signature, "x-lendloop-event-id": eventId },
        body: rawBody,
      });
    };
    const event = { eventId: `e2e-raw-${Date.now()}`, type: "request.approved", recipientEmail: "bob@example.test", recipientName: "Bob", toolName: "Raw body probe", startDate: "2099-01-01", endDate: "2099-01-02", status: "approved" };

    // Formatting that JSON.parse/JSON.stringify would not reproduce: only raw-body verification accepts it.
    const pretty = JSON.stringify(event, null, 2);
    expect((await send(pretty)).status).toBe(200);
    await waitFor(async () => (await mailbox()).find((mail) => mail.Subject === "Your Raw body probe request was approved"));

    const forged = JSON.stringify({ ...event, eventId: `e2e-forged-${Date.now()}`, toolName: "Forged" });
    const tampered = await send(forged, JSON.stringify({ ...JSON.parse(forged), toolName: "Original" }));
    expect(tampered.status).not.toBe(200);
    const alert = await waitFor(async () => (await mailbox()).find((mail) => mail.Subject.startsWith("[LendLoop] LendLoop - Request notifications failed")));
    expect(alert.To[0].Address).toBe("ops@lendloop.local");
    expect((await mailbox()).some((mail) => mail.Subject.includes("Forged"))).toBe(false);
  }, 40_000);

  it("reminds every overdue borrower, writes back sent and failed results, and stays idempotent on rerun", async () => {
    const output = await runOverdueWorkflow();
    const reminders = await waitFor(async () => {
      const rows = await t.run((ctx) => ctx.db.query("reminders").collect());
      return rows.length === 3 ? rows : undefined;
    }, 10_000).catch((error: Error) => {
      throw new Error(`${error.message}. n8n CLI output:\n${output.slice(-3000)}`);
    });
    const byLoan = Object.fromEntries(reminders.map((row) => [row.loanId, row.status]));
    expect(byLoan).toEqual({ [ids.bobLoan]: "sent", [ids.carolLoan]: "sent", [ids.daveLoan]: "failed" });
    expect(output).toContain("failed to send");

    const subjects = (await mailbox()).map((mail) => mail.Subject);
    expect(subjects).toContain("Reminder: Ladder is overdue");
    expect(subjects).toContain("Reminder: Hedge trimmer is overdue");

    // A rerun the same day only retries the failed reminder and creates no duplicate records.
    await runOverdueWorkflow();
    const after = await t.run(async (ctx) => ({
      reminders: await ctx.db.query("reminders").collect(),
      activity: (await ctx.db.query("automationEvents").collect()).filter((event) => event.type === "reminder.overdue"),
    }));
    expect(after.reminders).toHaveLength(3);
    expect(after.activity).toHaveLength(3);
    expect((await mailbox()).filter((mail) => mail.Subject === "Reminder: Ladder is overdue")).toHaveLength(1);

    const visibleToBob = await t.withIdentity({ subject: "bob" }).query(api.automations.recentForLoan, { loanId: ids.bobLoan as never });
    expect(visibleToBob[0]).toMatchObject({ type: "reminder.overdue", status: "delivered" });
  }, 120_000);
});
