// Chapter seats: who holds which BNI category (the member roster in
// vote_members, with company/phone/category/keywords) and which categories
// are open (open_categories). Shared by caller.html, admin.html and the
// Register Visitor popup.
//
// Matching rule, kept deliberately simple and under the owner's control: a
// contact's industry "matches" a seat when it contains the seat's category
// name or any of that member's keywords (whole words, ignoring capitals,
// punctuation and plural/-ing/-er endings), or when it is itself a piece of
// them ("Roofing" inside "Residential Roofing"). A match is only ever a
// heads-up for a person to judge, never a block.

(function () {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function normalize(s) {
    return String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  // Light stemming so landscaper/landscaping/landscape, painter/painting,
  // service/services all compare equal. Applied identically to both sides, so
  // it only has to be consistent, not linguistically correct.
  function stem(word) {
    let w = word;
    if (w.length > 4) {
      if (w.endsWith('ies')) w = w.slice(0, -3) + 'y';
      else {
        for (const suffix of ['ings', 'ing', 'ers', 'er', 's']) {
          if (w.endsWith(suffix) && w.length - suffix.length >= 3) { w = w.slice(0, -suffix.length); break; }
        }
      }
    }
    if (w.length > 4 && w.endsWith('e')) w = w.slice(0, -1);
    return w;
  }

  const tokens = (s) => normalize(s).split(' ').filter(Boolean).map(stem);

  // Words too generic to prove two categories are the same on their own.
  const GENERIC = new Set(['and', 'the', 'of', 'for', 'a', 'an', 'service', 'services', 'solution', 'solutions', 'company', 'group', 'inc', 'llc',
    'residential', 'commercial', 'home', 'general', 'contractor', 'contractors', 'contracting', 'professional', 'pro', 'specialist', 'consulting',
    'management', 'agent', 'agents'].map((w) => stem(w)));

  function containsRun(hay, needle) {
    if (!needle.length || needle.length > hay.length) return false;
    for (let i = 0; i + needle.length <= hay.length; i++) {
      let ok = true;
      for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) { ok = false; break; }
      if (ok) return true;
    }
    return false;
  }

  function termMatches(industryTokens, term) {
    const termTokens = tokens(term);
    if (!termTokens.length) return false;
    if (containsRun(industryTokens, termTokens)) return true;
    const significant = industryTokens.filter((t) => !GENERIC.has(t));
    return significant.length > 0 && containsRun(termTokens, significant);
  }

  function memberTerms(m) {
    const terms = [m.category];
    String(m.keywords || '').split(',').forEach((k) => { if (k.trim()) terms.push(k); });
    return terms.filter(Boolean);
  }

  // data: { members: [...], open: [...] }. Returns
  // { type: 'taken', member } | { type: 'open', category } | null.
  function match(industry, data) {
    if (!industry || !data) return null;
    const industryTokens = tokens(industry);
    if (!industryTokens.length) return null;
    const taken = (data.members || []).find((m) => memberTerms(m).some((term) => termMatches(industryTokens, term)));
    if (taken) return { type: 'taken', member: taken };
    const open = (data.open || []).find((o) => termMatches(industryTokens, o.name));
    if (open) return { type: 'open', category: open };
    return null;
  }

  function badgeHtml(m) {
    if (!m) return '';
    if (m.type === 'open') return `<span class="badge badge--seat-open" title="This matches a category the chapter is recruiting for">🔥 Open seat: ${esc(m.category.name)}</span>`;
    const who = m.member.name + (m.member.category ? ` (${m.member.category})` : '');
    return `<span class="badge badge--seat-taken" title="BNI allows one member per category. Check before inviting.">Seat may be taken: ${esc(who)}</span>`;
  }

  // A sentence for the Register Visitor popup.
  function noteHtml(m) {
    if (!m) return '';
    if (m.type === 'open') return `<p class="seat-note seat-note--open">🔥 This matches an open seat (${esc(m.category.name)}), a great fit.</p>`;
    return `<p class="seat-note seat-note--taken"><strong>Heads up:</strong> ${esc(m.member.name)} already holds the ${esc(m.member.category || 'matching')} seat. BNI allows one member per category, so check that this guest is in a different category before they visit.</p>`;
  }

  async function load(client) {
    const [members, open] = await Promise.all([
      client.from('vote_members').select('*').order('name', { ascending: true }),
      client.from('open_categories').select('*').order('sort_order').order('created_at'),
    ]);
    return {
      members: members.error ? [] : (members.data || []),
      open: open.error ? [] : (open.data || []),
      error: members.error ? members.error.message : null,
    };
  }

  // Read-only seat list: members by category, then the open seats.
  function directoryHtml(data) {
    const members = (data.members || []).slice().sort((a, b) => String(a.category || '~').localeCompare(String(b.category || '~')) || a.name.localeCompare(b.name));
    const telHref = (p) => String(p).replace(/[^0-9+]/g, '');
    const rows = members.map((m) => `<tr>
      <td><strong>${esc(m.category || 'No category yet')}</strong></td>
      <td>${esc(m.name)}</td>
      <td>${esc(m.company || '')}</td>
      <td>${m.phone ? `<a href="tel:${esc(telHref(m.phone))}">${esc(m.phone)}</a>` : ''}</td>
    </tr>`).join('');
    const open = (data.open || []).map((o) => `<span class="open-category-chip">🔥 ${esc(o.name)}</span>`).join('');
    return `
      <p class="hint" style="margin-top:0;"><strong>${members.length}</strong> members. BNI allows one member per category, so a category listed below is a seat that's already taken.</p>
      ${members.length ? `<div class="table-wrap"><table class="seats-table">
        <thead><tr><th>Seat (category)</th><th>Member</th><th>Company</th><th>Phone</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>` : '<p class="empty-state">No members listed yet.</p>'}
      <h3 style="margin:20px 0 8px; font-size:0.95rem;">Open seats</h3>
      <div>${open || '<span class="hint">None listed right now.</span>'}</div>`;
  }

  const api = { normalize, stem, tokens, match, badgeHtml, noteHtml, load, directoryHtml, esc };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.Seats = api;
})();
