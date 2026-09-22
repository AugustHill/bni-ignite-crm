// Shared session/auth guard for caller.html, admin.html, and gps-plan.html.
// Load order matters: supabase-config.js, then the Supabase CDN script,
// then this file, then the page's own inline script.

let supabaseClient = null;
try {
  supabaseClient = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
} catch (err) {
  console.error('Supabase is not configured yet:', err.message);
}

// Confirms a logged-in session exists and returns its profile, no role
// check. For pages both roles can land on (gps-plan.html — each person
// views/edits their own plan there).
async function requireSession() {
  if (!supabaseClient) {
    document.body.innerHTML = '<div class="wrap"><p class="error-msg">This page is not connected yet. Add your Supabase URL/key to js/supabase-config.js.</p></div>';
    throw new Error('Supabase not configured');
  }

  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) {
    window.location.href = 'index.html';
    throw new Error('Not logged in');
  }

  const { data: profile, error } = await supabaseClient
    .from('profiles')
    .select('*')
    .eq('id', session.user.id)
    .single();

  if (error || !profile) {
    await supabaseClient.auth.signOut();
    window.location.href = 'index.html';
    throw new Error('No profile found for this user');
  }

  return { client: supabaseClient, session, profile };
}

// Same as above, but redirects away if the profile's role doesn't match —
// for caller.html / admin.html / private.html, which are role-specific.
// 'owner' is a superset of 'coordinator' (same dashboard, plus more), so a
// page that requires 'coordinator' also accepts 'owner'. Nothing supersedes
// 'owner' itself — that's the one check that stays an exact match.
async function requireRole(requiredRole) {
  const result = await requireSession();
  const role = result.profile.role;
  const ok = role === requiredRole || (requiredRole === 'coordinator' && role === 'owner');
  if (!ok) {
    window.location.href = role === 'caller' ? 'caller.html' : 'admin.html';
    throw new Error('Wrong role for this page');
  }
  return result;
}

async function logout() {
  if (supabaseClient) await supabaseClient.auth.signOut();
  window.location.href = 'index.html';
}

// Normalizes a US phone number to xxx-xxx-xxxx. Strips a leading "1"
// country code if present. Anything that doesn't reduce to exactly 10
// digits (an extension, a foreign number, a partial entry) is left
// exactly as typed rather than forced into a shape that might be wrong.
function formatPhone(raw) {
  const digits = (raw || '').replace(/\D/g, '');
  let d = digits;
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1);
  if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  return (raw || '').trim();
}

// Records a meaningful action for the admin-side activity log (contact
// added/edited/deleted, a call logged, the Email link clicked). Not part
// of the actual workflow those actions belong to, so a failure here is
// logged to the console and otherwise swallowed rather than surfaced to
// the user or allowed to block what they were actually doing.
async function logActivity(client, actorId, action, contactId, contactLabel, details) {
  try {
    await client.from('activity_log').insert({
      actor_id: actorId,
      action,
      contact_id: contactId || null,
      contact_label: contactLabel || null,
      details: details || null,
    });
  } catch (err) {
    console.error('Could not log activity:', err.message);
  }
}

// The one address and time every meeting invite uses. Not configurable
// from the UI on purpose -- Derrick asked specifically that no one be
// able to type the wrong date or time in.
const MEETING_ADDRESS = 'Keller Williams Realty, 30522 US Highway 19 North, Suite 107, Palm Harbor, Florida 34684';
const MEETING_TIME = '7:30 AM';

