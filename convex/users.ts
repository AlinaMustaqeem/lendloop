import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireAdmin, requireUser } from "./lib/auth";

export const ensureCurrent = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Authentication required");

    const existing = await ctx.db
      .query("users")
      .withIndex("by_clerk_user_id", (q) => q.eq("clerkUserId", identity.subject))
      .unique();
    const adminIds = (process.env.ADMIN_CLERK_USER_IDS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    const role = adminIds.includes(identity.subject) ? "admin" : "user";
    const now = Date.now();
    const email = identity.email ?? existing?.email ?? "";
    const name = identity.name ?? identity.nickname ?? existing?.name ?? "Neighbor";

    if (existing) {
      await ctx.db.patch(existing._id, { name, email, role, updatedAt: now });
      return existing._id;
    }
    return ctx.db.insert("users", {
      clerkUserId: identity.subject,
      name,
      email,
      role,
      isTrustedLender: false,
      updatedAt: now,
    });
  },
});

export const me = query({
  args: {},
  handler: async (ctx) => {
    try {
      return await requireUser(ctx);
    } catch {
      return null;
    }
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    return ctx.db.query("users").collect();
  },
});

export const setTrustedLender = mutation({
  args: { userId: v.id("users"), trusted: v.boolean() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const user = await ctx.db.get(args.userId);
    if (!user) throw new Error("User not found");
    await ctx.db.patch(args.userId, {
      isTrustedLender: args.trusted,
      updatedAt: Date.now(),
    });
  },
});
