// Creates a new login + profiles row (a caller or another coordinator).
// This is the one operation in the app that needs the service-role key —
// creating an auth user isn't something the anon key / RLS can do, since
// it bypasses row-level security by design. Kept server-side only; the
// service-role key never reaches the browser.
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Server is not configured (missing Supabase env vars).' }) };
  }

  // Everything below can fail in ways that aren't a clean JSON error from
  // Supabase (a bad key, a network hiccup, an unexpected response shape) —
  // wrapped so the client always gets a real JSON body back, never a raw
  // platform error page that shows up client-side as an HTML parse error.
  try {
    const authHeader = event.headers.authorization || event.headers.Authorization || '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    if (!token) {
      return { statusCode: 401, body: JSON.stringify({ error: 'Missing authorization.' }) };
    }

    // Confirm the token belongs to a real, currently logged-in user.
    const whoResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${token}` },
    });
    if (!whoResponse.ok) {
      return { statusCode: 401, body: JSON.stringify({ error: 'Invalid or expired session.' }) };
    }
    const requester = await whoResponse.json();

    // Only an existing admin (owner or coordinator) may create new logins.
    const roleResponse = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${requester.id}&select=role`, {
      headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
    });
    const roleRows = await roleResponse.json();
    if (!roleResponse.ok || !roleRows.length || !['owner', 'coordinator'].includes(roleRows[0].role)) {
      return { statusCode: 403, body: JSON.stringify({ error: 'Only an administrator can add team members.' }) };
    }

    let payload;
    try {
      payload = JSON.parse(event.body);
    } catch (err) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body.' }) };
    }

    const { email, password, full_name, role, hourly_rate } = payload;
    if (!email || !password || !full_name || !role) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Email, password, name, and role are all required.' }) };
    }
    if (role !== 'coordinator' && role !== 'caller') {
      return { statusCode: 400, body: JSON.stringify({ error: 'Role must be "coordinator" or "caller".' }) };
    }
    if (String(password).length < 8) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Password needs to be at least 8 characters.' }) };
    }

    const createResponse = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({ email, password, email_confirm: true }),
    });
    const createText = await createResponse.text();
    let created;
    try {
      created = JSON.parse(createText);
    } catch (err) {
      return { statusCode: 502, body: JSON.stringify({ error: `Supabase returned something unexpected while creating the login: ${createText.slice(0, 300)}` }) };
    }
    if (!createResponse.ok) {
      return { statusCode: 400, body: JSON.stringify({ error: created.msg || created.error_description || 'Could not create the login.' }) };
    }

    const profileResponse = await fetch(`${SUPABASE_URL}/rest/v1/profiles`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({ id: created.id, full_name, role, hourly_rate: hourly_rate || null }),
    });

    if (!profileResponse.ok) {
      // Don't leave an orphaned login with no profile behind.
      await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${created.id}`, {
        method: 'DELETE',
        headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
      });
      const errText = await profileResponse.text();
      return { statusCode: 400, body: JSON.stringify({ error: `Login created but profile setup failed: ${errText}` }) };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true, id: created.id }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: `Unexpected server error: ${err.message}` }),
    };
  }
};
