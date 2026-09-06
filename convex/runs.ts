import { mutationGeneric, queryGeneric } from 'convex/server';
import { v } from 'convex/values';

// Anonymous demo results, never personal information or authoritative rankings.
export const save = mutationGeneric({
  args: {
    runId: v.string(), score: v.number(), elapsed: v.number(),
    outcome: v.union(v.literal('won'), v.literal('lost')),
    mode: v.union(v.literal('guided'), v.literal('challenge')),
    inspections: v.number(), mistakes: v.number(),
  },
  handler: async (ctx, args) => {
    if (!/^[a-f0-9-]{36}$/i.test(args.runId)) throw new Error('Invalid run ID.');
    for (const [name, value, limit] of [
      ['score', args.score, 3000], ['elapsed', args.elapsed, 7200],
      ['inspections', args.inspections, 100], ['mistakes', args.mistakes, 10000],
    ] as const) {
      if (!Number.isFinite(value) || value < 0 || value > limit) throw new Error(`Invalid ${name}.`);
    }
    const existing = await ctx.db.query('runs').withIndex('by_run', q => q.eq('runId', args.runId)).first();
    if (existing) return existing._id;
    return await ctx.db.insert('runs', args);
  },
});

export const recent = queryGeneric({
  args: {},
  handler: async ctx => (await ctx.db.query('runs').order('desc').take(20)).map(run => ({
    score: run.score, outcome: run.outcome, elapsed: run.elapsed, mode: run.mode,
  })),
});
