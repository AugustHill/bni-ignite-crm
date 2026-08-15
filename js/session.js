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
