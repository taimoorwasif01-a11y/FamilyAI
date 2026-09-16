import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { secrets } from 'base44:runtime';
import { authorizeCredits, blockedResponse } from '../../shared/credits.ts';
import { chatJSON } from '../../shared/deepseek.ts';

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const creditAuth = await authorizeCredits(base44, user, 'ai_query');
    if (creditAuth.blocked) return blockedResponse(creditAuth);

    const body = await req.json().catch(() => ({}));
    const member_name = body.member_name;
    const days = body.days || 7;
    if (!member_name) return Response.json({ error: 'member_name is required' }, { status: 400 });

    const [members, topics, events] = await Promise.all([
      base44.entities.FamilyMember.list(),
      base44.entities.TutorTopic.filter({ member_name }),
      base44.entities.CalendarEvent.list('-start_date', 300),
    ]);

    const member = members.find((m) => m.name === member_name);
    if (!member) return Response.json({ error: 'Child not found' }, { status: 404 });

    const now = new Date();
    const slots = [];
    for (let i = 1; i <= days; i++) {
      const d = new Date(now.getTime() + i * 24 * 60 * 60 * 1000);
      const day = d.getDay();
      const candidates = (day === 0 || day === 6) ? [10, 11, 12] : [16, 17, 18];
      for (const hour of candidates) {
        const start = new Date(d);
        start.setHours(hour, 0, 0, 0);
        const end = new Date(start.getTime() + 30 * 60 * 1000);
        const conflict = events.some((e) => {
          const es = new Date(e.start_date);
          const ee = e.end_date ? new Date(e.end_date) : new Date(new Date(e.start_date).getTime() + 60 * 60000);
          return es < end && ee > start;
        });
        if (!conflict) { slots.push({ date: start.toISOString() }); break; }
      }
    }

    const exams = events.filter((e) => e.category === 'exam' && e.member_name === member_name && new Date(e.start_date) >= now);

    const prompt = `You are a study planner for a school-age child. Assign each free time slot ONE revision session, choosing the topic and duration based on the child's progress and upcoming exams.

Rules:
- Prioritise topics with LOW mastery (below 70%) and topics tied to upcoming exams.
- Space repetition: avoid repeating the exact same topic two days in a row unless an exam for it is within 3 days.
- Duration 15-25 minutes: lower mastery or an imminent exam -> longer; a younger child -> shorter.
- One session per slot. Use the slot_index to match the slot.

Child: ${member.name} (grade ${member.grade || 'unknown'})${member.learning_style ? `, learns via: ${member.learning_style}` : ''}

Topics & mastery:
${topics.map((t) => `- ${t.subject} / ${t.topic}: ${t.mastery_level}%${t.last_practiced ? ' (last practised ' + new Date(t.last_practiced).toLocaleDateString() + ')' : ''}`).join('\n') || '(none tracked yet — pick a reasonable foundational topic if any exam subject exists, else return empty sessions)'}

Upcoming exams:
${exams.map((e) => `- ${new Date(e.start_date).toDateString()}: ${e.title}${e.subject ? ' (' + e.subject + ')' : ''}`).join('\n') || '(none)'}

Free slots (one per day, after school / weekend mornings):
${slots.map((s, i) => `${i}: ${new Date(s.date).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`).join('\n') || '(no free slots found)'}

Return ONLY valid JSON with this shape:
{
  "summary": string,
  "sessions": [
    { "slot_index": number, "subject": string, "topic": string, "duration_minutes": number, "reason": string }
  ]
}
Return one session object per slot you want to fill (you may skip a slot if there's nothing meaningful to study).`;

    const result = await chatJSON({
      apiKey: secrets.get('DEEPSEEK_API_KEY'),
      system: 'You are a study planner. Return only valid JSON.',
      user: prompt,
    });

    const created = [];
    for (const s of (result.sessions || [])) {
      const slot = slots[s.slot_index];
      if (!slot) continue;
      const dur = Math.min(25, Math.max(15, s.duration_minutes || 20));
      const end = new Date(new Date(slot.date).getTime() + dur * 60000).toISOString();
      const session = await base44.entities.RevisionSession.create({
        member_name,
        subject: s.subject,
        topic: s.topic,
        scheduled_date: slot.date,
        duration_minutes: dur,
        status: 'planned',
        reason: s.reason,
      });
      await base44.entities.CalendarEvent.create({
        title: `Tutor session: ${s.subject} — ${s.topic}`,
        member_name,
        category: 'revision',
        start_date: slot.date,
        end_date: end,
        subject: s.subject,
        notes: s.reason,
      });
      created.push(session);
    }

    return Response.json({ summary: result.summary, created, total: created.length, slotsFound: slots.length });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
