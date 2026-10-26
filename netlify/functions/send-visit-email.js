// Sends one visitor email (welcome, date change, cancellation, reminder, or
// thank-you) for a visit registration, then logs the result to visit_emails.
// Called from the browser with the user's own login token; an admin can send
// any of them, a caller only for registrations on her own assigned contacts.
// Always answers with JSON. A failed send is reported as { ok: false, error }
// with a 200, since the request itself worked, it's the email that didn't.

const mail = require('../lib/visit-mail');

// Same public value already shipped in js/supabase-config.js, used only for
// the "whose token is this" check.
const SUPABASE_ANON_KEY = 'sb_publishable_Ibp__Tt0wKL-Gk6LDbaZXw_dqubi4JD';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function reply(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return reply(500, { error: 'Server is not configured (missing Supabase env vars).' });
  }

  try {
    const authHeader = (event.headers && (event.headers.authorization || event.headers.Authorization)) || '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    if (!token) return reply(401, { error: 'Missing authorization.' });

    const whoResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
    });
    if (!whoResponse.ok) return reply(401, { error: 'Invalid or expired session. Please log in again.' });
    const requester = await whoResponse.json();

    let payload;
    try {
      payload = JSON.parse(event.body);
    } catch (err) {
      return reply(400, { error: 'Invalid request body.' });
    }
    const { registration_id: registrationId, kind } = payload || {};
    if (!UUID.test(String(registrationId || ''))) return reply(400, { error: 'A valid registration is required.' });
    if (!mail.KIND_REQUIRES_STATUS[kind]) return reply(400, { error: 'Unknown email type.' });

    const roleLookup = await mail.sb(`profiles?id=eq.${requester.id}&select=role`);
    if (!roleLookup.ok || !roleLookup.body.length) return reply(403, { error: "Couldn't confirm your role." });
    const role = roleLookup.body[0].role;
    const isAdmin = role === 'owner' || role === 'coordinator';

    const regLookup = await mail.sb(`visit_registrations?id=eq.${registrationId}&select=*,contact:contacts(assigned_to)`);
    if (!regLookup.ok) return reply(502, { error: "Couldn't load that registration. Has the visitor database update been run yet?" });
    if (!regLookup.body.length) return reply(404, { error: 'That registration was not found.' });
    const reg = regLookup.body[0];

    const ownsIt = reg.contact && reg.contact.assigned_to === requester.id;
    if (!isAdmin && !ownsIt) return reply(403, { error: 'You can only send emails for your own contacts.' });
    if (kind === 'reminder' && !isAdmin) return reply(403, { error: 'Only an administrator can send a reminder.' });

    const needed = mail.KIND_REQUIRES_STATUS[kind];
    if (reg.status !== needed) {
      return reply(409, { error: `That email only goes to a visitor whose status is "${needed}" (this one is "${reg.status}").` });
    }

    const result = await mail.deliver(reg, kind, { sentBy: requester.id, timeoutMs: 9000 });
    if (result.ok && kind === 'reminder') {
      await mail.sb(`visit_registrations?id=eq.${registrationId}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ reminder_sent_at: new Date().toISOString() }),
      });
    }
    return reply(200, result.ok ? { ok: true } : { ok: false, error: result.error });
  } catch (err) {
    return reply(500, { error: `Unexpected server error: ${err.message}` });
  }
};
