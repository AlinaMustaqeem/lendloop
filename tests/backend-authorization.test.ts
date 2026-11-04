import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "@/convex/_generated/api";
import schema from "@/convex/schema";

const modules = import.meta.glob("../convex/**/*.ts");

async function seedCommunity() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const now = Date.now();
    const aliceId = await ctx.db.insert("users", {
      clerkUserId: "alice",
      name: "Alice",
      email: "alice@example.test",
      role: "user",
      isTrustedLender: false,
      updatedAt: now,
    });
    const bobId = await ctx.db.insert("users", {
      clerkUserId: "bob",
      name: "Bob",
      email: "bob@example.test",
      role: "user",
      isTrustedLender: false,
      updatedAt: now,
    });
    const adminId = await ctx.db.insert("users", {
      clerkUserId: "admin",
      name: "Admin",
      email: "admin@example.test",
      role: "admin",
      isTrustedLender: false,
      updatedAt: now,
    });
    const toolId = await ctx.db.insert("tools", {
      ownerId: aliceId,
      name: "Cordless drill",
      category: "power tools",
      condition: "good",
      description: "18V drill with two batteries",
      isArchived: false,
      createdAt: now,
      updatedAt: now,
    });
    return { aliceId, bobId, adminId, toolId };
  });
  return {
    t,
    ids,
    alice: t.withIdentity({ subject: "alice", name: "Alice", email: "alice@example.test" }),
    bob: t.withIdentity({ subject: "bob", name: "Bob", email: "bob@example.test" }),
    admin: t.withIdentity({ subject: "admin", name: "Admin", email: "admin@example.test" }),
  };
}

