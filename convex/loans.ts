import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { requireAdmin, requireUser } from "./lib/auth";

type LoanForDisplay = Record<string, unknown> & {
  toolId: Id<"tools">;
  borrowerId: Id<"users">;
  lenderId: Id<"users">;
};

async function decorateLoans(ctx: QueryCtx, loans: LoanForDisplay[]) {
  const results = [];
  for (const loan of loans) {
    const tool = await ctx.db.get(loan.toolId);
    const borrower = await ctx.db.get(loan.borrowerId);
    const lender = await ctx.db.get(loan.lenderId);
    results.push({
      ...loan,
      toolName: tool?.name ?? "Archived tool",
      borrowerName: borrower?.name ?? "Neighbor",
      lenderName: lender?.name ?? "Neighbor",
    });
  }
  return results;
}

export const mine = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const borrowed = await ctx.db
      .query("loans")
      .withIndex("by_borrower", (q) => q.eq("borrowerId", user._id))
      .collect();
    const lent = await ctx.db
      .query("loans")
      .withIndex("by_lender", (q) => q.eq("lenderId", user._id))
      .collect();
    const unique = new Map([...borrowed, ...lent].map((loan) => [loan._id, loan]));
    return decorateLoans(ctx, [...unique.values()] as LoanForDisplay[]);
  },
});

export const all = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    return decorateLoans(ctx, (await ctx.db.query("loans").collect()) as LoanForDisplay[]);
  },
});

export const markReturned = mutation({
  args: { loanId: v.id("loans") },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const loan = await ctx.db.get(args.loanId);
    if (!loan) throw new ConvexError("Loan not found");
    if (
      user.role !== "admin" &&
      loan.lenderId !== user._id &&
      loan.borrowerId !== user._id
    ) {
      throw new ConvexError("Only a loan participant can mark it returned");
    }
    if (loan.status === "returned") return;
    await ctx.db.patch(loan._id, {
      status: "returned",
      returnedAt: Date.now(),
      updatedAt: Date.now(),
    });
  },
});
