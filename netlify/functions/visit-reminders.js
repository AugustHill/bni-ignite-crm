// Runs on a schedule (see netlify.toml), every Tuesday morning: emails a
// reminder to every visitor registered for tomorrow's Wednesday meeting.
// Skips anyone who already got a reminder, and anyone who registered in the
// last 12 hours (they just got their welcome email, a reminder on top of it
// would be silly). A failed send is logged to visit_emails like any other
// and left without reminder_sent_at, but nothing retries it automatically,
// an admin can resend it from the Visitors tab.

const mail = require('../lib/visit-mail');

exports.handler = async () => {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Server is not configured (missing Supabase env vars).' }) };
  }

  try {
    const tomorrow = mail.addDaysISO(mail.todayET(), 1);
    const cutoff = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
    const lookup = await mail.sb(
      `visit_registrations?meeting_date=eq.${tomorrow}&status=eq.registered&reminder_sent_at=is.null`
      + `&created_at=lt.${encodeURIComponent(cutoff)}&select=*`,
    );
    if (!lookup.ok) {
      return { statusCode: 502, body: JSON.stringify({ error: `Couldn't load registrations: ${JSON.stringify(lookup.body).slice(0, 200)}` }) };
    }

    const outcomes = await Promise.allSettled(lookup.body.map(async (reg) => {
      const result = await mail.deliver(reg, 'reminder', { timeoutMs: 20000 });
      if (result.ok) {
        await mail.sb(`visit_registrations?id=eq.${reg.id}`, {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({ reminder_sent_at: new Date().toISOString() }),
        });
      }
      return result;
    }));

    const sent = outcomes.filter((o) => o.status === 'fulfilled' && o.value.ok).length;
    return {
      statusCode: 200,
      body: JSON.stringify({ meeting_date: tomorrow, due: lookup.body.length, sent, failed: lookup.body.length - sent }),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: `Unexpected server error: ${err.message}` }) };
  }
};
