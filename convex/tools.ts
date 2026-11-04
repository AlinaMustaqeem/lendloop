import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { assertOwner, requireAdmin, requireUser } from "./lib/auth";
import { todayUtc } from "./lib/dates";
import { enqueueRequestEvent } from "./automations";

const condition = v.union(
  v.literal("like-new"),
  v.literal("good"),
  v.literal("fair"),
);

function clean(value: string, max: number, label: string) {
  const result = value.trim();
  if (!result || result.length > max) {
    throw new ConvexError(`${label} must be between 1 and ${max} characters`);
  }
  return result;
}

async function cancelPendingRequests(
  ctx: MutationCtx,
  tool: { _id: Id<"tools">; name: string },
  lenderName: string,
) {
  const requests = await ctx.db
    .query("borrowRequests")
    .withIndex("by_tool", (q) => q.eq("toolId", tool._id))
    .collect() as Array<{
      _id: Id<"borrowRequests">;
      borrowerId: Id<"users">;
      startDate: string;
      endDate: string;
      status: string;
    }>;
  for (const request of requests) {
    if (request.status !== "pending") continue;
    const borrower = await ctx.db.get("users", request.borrowerId) as {
      name: string;
      email: string;
    } | null;
    await ctx.db.patch(request._id, { status: "cancelled", updatedAt: Date.now() });
    if (borrower) {
      await enqueueRequestEvent(ctx, {
        requestId: request._id,
        type: "request.cancelled",
        recipientEmail: borrower.email,
        payload: {
          recipientEmail: borrower.email,
          recipientName: borrower.name,
          toolName: tool.name,
          lenderName,
          startDate: request.startDate,
          endDate: request.endDate,
          status: "cancelled",
          message: "This listing is no longer available",
        },
      });
    }
  }
}

export const listPublicAvailable = query({
  args: { category: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const tools = args.category
      ? await ctx.db
          .query("tools")
          .withIndex("by_category", (q) => q.eq("category", args.category!))
          .collect()
      : await ctx.db.query("tools").collect();

    const visible = [];
    for (const tool of tools) {
      if (tool.isArchived) continue;
      const loans = await ctx.db
        .query("loans")
        .withIndex("by_tool", (q) => q.eq("toolId", tool._id))
        .collect();
      const today = todayUtc();
      if (!loans.some((loan) => loan.status === "active" && loan.startDate <= today && loan.dueDate >= today)) {
        visible.push({ _id: tool._id, name: tool.name, category: tool.category });
      }
    }
    return visible;
  },
});

export const listAll = query({
  args: { category: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    const tools = args.category
      ? await ctx.db
          .query("tools")
          .withIndex("by_category", (q) => q.eq("category", args.category!))
          .collect()
      : await ctx.db.query("tools").collect();
    const results = [];
    for (const tool of tools) {
      if (tool.isArchived) continue;
      const owner = await ctx.db.get(tool.ownerId);
      const loans = await ctx.db
        .query("loans")
        .withIndex("by_tool", (q) => q.eq("toolId", tool._id))
        .collect();
      results.push({
        ...tool,
        available: !loans.some((loan) => {
          const today = todayUtc();
          return loan.status === "active" && loan.startDate <= today && loan.dueDate >= today;
        }),
        ownerName: owner?.name ?? "Neighbor",
        trustedLender: owner?.isTrustedLender ?? false,
      });
    }
    return results;
  },
});

export const myListings = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    return ctx.db
      .query("tools")
      .withIndex("by_owner", (q) => q.eq("ownerId", user._id))
      .collect();
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    category: v.string(),
    condition,
    description: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const now = Date.now();
    return ctx.db.insert("tools", {
      ownerId: user._id,
      name: clean(args.name, 80, "Name"),
      category: clean(args.category, 40, "Category").toLowerCase(),
      condition: args.condition,
      description: clean(args.description, 500, "Description"),
      isArchived: false,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const update = mutation({
  args: {
    toolId: v.id("tools"),
    name: v.string(),
    category: v.string(),
    condition,
    description: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const tool = await ctx.db.get(args.toolId);
    if (!tool || tool.isArchived) throw new ConvexError("Tool not found");
    assertOwner(user, tool.ownerId);
    await ctx.db.patch(tool._id, {
      name: clean(args.name, 80, "Name"),
      category: clean(args.category, 40, "Category").toLowerCase(),
      condition: args.condition,
      description: clean(args.description, 500, "Description"),
      updatedAt: Date.now(),
    });
  },
});

export const remove = mutation({
  args: { toolId: v.id("tools") },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const tool = await ctx.db.get(args.toolId);
    if (!tool) throw new ConvexError("Tool not found");
    assertOwner(user, tool.ownerId);
    const loans = await ctx.db
      .query("loans")
      .withIndex("by_tool", (q) => q.eq("toolId", tool._id))
      .collect();
    if (loans.some((loan) => loan.status === "active")) {
      throw new ConvexError("An active loan must be returned before removing this listing");
    }
    await cancelPendingRequests(ctx, tool, user.name);
    await ctx.db.patch(tool._id, { isArchived: true, updatedAt: Date.now() });
  },
});

export const adminRemove = mutation({
  args: { toolId: v.id("tools") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const tool = await ctx.db.get(args.toolId);
    if (!tool) throw new ConvexError("Tool not found");
    const owner = await ctx.db.get(tool.ownerId);
    await cancelPendingRequests(ctx, tool, owner?.name ?? "The lender");
    await ctx.db.patch(tool._id, { isArchived: true, updatedAt: Date.now() });
  },
});
