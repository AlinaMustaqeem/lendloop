import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";

async function claim(ctx: MutationCtx, eventId: string, source: string) {
  const existing = await ctx.db
    .query("webhookReceipts")
    .withIndex("by_event_id", (q) => q.eq("eventId", eventId))
    .unique();
  if (existing) return false;
  await ctx.db.insert("webhookReceipts", { eventId, source, receivedAt: Date.now() });
  return true;
}

export const claimReceipt = internalMutation({
  args: { eventId: v.string(), source: v.string() },
  handler: (ctx, args) => claim(ctx, args.eventId, args.source),
});

export const normalizeLoanId = internalQuery({
  args: { loanId: v.string() },
  handler: async (ctx, args) => {
    const loanId = ctx.db.normalizeId("loans", args.loanId);
    if (!loanId) return null;
    return (await ctx.db.get(loanId)) ? loanId : null;
  },
});

export const overdueLoans = internalQuery({
  args: { today: v.string() },
  handler: async (ctx, args) => {
    const active = await ctx.db
      .query("loans")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .collect();
    const items = [];
    for (const loan of active) {
      if (loan.dueDate >= args.today) continue;
      const key = `overdue-reminder:${loan._id}:${args.today}`;
      const existing = await ctx.db
        .query("reminders")
        .withIndex("by_idempotency_key", (q) => q.eq("idempotencyKey", key))
        .unique();
      if (existing?.status === "sent") continue;
      const borrower = await ctx.db.get(loan.borrowerId);
      const tool = await ctx.db.get(loan.toolId);
      if (!borrower || !tool || !borrower.email) continue;
      items.push({
        loanId: loan._id,
        idempotencyKey: key,
        recipientEmail: borrower.email,
        recipientName: borrower.name,
        toolName: tool.name,
        dueDate: loan.dueDate,
      });
    }
    return items;
  },
});

export const recordReminder = internalMutation({
  args: {
    receiptEventId: v.optional(v.string()),
    idempotencyKey: v.string(),
    loanId: v.id("loans"),
    reminderDate: v.string(),
    status: v.union(v.literal("sent"), v.literal("failed")),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (args.receiptEventId && !(await claim(ctx, args.receiptEventId, "n8n.reminder.writeback"))) {
      return { duplicate: true };
    }
    const existing = await ctx.db
      .query("reminders")
      .withIndex("by_idempotency_key", (q) => q.eq("idempotencyKey", args.idempotencyKey))
      .unique();
    const now = Date.now();
    if (existing) {
      // A reminder that was already sent is final; repeated write-backs are no-ops.
      if (existing.status === "sent") return { duplicate: false, reminderId: existing._id };
      await ctx.db.patch(existing._id, {
        status: args.status,
        sentAt: args.status === "sent" ? now : undefined,
        error: args.error,
        updatedAt: now,
      });
      // Keep the loan's activity entry in step with the reminder (failed -> sent on a rerun).
      const activity = await ctx.db
        .query("automationEvents")
        .withIndex("by_event_id", (q) => q.eq("eventId", args.idempotencyKey))
        .unique();
      if (activity) {
        await ctx.db.patch(activity._id, {
          status: args.status === "sent" ? "delivered" : "failed",
          attemptCount: activity.attemptCount + 1,
          lastError: args.error,
          updatedAt: now,
        });
      }
      return { duplicate: false, reminderId: existing._id };
    }
    const reminderId = await ctx.db.insert("reminders", {
      idempotencyKey: args.idempotencyKey,
      loanId: args.loanId,
      reminderDate: args.reminderDate,
      status: args.status,
      sentAt: args.status === "sent" ? now : undefined,
      error: args.error,
      updatedAt: now,
    });
    await ctx.db.insert("automationEvents", {
      eventId: args.idempotencyKey,
      type: "reminder.overdue",
      loanId: args.loanId,
      payload: JSON.stringify({ reminderDate: args.reminderDate }),
      status: args.status === "sent" ? "delivered" : "failed",
      attemptCount: 1,
      lastError: args.error,
      createdAt: now,
      updatedAt: now,
    });
    return { duplicate: false, reminderId };
  },
});
