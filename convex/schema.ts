import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  users: defineTable({
    clerkUserId: v.string(),
    name: v.string(),
    email: v.string(),
    role: v.union(v.literal("user"), v.literal("admin")),
    isTrustedLender: v.boolean(),
    updatedAt: v.number(),
  }).index("by_clerk_user_id", ["clerkUserId"]),

  tools: defineTable({
    ownerId: v.id("users"),
    name: v.string(),
    category: v.string(),
    condition: v.union(
      v.literal("like-new"),
      v.literal("good"),
      v.literal("fair"),
    ),
    description: v.string(),
    isArchived: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_owner", ["ownerId"])
    .index("by_category", ["category"]),

  borrowRequests: defineTable({
    toolId: v.id("tools"),
    borrowerId: v.id("users"),
    lenderId: v.id("users"),
    startDate: v.string(),
    endDate: v.string(),
    note: v.optional(v.string()),
    status: v.union(
      v.literal("pending"),
      v.literal("approved"),
      v.literal("declined"),
      v.literal("cancelled"),
    ),
    decidedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_tool", ["toolId"])
    .index("by_borrower", ["borrowerId"])
    .index("by_lender", ["lenderId"]),

  loans: defineTable({
    requestId: v.id("borrowRequests"),
    toolId: v.id("tools"),
    borrowerId: v.id("users"),
    lenderId: v.id("users"),
    startDate: v.string(),
    dueDate: v.string(),
    status: v.union(v.literal("active"), v.literal("returned")),
    returnedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_request", ["requestId"])
    .index("by_tool", ["toolId"])
    .index("by_borrower", ["borrowerId"])
    .index("by_lender", ["lenderId"])
    .index("by_status", ["status"]),

  automationEvents: defineTable({
    eventId: v.string(),
    type: v.string(),
    requestId: v.optional(v.id("borrowRequests")),
    loanId: v.optional(v.id("loans")),
    recipientEmail: v.optional(v.string()),
    payload: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("delivered"),
      v.literal("failed"),
    ),
    attemptCount: v.number(),
    lastError: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_event_id", ["eventId"])
    .index("by_request", ["requestId"])
    .index("by_loan", ["loanId"]),

  reminders: defineTable({
    idempotencyKey: v.string(),
    loanId: v.id("loans"),
    reminderDate: v.string(),
    status: v.union(v.literal("sent"), v.literal("failed")),
    sentAt: v.optional(v.number()),
    error: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index("by_idempotency_key", ["idempotencyKey"])
    .index("by_loan", ["loanId"]),

  webhookReceipts: defineTable({
    eventId: v.string(),
    source: v.string(),
    receivedAt: v.number(),
  }).index("by_event_id", ["eventId"]),
});
