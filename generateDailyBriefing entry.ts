import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { secrets } from 'base44:runtime';
import { gatherBriefingData, buildBriefingPrompt } from '../../shared/briefing.ts';
import { authorizeCredits, blockedResponse } from '../../shared/credits.ts';
import { chatJSON } from '../../shared/deepseek.ts';

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const creditAuth = await authorizeCredits(base44, user, 'background_sync');
    if (creditAuth.blocked) return blockedResponse(creditAuth);

    const body = await req.json().catch(() => ({}));
    const today = body.date ? new Date(body.date) : new Date();

    const { todayEvents, upcomingExams, upcomingRevision, dueTodos, dataBlock } = await gatherBriefingData(base44, today);

    const result = await chatJSON({
      apiKey: secrets.get('DEEPSEEK_API_KEY'),
      system: 'You are a warm, concise family assistant. Return only valid JSON.',
      user: buildBriefingPrompt(dataBlock),
    });

    return Response.json({
      briefing: result,
      todayEvents,
      upcomingExams,
      upcomingRevision,
      dueTodos
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
