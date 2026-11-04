import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { requireUser } from "./lib/auth";
import { assertDateRange, rangesOverlap, todayUtc } from "./lib/dates";
import { enqueueRequestEvent } from "./automations";

export const create = mutation({
  args: {
    toolId: v.id("tools"),
    startDate: v.string(),
    endDate: v.string(),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const borrower = await requireUser(ctx);
    const tool = await ctx.db.get(args.toolId);
    if (!tool || tool.isArchived) throw new ConvexError("Tool not found");
    if (tool.ownerId === borrower._id) throw new ConvexError("You cannot borrow your own tool");
    assertDateRange(args.startDate, args.endDate);
    if (args.startDate < todayUtc()) throw new ConvexError("Start date cannot be in the past");
    const note = args.note?.trim();
    if (note && note.length > 300) throw new ConvexError("Note cannot exceed 300 characters");
    const lender = await ctx.db.get(tool.ownerId);
    if (!lender) throw new ConvexError("Lender not found");
    const now = Date.now();
    const requestId = await ctx.db.insert("borrowRequests", {
      toolId: tool._id,
      borrowerId: borrower._id,
      lenderId: tool.ownerId,
      startDate: args.startDate,
      endDate: args.endDate,
      note: note || undefined,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    });
    await enqueueRequestEvent(ctx, {
      requestId,
      type: "request.created",
      recipientEmail: lender.email,
      payload: {
        recipientEmail: lender.email,
        recipientName: lender.name,
        toolName: tool.name,
        borrowerName: borrower.name,
        startDate: args.startDate,
        endDate: args.endDate,
        status: "pending",
      },
    });
    return requestId;
  },
});

export const decide = mutation({
  args: {
    requestId: v.id("borrowRequests"),
    decision: v.union(v.literal("approved"), v.literal("declined")),
  },
  handler: async (ctx, args) => {
    const lender = await requireUser(ctx);
    const request = await ctx.db.get(args.requestId);
    if (!request) throw new ConvexError("Request not found");
    if (request.lenderId !== lender._id) throw new ConvexError("Only the lender can decide this request");
    if (request.status !== "pending") throw new ConvexError("Only pending requests can be decided");
    const tool = await ctx.db.get(request.toolId);
    const borrower = await ctx.db.get(request.borrowerId);
    if (!tool || tool.isArchived || !borrower) throw new ConvexError("Related record not found or listing is no longer active");

    if (args.decision === "approved") {
      const existingLoans = await ctx.db
        .query("loans")
        .withIndex("by_tool", (q) => q.eq("toolId", request.toolId))
        .collect();
      const conflict = existingLoans.some(
        (loan) =>
          loan.status === "active" &&
          rangesOverlap(request.startDate, request.endDate, loan.startDate, loan.dueDate),
      );
      if (conflict) throw new ConvexError("This tool is already booked for overlapping dates");
    }

    const now = Date.now();
    await ctx.db.patch(request._id, {
      status: args.decision,
      decidedAt: now,
      updatedAt: now,
    });
    let loanId: Id<"loans"> | undefined;
    if (args.decision === "approved") {
      loanId = await ctx.db.insert("loans", {
        requestId: request._id,
        toolId: request.toolId,
        borrowerId: request.borrowerId,
        lenderId: request.lenderId,
        startDate: request.startDate,
        dueDate: request.endDate,
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
    }
    await enqueueRequestEvent(ctx, {
      requestId: request._id,
      loanId,
      type: `request.${args.decision}`,
      recipientEmail: borrower.email,
      payload: {
        recipientEmail: borrower.email,
        recipientName: borrower.name,
        toolName: tool.name,
        lenderName: lender.name,
        startDate: request.startDate,
        endDate: request.endDate,
        status: args.decision,
      },
    });

    if (args.decision === "approved") {
      // The approved dates are now booked, so any other pending request that
      // overlaps them can never be approved. Decline them in the same
      // transaction so those borrowers hear back instead of waiting forever.
      const pendingForTool = await ctx.db
        .query("borrowRequests")
        .withIndex("by_tool", (q) => q.eq("toolId", request.toolId))
        .collect();
      for (const other of pendingForTool) {
        if (
          other._id === request._id ||
          other.status !== "pending" ||
          !rangesOverlap(request.startDate, request.endDate, other.startDate, other.endDate)
        ) {
          continue;
        }
        const otherBorrower = await ctx.db.get(other.borrowerId);
        await ctx.db.patch(other._id, { status: "declined", decidedAt: now, updatedAt: now });
        if (!otherBorrower) continue;
        await enqueueRequestEvent(ctx, {
          requestId: other._id,
          type: "request.declined",
          recipientEmail: otherBorrower.email,
          payload: {
            recipientEmail: otherBorrower.email,
            recipientName: otherBorrower.name,
            toolName: tool.name,
            lenderName: lender.name,
            startDate: other.startDate,
            endDate: other.endDate,
            status: "declined",
            message: "Those dates were booked by another neighbor",
          },
        });
      }
    }
  },
});

export const cancel = mutation({
  args: { requestId: v.id("borrowRequests") },
  handler: async (ctx, args) => {
    const borrower = await requireUser(ctx);
    const request = await ctx.db.get(args.requestId);
    if (!request) throw new ConvexError("Request not found");
    if (request.borrowerId !== borrower._id) throw new ConvexError("Only the borrower can cancel this request");
    if (request.status !== "pending") throw new ConvexError("Only pending requests can be cancelled");
    const tool = await ctx.db.get(request.toolId);
    const lender = await ctx.db.get(request.lenderId);
    if (!tool || !lender) throw new ConvexError("Related record not found");
    await ctx.db.patch(request._id, { status: "cancelled", updatedAt: Date.now() });
    await enqueueRequestEvent(ctx, {
      requestId: request._id,
      type: "request.cancelled",
      recipientEmail: lender.email,
      payload: {
        recipientEmail: lender.email,
        recipientName: lender.name,
        toolName: tool.name,
        borrowerName: borrower.name,
        startDate: request.startDate,
        endDate: request.endDate,
        status: "cancelled",
        message: `${borrower.name} cancelled this request`,
      },
    });
  },
});

type RequestForDisplay = Record<string, unknown> & {
  toolId: Id<"tools">;
  borrowerId: Id<"users">;
  lenderId: Id<"users">;
};

async function decorate(ctx: QueryCtx, requests: RequestForDisplay[]) {
  const results = [];
  for (const request of requests) {
    const tool = await ctx.db.get(request.toolId);
    const borrower = await ctx.db.get(request.borrowerId);
    const lender = await ctx.db.get(request.lenderId);
    results.push({ ...request, toolName: tool?.name, borrowerName: borrower?.name, lenderName: lender?.name });
  }
  return results;
}

export const mine = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const rows = await ctx.db
      .query("borrowRequests")
      .withIndex("by_borrower", (q) => q.eq("borrowerId", user._id))
      .collect();
    return decorate(ctx, rows as RequestForDisplay[]);
  },
});

export const incoming = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const rows = await ctx.db
      .query("borrowRequests")
      .withIndex("by_lender", (q) => q.eq("lenderId", user._id))
      .collect();
    return decorate(ctx, rows as RequestForDisplay[]);
  },
});
