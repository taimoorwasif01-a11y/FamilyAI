import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';
import { PLANS, isConfigured } from '../../shared/paddle.ts';

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    return Response.json({
      plans: PLANS.map((p) => ({
        key: p.key,
        name: p.name,
        price: p.price,
        credits: p.credits,
        cadence: p.cadence,
        type: p.type,
        configured: isConfigured(p),
      })),
      current_tier: user.user_tier || 'free_trial',
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