// Opens a mailto: URL in a way that never navigates the current tab away
// (a plain click on a mailto link can, depending on the browser's
// configured handler) -- same pattern already used for the CSV export
// download link elsewhere in this app.
function openMailto(url) {
  const a = document.createElement('a');
  a.href = url;
  a.target = '_blank';
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// Renders a one-month calendar into `container`. Only Wednesdays today or
// later are clickable, calling onSelect(date) with a Date at local
// midnight; every other cell is disabled, including past Wednesdays. Re-
// renders itself in place for month navigation, so it can be called again
// with an explicit `viewDate` to jump to a specific month.
function renderMiniCalendar(container, onSelect, viewDate) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const view = viewDate || new Date(today.getFullYear(), today.getMonth(), 1);
  const year = view.getFullYear();
  const month = view.getMonth();
  const monthLabel = view.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const startPad = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const canGoPrev = new Date(year, month, 1) > new Date(today.getFullYear(), today.getMonth(), 1);

  let cellsHtml = '';
  for (let i = 0; i < startPad; i++) cellsHtml += '<div class="cal-cell cal-blank"></div>';
  for (let day = 1; day <= daysInMonth; day++) {
    const cellDate = new Date(year, month, day);
    const clickable = cellDate.getDay() === 3 && cellDate >= today;
    cellsHtml += `<div class="cal-cell ${clickable ? 'cal-clickable' : 'cal-disabled'}" ${clickable ? `data-date="${cellDate.getFullYear()}-${String(cellDate.getMonth() + 1).padStart(2, '0')}-${String(cellDate.getDate()).padStart(2, '0')}"` : ''}>${day}</div>`;
  }

  container.innerHTML = `
    <div class="cal-header">
      <button type="button" class="cal-nav" data-nav="prev" ${canGoPrev ? '' : 'disabled'} aria-label="Previous month">&lsaquo;</button>
      <strong>${monthLabel}</strong>
      <button type="button" class="cal-nav" data-nav="next" aria-label="Next month">&rsaquo;</button>
    </div>
    <div class="cal-grid cal-weekdays"><div>Su</div><div>Mo</div><div>Tu</div><div>We</div><div>Th</div><div>Fr</div><div>Sa</div></div>
    <div class="cal-grid">${cellsHtml}</div>
  `;

  container.querySelectorAll('.cal-clickable').forEach((cell) => {
    cell.addEventListener('click', () => onSelect(new Date(`${cell.dataset.date}T00:00:00`)));
  });
  container.querySelector('[data-nav="prev"]').addEventListener('click', () => {
    if (canGoPrev) renderMiniCalendar(container, onSelect, new Date(year, month - 1, 1));
  });
  container.querySelector('[data-nav="next"]').addEventListener('click', () => {
    renderMiniCalendar(container, onSelect, new Date(year, month + 1, 1));
  });
}

// Builds the meeting-invite mailto: URL for one contact and a chosen
// Wednesday. Time and address are fixed (MEETING_TIME/MEETING_ADDRESS
// above), the only thing that varies is the date and who it's addressed
// and signed to.
function buildInviteMailto(contact, meetingDate, senderName) {
  const dateStr = meetingDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const subject = `You're Invited to BNI Ignite's Weekly Meeting on ${dateStr}`;
  const greetingName = contact.contact_name || contact.business_name || 'there';
  const body = [
    `Hi ${greetingName},`,
    '',
    `Thank you for your interest in BNI Ignite! We'd love to have you join us as our guest at our weekly chapter meeting.`,
    '',
    'Meeting Details:',
    `Date: ${dateStr}`,
    `Time: ${MEETING_TIME}`,
    `Location: ${MEETING_ADDRESS}`,
    '',
    'Thank you for attending the BNI Ignite weekly chapter meeting. Please bring business cards, as we are eager to network with you.',
    '',
    "BNI is the world's leading referral marketing organization, built on the philosophy of Givers Gain: the more you give to others, the more you receive in return. Each week, our members exchange qualified business referrals and build long-term relationships rooted in trust. As our guest, you'll get a firsthand look at how our chapter operates, meet local business owners across a variety of industries, and experience the kind of word-of-mouth marketing that keeps our members' pipelines full.",
    '',
    'We look forward to welcoming you!',
    '',
    senderName || '',
    'BNI Ignite',
  ].join('\n');
  return `mailto:${contact.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

// "Who's online" — a Realtime Presence channel shared by every logged-in
// page. No table/migration involved, Presence is a broadcast-style channel
// independent of Postgres replication. Renders into a #presence-bar element
// each page provides; automatically drops someone the instant their tab
// disconnects (no heartbeat/expiry logic needed, that's built into how
// Presence channels work).
function initPresence(client, profile) {
  const container = document.getElementById('presence-bar');
  if (!container) return;

  function initials(name) {
    return (name || '?').trim().split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  }

  const channel = client.channel('online-users', {
    config: { presence: { key: profile.id } },
  });

  channel.on('presence', { event: 'sync' }, () => {
    const state = channel.presenceState();
    const people = Object.values(state).map((entries) => entries[0]);
    container.innerHTML = people.map((p) => `
      <span class="presence-chip" title="${p.full_name}">
        <span class="presence-avatar">${initials(p.full_name)}</span>${p.full_name}
      </span>
    `).join('');
  });

  channel.subscribe(async (status) => {
    if (status === 'SUBSCRIBED') {
      await channel.track({ full_name: profile.full_name, role: profile.role });
    }
  });
}
