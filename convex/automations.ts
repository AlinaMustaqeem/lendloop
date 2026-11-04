import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireUser } from "./lib/auth";
import { canonicalMessage, signMessage, verifyMessage } from "./lib/hmac";

export const getEvent = internalQuery({
  args: { eventId: v.id("automationEvents") },
  handler: (ctx, args) => ctx.db.get(args.eventId),
});

export const updateEventDelivery = internalMutation({
  args: {
    eventId: v.id("automationEvents"),
    status: v.union(v.literal("delivered"), v.literal("failed")),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const event = await ctx.db.get(args.eventId);
    if (!event) return;
    await ctx.db.patch(args.eventId, {
      status: args.status,
      attemptCount: event.attemptCount + 1,
      lastError: args.error,
      updatedAt: Date.now(),
    });
  },
});

export const deliverEvent = internalAction({
  args: { eventId: v.id("automationEvents") },
  handler: async (ctx, args) => {
    const event = await ctx.runQuery(internal.automations.getEvent, args);
    if (!event || event.status === "delivered") return;
    const url = process.env.N8N_REQUEST_WEBHOOK_URL;
    const secret = process.env.N8N_SHARED_SECRET;
    if (!url || !secret) {
      await ctx.runMutation(internal.automations.updateEventDelivery, {
        eventId: args.eventId,
        status: "failed",
        error: "Automation environment is not configured",
      });
      return;
    }

    const body = event.payload;
    const target = new URL(url);
    const path = `${target.pathname}${target.search}`;
    const timestamp = Date.now().toString();
    const signature = await signMessage(
      secret,
      canonicalMessage(timestamp, "POST", path, body),
    );

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-lendloop-timestamp": timestamp,
          "x-lendloop-signature": signature,
          "x-lendloop-event-id": event.eventId,
        },
        body,
      });
      if (!response.ok) throw new Error(`n8n returned HTTP ${response.status}`);
      const responseBody = await response.text();
      const responseTimestamp = response.headers.get("x-lendloop-timestamp") ?? "";
      const responseSignature = response.headers.get("x-lendloop-signature") ?? "";
      const responseIsValid =
        responseTimestamp === timestamp &&
        (await verifyMessage(
          secret,
          canonicalMessage(timestamp, response.status.toString(), path, responseBody),
          responseSignature,
        ));
      if (!responseIsValid) throw new Error("n8n returned an invalid acknowledgement signature");
      await ctx.runMutation(internal.automations.updateEventDelivery, {
        eventId: args.eventId,
        status: "delivered",
      });
    } catch (error) {
      await ctx.runMutation(internal.automations.updateEventDelivery, {
        eventId: args.eventId,
        status: "failed",
        error: error instanceof Error ? error.message.slice(0, 300) : "Unknown delivery error",
      });
      if (event.attemptCount < 2) {
        await ctx.scheduler.runAfter(
          60_000 * 2 ** event.attemptCount,
          internal.automations.deliverEvent,
          { eventId: args.eventId },
        );
      }
      throw error;
    }
  },
});

export const recentForLoan = query({
  args: { loanId: v.id("loans") },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const loan = await ctx.db.get(args.loanId);
    if (!loan) return [];
    if (
      user.role !== "admin" &&
      user._id !== loan.borrowerId &&
      user._id !== loan.lenderId
    ) {
      return [];
    }
    const events = await ctx.db
      .query("automationEvents")
      .withIndex("by_loan", (q) => q.eq("loanId", args.loanId))
      .collect();
    return events.sort((a, b) => b.createdAt - a.createdAt).slice(0, 10).map((event) => ({
      _id: event._id,
      type: event.type,
      status: event.status,
      createdAt: event.createdAt,
      updatedAt: event.updatedAt,
    }));
  },
});

export async function enqueueRequestEvent(
  ctx: MutationCtx,
  values: {
    requestId: Id<"borrowRequests">;
    loanId?: Id<"loans">;
    type: string;
    recipientEmail: string;
    payload: Record<string, unknown>;
  },
) {
  const now = Date.now();
  const eventKey = `${values.type}:${values.requestId}:${now}`;
  const id = await ctx.db.insert("automationEvents", {
    eventId: eventKey,
    type: values.type,
    requestId: values.requestId,
    ...(values.loanId ? { loanId: values.loanId } : {}),
    recipientEmail: values.recipientEmail,
    payload: JSON.stringify({ eventId: eventKey, type: values.type, ...values.payload }),
    status: "pending",
    attemptCount: 0,
    createdAt: now,
    updatedAt: now,
  });
  await ctx.scheduler.runAfter(0, internal.automations.deliverEvent, { eventId: id });
}
