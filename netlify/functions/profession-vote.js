// Backs the public member form (vote.html). No login: the form is one shared
// link, members pick their name from the roster. GET returns whether voting
// is open plus the roster names; POST records one member's pledges.
//
// This is the only way the public form touches the database (service role,
// the vote tables have no anonymous policies). One submission per member is
// enforced by a unique index, so a second try, or two tabs racing, is
// refused rather than doubled.

const { sb } = require('../lib/visit-mail');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_AMOUNT = 100000;

function reply(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) };
}

const normalize = (s) => String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

// Returns { pledges } ready to insert (minus submission_id) or { error }.
function validatePledges(raw) {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 3) {
    return { error: 'Enter between one and three professions.' };
  }
  const pledges = [];
  const seen = new Set();
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i] || {};
    const profession = String(item.profession || '').replace(/\s+/g, ' ').trim();
    if (profession.length < 2 || profession.length > 80) {
      return { error: `Profession ${i + 1} needs to be between 2 and 80 characters.` };
    }
    const key = normalize(profession);
    if (seen.has(key)) return { error: `"${profession}" is listed more than once. Each profession can only be entered one time.` };
    seen.add(key);

    const text = String(item.amount === undefined || item.amount === null ? '' : item.amount).replace(/[$,\s]/g, '');
    if (text === '') return { error: `Enter a dollar amount for "${profession}". Use 0 if you don't want to pledge.` };
    const amount = Number(text);
    if (!Number.isFinite(amount) || amount < 0) return { error: `The amount for "${profession}" isn't a valid number.` };
    if (!Number.isInteger(amount)) return { error: `Please use whole dollars for "${profession}".` };
    if (amount > MAX_AMOUNT) return { error: `The amount for "${profession}" is too large. The most this form accepts is $${MAX_AMOUNT.toLocaleString('en-US')}.` };
    pledges.push({ slot: i + 1, profession, amount });
  }
  return { pledges };
}

async function loadSettingsAndMembers() {
  const [settings, members] = await Promise.all([
    sb('vote_settings?id=eq.1&select=is_open'),
    sb('vote_members?select=id,name&order=name.asc'),
  ]);
  if (!settings.ok || !members.ok) return { error: true };
  const open = settings.body.length ? settings.body[0].is_open !== false : true;
  return { open, members: members.body };
}

exports.handler = async (event) => {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return reply(500, { error: 'This form is not configured yet.' });
  }

  try {
    if (event.httpMethod === 'GET') {
      const loaded = await loadSettingsAndMembers();
      if (loaded.error) return reply(503, { error: "This form isn't ready yet. Please check back soon." });
      return reply(200, { open: loaded.open, members: loaded.members });
    }

    if (event.httpMethod !== 'POST') return reply(405, { error: 'Method not allowed.' });
    if ((event.body || '').length > 10000) return reply(413, { error: 'That request is too large.' });

    let payload;
    try {
      payload = JSON.parse(event.body);
    } catch (err) {
      return reply(400, { error: 'Invalid request.' });
    }
    const memberId = String((payload && payload.member_id) || '');
    if (!UUID.test(memberId)) return reply(400, { error: 'Choose your name from the list.' });

    const checked = validatePledges(payload.pledges);
    if (checked.error) return reply(400, { error: checked.error });

    const loaded = await loadSettingsAndMembers();
    if (loaded.error) return reply(503, { error: "This form isn't ready yet. Please check back soon." });
    if (!loaded.open) return reply(403, { error: 'Voting is closed.' });

    const member = loaded.members.find((m) => m.id === memberId);
    if (!member) return reply(400, { error: "That name isn't on the list. Please pick it again." });

    const created = await sb('vote_submissions', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ member_id: memberId }),
    });
    if (created.status === 409) {
      return reply(409, { error: `${member.name} has already submitted. Each member can only submit once. If you need to change yours, ask Derrick.` });
    }
    if (!created.ok || !created.body || !created.body[0]) {
      return reply(502, { error: "Your answers couldn't be saved. Please try again in a moment." });
    }
    const submissionId = created.body[0].id;

    const saved = await sb('vote_pledges', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify(checked.pledges.map((p) => ({ ...p, submission_id: submissionId }))),
    });
    if (!saved.ok) {
      // Don't leave a half-saved submission behind: it would block a retry.
      await sb(`vote_submissions?id=eq.${submissionId}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
      return reply(502, { error: "Your answers couldn't be saved. Please try again in a moment." });
    }

    return reply(200, { ok: true, name: member.name, pledges: checked.pledges.map(({ profession, amount }) => ({ profession, amount })) });
  } catch (err) {
    console.error('profession-vote failed:', err);
    return reply(500, { error: 'Something went wrong. Please try again.' });
  }
};

exports.validatePledges = validatePledges;
