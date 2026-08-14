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
// for caller.html / admin.html, which are strictly role-specific.
async function requireRole(requiredRole) {
  const result = await requireSession();
  if (result.profile.role !== requiredRole) {
    window.location.href = result.profile.role === 'coordinator' ? 'admin.html' : 'caller.html';
    throw new Error('Wrong role for this page');
  }
  return result;
}

async function logout() {
  if (supabaseClient) await supabaseClient.auth.signOut();
  window.location.href = 'index.html';
}
