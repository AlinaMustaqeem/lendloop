import { ConvexError } from "convex/values";
import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

type AuthContext = Pick<QueryCtx, "auth" | "db">;

export type UserRecord = {
  _id: Id<"users">;
  clerkUserId: string;
  name: string;
  email: string;
  role: "user" | "admin";
  isTrustedLender: boolean;
};

export async function requireUser(ctx: AuthContext): Promise<UserRecord> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError("AUTH_REQUIRED");

  const user = (await ctx.db
    .query("users")
    .withIndex("by_clerk_user_id", (q) => q.eq("clerkUserId", identity.subject))
    .unique()) as UserRecord | null;
  if (!user) throw new ConvexError("PROFILE_NOT_READY");
  return user;
}

export async function requireAdmin(ctx: AuthContext): Promise<UserRecord> {
  const user = await requireUser(ctx);
  if (user.role !== "admin") throw new ConvexError("ADMIN_REQUIRED");
  return user;
}

export function assertOwner(
  user: UserRecord,
  ownerId: Id<"users">,
  message = "OWNER_REQUIRED",
) {
  if (user._id !== ownerId && user.role !== "admin") {
    throw new ConvexError(message);
  }
}
