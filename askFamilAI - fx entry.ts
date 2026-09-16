import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';
import { secrets } from 'base44:runtime';
import { authorizeCredits, blockedResponse } from '../../shared/credits.ts';
import { chatJSON } from '../../shared/deepseek.ts';

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const creditAuth = await authorizeCredits(base44, user, 'ai_query');
    if (creditAuth.blocked) return blockedResponse(creditAuth);

    const body = await req.json().catch(() => ({}));

    // Phase 2 — execute a previously confirmed mutation
    if (body.confirm && body.action) {
      const a = body.action;
      let actionTaken = null;
      if (a.intent === 'create_event') {
        const start = a.event_start_date || new Date(Date.now() + 86400000).toISOString();
        const ev = await base44.entities.CalendarEvent.create({
          title: a.event_title || 'Reminder',
          member_name: a.event_member_name || 'family',
          category: a.event_category || 'other',
          start_date: start,
          end_date: a.event_end_date || start,
          notes: a.event_notes || '',
        });
        actionTaken = { type: 'event', id: ev.id, title: ev.title, member_name: ev.member_name, start_date: ev.start_date };
      } else if (a.intent === 'create_todo') {
        const todo = await base44.entities.Todo.create({
          title: a.todo_title || 'New task',
          priority: a.todo_priority || 'medium',
          due_date: a.todo_due_date || '',
          assigned_to: a.todo_assigned_to || '',
          status: 'pending',
        });
        actionTaken = { type: 'todo', id: todo.id, title: todo.title };
      }
      return Response.json({ reply: a.reply || 'Done.', intent: a.intent, action_taken: actionTaken });
    }

    const message = (body.message || '').trim();
    if (!message) return Response.json({ error: 'message is required' }, { status: 400 });

    const [members, events, todos, revision] = await Promise.all([
      base44.entities.FamilyMember.list(),
      base44.entities.CalendarEvent.list('-start_date', 60),
      base44.entities.Todo.filter({ status: 'pending' }),
      base44.entities.RevisionSession.filter({ status: 'planned' }),
    ]);
    const memberNames = members.map((m) => m.name);
    const now = new Date();
    const dayStr = now.toISOString().slice(0, 10);
    const startToday = new Date(dayStr + 'T00:00:00');
    const endToday = new Date(dayStr + 'T23:59:59');
    const tomorrow = new Date(startToday.getTime() + 86400000);
    const endTomorrow = new Date(tomorrow.getTime() + 86399999);
    const todayEvents = events.filter((e) => { const d = new Date(e.start_date); return d >= startToday && d <= endToday; });
    const tomorrowEvents = events.filter((e) => { const d = new Date(e.start_date); return d >= tomorrow && d <= endTomorrow; });
    const upcoming = events.filter((e) => new Date(e.start_date) > endToday).slice(0, 15);
    const dueTodos = todos.filter((t) => t.due_date && new Date(t.due_date) <= new Date(startToday.getTime() + 7 * 86400000));

    const ctx = `NOW: ${now.toISOString()} (${now.toLocaleString('en-GB')})
FAMILY MEMBERS: ${memberNames.join(', ') || '(none)'}
TODAY'S EVENTS: ${todayEvents.map((e) => `${new Date(e.start_date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} ${e.title} (${e.member_name || 'family'}, ${e.category})`).join(' | ') || '(none)'}
TOMORROW'S EVENTS: ${tomorrowEvents.map((e) => `${new Date(e.start_date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} ${e.title} (${e.member_name || 'family'})`).join(' | ') || '(none)'}
UPCOMING (after today): ${upcoming.map((e) => `${new Date(e.start_date).toLocaleDateString()} ${e.title}`).join(' | ') || '(none)'}
DUE TODOS: ${dueTodos.map((t) => t.title + (t.due_date ? ' (due ' + new Date(t.due_date).toLocaleDateString() + ')' : '')).join(' | ') || '(none)'}
PLANNED REVISION: ${revision.slice(0, 8).map((r) => `${new Date(r.scheduled_date).toLocaleDateString()} ${r.member_name} ${r.subject}/${r.topic}`).join(' | ') || '(none)'}`;

    const system = `You are FamilAI, a calm, concise family assistant embedded in a family hub app. You route user requests to real actions. Classify the intent and extract structured params. Use the provided current date/time to compute any dates as ISO 8601. Pick a family member name from the list when relevant; if none specified use "family". Be concise and natural — no exclamation marks, no "Certainly!" or "Of course!".`;

    const prompt = `${system}

${ctx}

USER REQUEST: "${message}"

Classify intent:
- create_event: user wants to add a reminder, appointment, event, or schedule something
- create_todo: user wants to add a task/to-do (not tied to a calendar time)
- query_schedule: user asks what's happening, what they have, their schedule (today/tomorrow/this week)
- plan_study: user wants to study, revise, prepare for an exam, or create a study plan
- general: anything else — answer helpfully using the context

For create_event fill: event_title, event_member_name, event_start_date (ISO), event_end_date (ISO, optional), event_category (one of school|appointment|sports|activity|birthday|holiday|exam|revision|other), event_notes.
For create_todo fill: todo_title, todo_priority (low|medium|high), todo_due_date (YYYY-MM-DD), todo_assigned_to.
For plan_study fill: study_member_name (if a specific child).
For query_schedule/general: write a helpful reply using the context. Do not invent events.

Return JSON: intent, reply (what you say to the user), plus the relevant fields above. For create_event/create_todo, reply should be a short confirmation prompt like "I can add [title] on [date]. Confirm?" — never claim it is already done.`;

    const schema = {
      type: 'object',
      properties: {
        intent: { type: 'string', enum: ['create_event', 'create_todo', 'query_schedule', 'plan_study', 'general'] },
        reply: { type: 'string' },
        event_title: { type: 'string' },
        event_member_name: { type: 'string' },
        event_start_date: { type: 'string' },
        event_end_date: { type: 'string' },
        event_category: { type: 'string' },
        event_notes: { type: 'string' },
        todo_title: { type: 'string' },
        todo_priority: { type: 'string' },
        todo_due_date: { type: 'string' },
        todo_assigned_to: { type: 'string' },
        study_member_name: { type: 'string' },
      },
      required: ['intent', 'reply'],
    };

    const result = await chatJSON({ apiKey: secrets.get('DEEPSEEK_API_KEY'), system, user: prompt, schema });

    if (result.intent === 'create_event' || result.intent === 'create_todo') {
      return Response.json({ reply: result.reply, intent: result.intent, needsConfirm: true, action: result });
    }
    if (result.intent === 'plan_study') {
      return Response.json({ reply: result.reply, intent: 'plan_study', navigate: '/tutor', study_member_name: result.study_member_name || '' });
    }
    return Response.json({ reply: result.reply, intent: result.intent, done: true });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
