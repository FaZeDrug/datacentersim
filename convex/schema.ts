import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

export default defineSchema({
  runs: defineTable({
    runId: v.string(), score: v.number(), elapsed: v.number(),
    outcome: v.union(v.literal('won'), v.literal('lost')),
    mode: v.union(v.literal('guided'), v.literal('challenge')),
    inspections: v.number(), mistakes: v.number(),
  }).index('by_run', ['runId']),
});