describe("Convex authorization boundaries", () => {
  it("rejects anonymous writes and cross-owner listing changes", async () => {
    const { t, ids, bob } = await seedCommunity();
    await expect(
      t.mutation(api.tools.create, {
        name: "Saw",
        category: "hand tools",
        condition: "good",
        description: "A useful saw",
      }),
    ).rejects.toThrow();
    await expect(
      bob.mutation(api.tools.update, {
        toolId: ids.toolId,
        name: "Changed by Bob",
        category: "power tools",
        condition: "fair",
        description: "This must not be accepted",
      }),
    ).rejects.toThrow();
  });

  it("exposes no owner data through the public catalogue", async () => {
    const { t } = await seedCommunity();
    const tools = await t.query(api.tools.listPublicAvailable, {});
    expect(tools).toHaveLength(1);
    expect(Object.keys(tools[0]).sort()).toEqual(["_id", "category", "name"]);
  });

  it("allows only the lender to decide a request and creates one loan", async () => {
    const { t, ids, alice, bob } = await seedCommunity();
    const requestId = await bob.mutation(api.requests.create, {
      toolId: ids.toolId,
      startDate: "2099-02-01",
      endDate: "2099-02-03",
      note: "Weekend project",
    });
    await expect(
      bob.mutation(api.requests.decide, { requestId, decision: "approved" }),
    ).rejects.toThrow();
    await alice.mutation(api.requests.decide, { requestId, decision: "approved" });
    const loans = await t.run((ctx) => ctx.db.query("loans").collect());
    expect(loans).toHaveLength(1);
    expect(loans[0]).toMatchObject({ requestId, borrowerId: ids.bobId, lenderId: ids.aliceId });
  });

  it("cancels pending requests when the owner removes a listing", async () => {
    const { t, ids, alice, bob } = await seedCommunity();
    const requestId = await bob.mutation(api.requests.create, {
      toolId: ids.toolId,
      startDate: "2099-03-01",
      endDate: "2099-03-02",
    });
    await alice.mutation(api.tools.remove, { toolId: ids.toolId });
    const request = await t.run((ctx) => ctx.db.get("borrowRequests", requestId));
    const tool = await t.run((ctx) => ctx.db.get("tools", ids.toolId));
    const events = await t.run((ctx) => ctx.db.query("automationEvents").collect());
    expect(request?.status).toBe("cancelled");
    expect(tool?.isArchived).toBe(true);
    expect(events.some((event) => event.type === "request.cancelled")).toBe(true);
  });

  it("enforces admin-only Trusted Lender assignment", async () => {
    const { t, ids, bob, admin } = await seedCommunity();
    await expect(
      bob.mutation(api.users.setTrustedLender, { userId: ids.aliceId, trusted: true }),
    ).rejects.toThrow();
    await admin.mutation(api.users.setTrustedLender, { userId: ids.aliceId, trusted: true });
    const alice = await t.run((ctx) => ctx.db.get(ids.aliceId));
    expect(alice?.isTrustedLender).toBe(true);
  });

  it("prevents two overlapping approvals for the same tool", async () => {
    const { ids, alice, bob } = await seedCommunity();
    const first = await bob.mutation(api.requests.create, {
      toolId: ids.toolId,
      startDate: "2099-04-10",
      endDate: "2099-04-12",
    });
    const second = await bob.mutation(api.requests.create, {
      toolId: ids.toolId,
      startDate: "2099-04-12",
      endDate: "2099-04-14",
    });
    await alice.mutation(api.requests.decide, { requestId: first, decision: "approved" });
    await expect(
      alice.mutation(api.requests.decide, { requestId: second, decision: "approved" }),
    ).rejects.toThrow();
  });

  it("declines overlapping pending requests when one is approved", async () => {
    const { t, ids, alice, bob, admin } = await seedCommunity();
    const approved = await bob.mutation(api.requests.create, {
      toolId: ids.toolId,
      startDate: "2099-06-10",
      endDate: "2099-06-12",
    });
    const overlapping = await admin.mutation(api.requests.create, {
      toolId: ids.toolId,
      startDate: "2099-06-12",
      endDate: "2099-06-15",
    });
    const separate = await admin.mutation(api.requests.create, {
      toolId: ids.toolId,
      startDate: "2099-06-20",
      endDate: "2099-06-21",
    });
    await alice.mutation(api.requests.decide, { requestId: approved, decision: "approved" });
    const state = await t.run(async (ctx) => ({
      overlapping: await ctx.db.get("borrowRequests", overlapping),
      separate: await ctx.db.get("borrowRequests", separate),
      events: await ctx.db.query("automationEvents").collect(),
    }));
    expect(state.overlapping?.status).toBe("declined");
    expect(state.separate?.status).toBe("pending");
    expect(
      state.events.some((event) => event.type === "request.declined" && event.requestId === overlapping),
    ).toBe(true);
  });

  it("links the approval notification to the new loan's activity", async () => {
    const { t, ids, alice, bob } = await seedCommunity();
    const requestId = await bob.mutation(api.requests.create, {
      toolId: ids.toolId,
      startDate: "2099-07-01",
      endDate: "2099-07-02",
    });
    await alice.mutation(api.requests.decide, { requestId, decision: "approved" });
    const loan = await t.run((ctx) => ctx.db.query("loans").first());
    const activity = await bob.query(api.automations.recentForLoan, { loanId: loan!._id });
    expect(activity.map((event: { type: string }) => event.type)).toContain("request.approved");
    const outsider = t.withIdentity({ subject: "nobody" });
    await expect(outsider.query(api.automations.recentForLoan, { loanId: loan!._id })).rejects.toThrow();
  });

  it("keeps reminder write-backs idempotent", async () => {
    const { t, ids } = await seedCommunity();
    const loanId = await t.run(async (ctx) => {
      const now = Date.now();
      const requestId = await ctx.db.insert("borrowRequests", {
        toolId: ids.toolId,
        borrowerId: ids.bobId,
        lenderId: ids.aliceId,
        startDate: "2099-05-01",
        endDate: "2099-05-02",
        status: "approved",
        createdAt: now,
        updatedAt: now,
      });
      return ctx.db.insert("loans", {
        requestId,
        toolId: ids.toolId,
        borrowerId: ids.bobId,
        lenderId: ids.aliceId,
        startDate: "2099-05-01",
        dueDate: "2099-05-02",
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
    });
    const args = {
      idempotencyKey: `overdue-reminder:${loanId}:2099-05-03`,
      loanId,
      reminderDate: "2099-05-03",
      status: "sent" as const,
    };
    await t.mutation(internal.webhooks.recordReminder, args);
    await t.mutation(internal.webhooks.recordReminder, args);
    const state = await t.run(async (ctx) => ({
      reminders: await ctx.db.query("reminders").collect(),
      events: await ctx.db.query("automationEvents").collect(),
    }));
    expect(state.reminders).toHaveLength(1);
    expect(state.events.filter((event) => event.type === "reminder.overdue")).toHaveLength(1);
  });

  it("records failed reminders, upgrades them on a successful rerun, and dedupes retried write-backs", async () => {
    const { t, ids } = await seedCommunity();
    const loanId = await t.run(async (ctx) => {
      const now = Date.now();
      const requestId = await ctx.db.insert("borrowRequests", {
        toolId: ids.toolId,
        borrowerId: ids.bobId,
        lenderId: ids.aliceId,
        startDate: "2020-01-01",
        endDate: "2020-01-02",
        status: "approved",
        createdAt: now,
        updatedAt: now,
      });
      return ctx.db.insert("loans", {
        requestId,
        toolId: ids.toolId,
        borrowerId: ids.bobId,
        lenderId: ids.aliceId,
        startDate: "2020-01-01",
        dueDate: "2020-01-02",
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
    });
    const key = `overdue-reminder:${loanId}:2020-01-05`;
    const base = { idempotencyKey: key, loanId, reminderDate: "2020-01-05" };

    await t.mutation(internal.webhooks.recordReminder, {
      ...base,
      receiptEventId: `${key}:failed:1`,
      status: "failed",
      error: "Mailpit returned HTTP 500",
    });
    // A failed reminder stays in the overdue list so the next run retries it.
    expect(await t.query(internal.webhooks.overdueLoans, { today: "2020-01-05" })).toHaveLength(1);

    const sent = await t.mutation(internal.webhooks.recordReminder, {
      ...base,
      receiptEventId: `${key}:sent:2`,
      status: "sent",
    });
    const retried = await t.mutation(internal.webhooks.recordReminder, {
      ...base,
      receiptEventId: `${key}:sent:2`,
      status: "sent",
    });
    expect(sent.duplicate).toBe(false);
    expect(retried.duplicate).toBe(true);

    const state = await t.run(async (ctx) => ({
      reminders: await ctx.db.query("reminders").collect(),
      events: await ctx.db.query("automationEvents").collect(),
    }));
    expect(state.reminders).toHaveLength(1);
    expect(state.reminders[0].status).toBe("sent");
    const activity = state.events.filter((event) => event.type === "reminder.overdue");
    expect(activity).toHaveLength(1);
    expect(activity[0].status).toBe("delivered");
    expect(await t.query(internal.webhooks.overdueLoans, { today: "2020-01-05" })).toHaveLength(0);
  });
});
