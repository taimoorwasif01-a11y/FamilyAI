import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';
import { secrets } from 'base44:runtime';
import { getPlan, isConfigured, paddleApi } from '../../shared/paddle.ts';

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const plan = getPlan(body.plan_key);
    if (!plan) return Response.json({ error: 'Unknown plan' }, { status: 400 });
    if (!isConfigured(plan)) {
      return Response.json(
        { error: 'This plan is not configured yet. Add its Paddle price ID in base44/shared/paddle.ts.' },
        { status: 400 }
      );
    }

    const origin = req.headers.get('origin') || '';
    const returnUrl = body.return_url || (origin ? `${origin}/pricing` : 'https://example.com');
    const apiKey = secrets.get('PADDLE_API_KEY');

    const { status, data, error } = await paddleApi('/transactions', {
      method: 'POST',
      apiKey,
      body: {
        items: [{ price_id: plan.paddle_price_id, quantity: 1 }],
        checkout: { url: returnUrl },
        customer: { email: user.email },
        custom_data: {
          user_id: user.id,
          plan_key: plan.key,
          type: plan.type,
          credits: plan.credits,
        },
      },
    });

    if (status >= 400 || !data) {
      return Response.json({ error: error?.detail || 'Paddle checkout failed', paddleError: error }, { status: 502 });
    }

    const url = data.checkout?.url || `https://checkout.paddle.com/checkout?transaction=${data.id}`;
    return Response.json({ url, transaction_id: data.id });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
