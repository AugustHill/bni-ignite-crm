// The owner-only Profession Vote tab in admin.html: results ranked by dollars
// pledged, who has and hasn't submitted, the member roster the public form
// (vote.html) draws its name list from, and the open/closed switch.
//
// Needs migration 024. The pure ranking logic (buildResults) is kept apart
// from the page code so it can be tested on its own.
//
// Ranking rules (from the owner): a profession's score is the total of every
// dollar pledged toward it; $0 entries are recorded but never counted, so a
// profession nobody put money on isn't ranked at all. Entries are grouped by
// what members typed, ignoring capitalization and punctuation, and the owner
// can combine look-alikes ("Plumber" and "Plumbing") with one click.

(function () {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (n) => '$' + Number(n || 0).toLocaleString('en-US');

  function normalize(s) {
    return String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  // Shows what members typed, capitalizing only when they typed it all in
  // lowercase, so "HVAC" and "Roofing Contractor" are left alone.
  function displayLabel(raw) {
    const text = String(raw || '').trim();
    if (text !== text.toLowerCase()) return text;
    return text.replace(/(^|\s)(\S)/g, (m, space, ch) => space + ch.toUpperCase());
  }

  function mostCommon(values) {
    const counts = new Map();
    values.forEach((v) => counts.set(v, (counts.get(v) || 0) + 1));
    let best = null;
    counts.forEach((count, v) => { if (best === null || count > counts.get(best)) best = v; });
    return best;
  }

  // members: [{id,name}], submissions: [{id,member_id,submitted_at}],
  // pledges: [{id,submission_id,slot,profession,amount,group_name}]
  function buildResults(members, submissions, pledges) {
    const memberById = new Map(members.map((m) => [m.id, m]));
    const subById = new Map(submissions.map((s) => [s.id, s]));

    const groups = new Map();
    pledges.forEach((p) => {
      const sub = subById.get(p.submission_id);
      const member = sub && memberById.get(sub.member_id);
      if (!member) return;
      const raw = String(p.group_name || p.profession || '').replace(/\s+/g, ' ').trim();
      const key = normalize(raw);
      if (!key) return;
      if (!groups.has(key)) groups.set(key, { key, entries: [], rawNames: [], total: 0, backerIds: new Set() });
      const g = groups.get(key);
      g.entries.push({ ...p, memberName: member.name, memberId: member.id });
      g.rawNames.push(raw);
      g.total += Number(p.amount) || 0;
      if ((Number(p.amount) || 0) > 0) g.backerIds.add(member.id);
    });

    const all = [...groups.values()].map((g) => {
      const raw = mostCommon(g.rawNames);
      return { key: g.key, raw, label: displayLabel(raw), entries: g.entries, total: g.total, backers: g.backerIds.size };
    });
    const byRank = (a, b) => b.total - a.total || b.backers - a.backers || a.label.localeCompare(b.label);
    const ranked = all.filter((g) => g.total > 0).sort(byRank);
    const unranked = all.filter((g) => g.total === 0).sort((a, b) => a.label.localeCompare(b.label));

    // A tie at the bottom of the top three means the list can't name exactly three.
    let tieNote = null;
    if (ranked.length > 3 && ranked[3].total === ranked[2].total) {
      const tied = ranked.filter((g) => g.total === ranked[2].total).map((g) => g.label);
      tieNote = `Tied for third place at ${money(ranked[2].total)}: ${tied.join(', ')}.`;
    }

    const votedIds = new Set(submissions.map((s) => s.member_id));
    return {
      ranked, unranked, tieNote,
      top: ranked.slice(0, 3),
      voted: members.filter((m) => votedIds.has(m.id)),
      notVoted: members.filter((m) => !votedIds.has(m.id)),
    };
  }

  const api = { normalize, displayLabel, buildResults };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window === 'undefined') return;

  // ---------- page code ----------
  const state = { client: null, root: null, members: [], submissions: [], pledges: [], isOpen: true, expanded: new Set(), error: null };

  async function load() {
    const { client } = state;
    const [members, submissions, pledges, settings] = await Promise.all([
      client.from('vote_members').select('*').order('name', { ascending: true }),
      client.from('vote_submissions').select('*').order('submitted_at', { ascending: true }),
      client.from('vote_pledges').select('*'),
      client.from('vote_settings').select('*').eq('id', 1).maybeSingle(),
    ]);
    const failed = [members, submissions, pledges, settings].find((r) => r.error);
    if (failed) {
      state.error = failed.error.message;
      render();
      return;
    }
    state.error = null;
    state.members = members.data || [];
    state.submissions = submissions.data || [];
    state.pledges = pledges.data || [];
    state.isOpen = settings.data ? settings.data.is_open !== false : true;
    render();
  }

  function formUrl() {
    return `${window.location.origin}/vote.html`;
  }

  function resultRowHtml(g, rank) {
    const open = state.expanded.has(g.key);
    const isTop = rank !== null && rank <= 3;
    const main = `<tr class="${isTop ? 'vote-top' : ''}">
      <td>${rank === null ? '&ndash;' : rank}</td>
      <td><strong>${esc(g.label)}</strong>${isTop ? ' <span class="badge badge--status-joined_bni">Top 3</span>' : ''}</td>
      <td>${money(g.total)}</td>
      <td>${g.backers}</td>
      <td style="text-align:right;"><button type="button" class="btn btn--outline btn--sm" data-vote-act="expand" data-key="${esc(g.key)}">${open ? 'Hide' : 'Details'}</button></td>
    </tr>`;
    if (!open) return main;

    const entries = g.entries.slice().sort((a, b) => b.amount - a.amount || a.memberName.localeCompare(b.memberName));
    const lines = entries.map((e) => {
      const typed = normalize(e.profession) === g.key && !e.group_name ? '' : ` <span class="hint" style="margin:0;">typed "${esc(e.profession)}"</span>`;
      const ungroup = e.group_name ? ` <button type="button" class="link-btn" data-vote-act="ungroup" data-id="${esc(e.id)}">Ungroup</button>` : '';
      return `<div class="vote-entry"><span>${esc(e.memberName)}</span><span>${money(e.amount)}${amountNote(e)}</span><span>${typed}${ungroup}</span></div>`;
    }).join('');

    const others = [...state.results.ranked, ...state.results.unranked].filter((x) => x.key !== g.key);
    const combine = others.length ? `
      <div class="vote-combine">
        <label>Same profession as another entry?</label>
        <select data-combine-for="${esc(g.key)}"><option value="">Combine into…</option>${others.map((o) => `<option value="${esc(o.key)}">${esc(o.label)}</option>`).join('')}</select>
        <button type="button" class="btn btn--outline btn--sm" data-vote-act="combine" data-key="${esc(g.key)}">Combine</button>
      </div>` : '';

    return main + `<tr class="vote-detail-row"><td></td><td colspan="4">${lines}${combine}</td></tr>`;
  }

  function amountNote(e) {
    return e.amount === 0 ? ' <span class="hint" style="margin:0;">(no pledge, not counted)</span>' : '';
  }

  function render() {
    const root = state.root;
    if (!root) return;
    if (state.error) {
      root.innerHTML = `<div class="card"><p class="empty-state">Couldn't load the vote: ${esc(state.error)}. If this mentions a missing table, the latest database update (migration 024) hasn't been run yet.</p></div>`;
      return;
    }

    const results = buildResults(state.members, state.submissions, state.pledges);
    state.results = results;

    const subByMember = new Map(state.submissions.map((s) => [s.member_id, s]));
    const pledgeTotals = new Map();
    state.pledges.forEach((p) => pledgeTotals.set(p.submission_id, (pledgeTotals.get(p.submission_id) || 0) + (Number(p.amount) || 0)));
    const pledgeCounts = new Map();
    state.pledges.forEach((p) => pledgeCounts.set(p.submission_id, (pledgeCounts.get(p.submission_id) || 0) + 1));

    const resultRows = results.ranked.map((g, i) => resultRowHtml(g, i + 1)).join('');
    const unrankedRows = results.unranked.map((g) => resultRowHtml(g, null)).join('');

    root.innerHTML = `
      <div class="card">
        <h2>Profession Vote</h2>
        <p class="hint" style="margin-top:-6px;">Only you can see this. Members fill out the form at the link below and never see these results.</p>
        <div class="vote-status">
          <span class="badge ${state.isOpen ? 'badge--status-joined_bni' : 'badge--dnc'}">Voting is ${state.isOpen ? 'open' : 'closed'}</span>
          <span><strong>${results.voted.length}</strong> of <strong>${state.members.length}</strong> members have submitted</span>
          <button type="button" class="btn btn--outline btn--sm" data-vote-act="toggle-open">${state.isOpen ? 'Close voting' : 'Reopen voting'}</button>
          <button type="button" class="btn btn--outline btn--sm" data-vote-act="refresh">Refresh</button>
        </div>
        <div class="form-group" style="margin-top:12px;">
          <label for="vote-link">Form link to send to members</label>
          <div style="display:flex; gap:8px;">
            <input type="text" id="vote-link" readonly value="${esc(formUrl())}" style="flex:1;">
            <button type="button" class="btn btn--outline btn--sm" data-vote-act="copy-link">Copy</button>
          </div>
        </div>
      </div>

      <div class="card">
        <h2>Results</h2>
        <p class="hint" style="margin-top:-6px;">Ranked by total dollars pledged. Entries with $0 pledged are never counted.</p>
        ${results.ranked.length || results.unranked.length ? `
        <div class="table-wrap">
          <table>
            <thead><tr><th>Rank</th><th>Profession</th><th>Total pledged</th><th>Backers</th><th></th></tr></thead>
            <tbody>
              ${resultRows || '<tr><td colspan="5" class="empty-state">No money has been pledged yet.</td></tr>'}
              ${unrankedRows ? `<tr><td colspan="5" class="hint" style="padding-top:18px;"><strong>Named, but no money pledged (not counted)</strong></td></tr>${unrankedRows}` : ''}
            </tbody>
          </table>
        </div>
        ${results.tieNote ? `<p class="hint"><strong>${esc(results.tieNote)}</strong></p>` : ''}` : '<p class="empty-state">No submissions yet.</p>'}
      </div>

      <div class="card">
        <h2>Who has submitted</h2>
        ${results.voted.length ? `<div class="table-wrap"><table>
          <thead><tr><th>Member</th><th>Submitted</th><th>Professions</th><th>Total pledged</th><th></th></tr></thead>
          <tbody>${results.voted.map((m) => {
            const sub = subByMember.get(m.id);
            return `<tr><td>${esc(m.name)}</td><td>${esc(new Date(sub.submitted_at).toLocaleString())}</td><td>${pledgeCounts.get(sub.id) || 0}</td><td>${money(pledgeTotals.get(sub.id) || 0)}</td>
              <td style="text-align:right;"><button type="button" class="btn btn--danger btn--sm" data-vote-act="delete-vote" data-id="${esc(sub.id)}" data-name="${esc(m.name)}">Delete submission</button></td></tr>`;
          }).join('')}</tbody></table></div>
        <p class="hint">Deleting a submission lets that member submit again.</p>` : '<p class="empty-state">Nobody yet.</p>'}
        <h3 style="margin:18px 0 6px; font-size:0.95rem;">Not yet submitted (${results.notVoted.length})</h3>
        <p>${results.notVoted.length ? results.notVoted.map((m) => esc(m.name)).join(', ') : 'Everyone on the roster has submitted.'}</p>
      </div>

      <div class="card">
        <h2>Member roster</h2>
        <p class="hint" style="margin-top:-6px;">These names fill the dropdown on the form. Paste new names one per line.</p>
        <div class="form-group">
          <textarea id="vote-roster-input" rows="4" placeholder="One name per line"></textarea>
        </div>
        <button type="button" class="btn btn--primary btn--sm" data-vote-act="add-members">Add to roster</button>
        <p class="error-msg" id="vote-roster-error"></p>
        ${state.members.length ? `<div class="vote-roster">${state.members.map((m) => `<span class="vote-chip">${esc(m.name)}${subByMember.has(m.id) ? ' &#10003;' : ''}<button type="button" aria-label="Remove ${esc(m.name)}" data-vote-act="remove-member" data-id="${esc(m.id)}" data-name="${esc(m.name)}" data-voted="${subByMember.has(m.id) ? '1' : ''}">&times;</button></span>`).join('')}</div>
        <p class="hint">A check mark means that member has submitted. Removing a member also deletes their submission.</p>` : '<p class="empty-state">No members yet. Paste the roster above.</p>'}
      </div>`;
  }

  function fail(message) {
    window.alert(message);
  }

  async function onClick(e) {
    const btn = e.target.closest('[data-vote-act]');
    if (!btn) return;
    const { client } = state;
    const act = btn.dataset.voteAct;

    if (act === 'expand') {
      const key = btn.dataset.key;
      if (state.expanded.has(key)) state.expanded.delete(key); else state.expanded.add(key);
      render();
    } else if (act === 'refresh') {
      await load();
    } else if (act === 'copy-link') {
      const input = document.getElementById('vote-link');
      try { await navigator.clipboard.writeText(input.value); btn.textContent = 'Copied'; setTimeout(() => { btn.textContent = 'Copy'; }, 1500); }
      catch (err) { input.select(); }
    } else if (act === 'toggle-open') {
      const { error } = await client.from('vote_settings').upsert({ id: 1, is_open: !state.isOpen });
      if (error) return fail(error.message);
      await load();
    } else if (act === 'add-members') {
      const input = document.getElementById('vote-roster-input');
      const errEl = document.getElementById('vote-roster-error');
      errEl.textContent = '';
      const existing = new Set(state.members.map((m) => m.name.toLowerCase()));
      const names = [];
      input.value.split(/\r?\n/).map((n) => n.replace(/\s+/g, ' ').trim()).filter(Boolean).forEach((n) => {
        if (!existing.has(n.toLowerCase()) && !names.some((x) => x.toLowerCase() === n.toLowerCase())) names.push(n);
      });
      if (!names.length) { errEl.textContent = 'Enter at least one new name, one per line.'; return; }
      const { error } = await client.from('vote_members').insert(names.map((name) => ({ name })));
      if (error) { errEl.textContent = error.message; return; }
      await load();
    } else if (act === 'remove-member') {
      const warn = btn.dataset.voted ? ` Their submission will be deleted too.` : '';
      if (!window.confirm(`Remove ${btn.dataset.name} from the roster?${warn}`)) return;
      const { error } = await client.from('vote_members').delete().eq('id', btn.dataset.id);
      if (error) return fail(error.message);
      await load();
    } else if (act === 'delete-vote') {
      if (!window.confirm(`Delete ${btn.dataset.name}'s submission? They will be able to submit again.`)) return;
      const { error } = await client.from('vote_submissions').delete().eq('id', btn.dataset.id);
      if (error) return fail(error.message);
      await load();
    } else if (act === 'ungroup') {
      const { error } = await client.from('vote_pledges').update({ group_name: null }).eq('id', btn.dataset.id);
      if (error) return fail(error.message);
      await load();
    } else if (act === 'combine') {
      const select = state.root.querySelector(`select[data-combine-for="${CSS.escape(btn.dataset.key)}"]`);
      const source = state.results.ranked.concat(state.results.unranked).find((g) => g.key === btn.dataset.key);
      const target = select && state.results.ranked.concat(state.results.unranked).find((g) => g.key === select.value);
      if (!source || !target) return fail('Choose which profession to combine this into.');
      if (!window.confirm(`Combine "${source.label}" into "${target.label}"? Their dollars will be added together.`)) return;
      const { error } = await client.from('vote_pledges').update({ group_name: target.raw }).in('id', source.entries.map((x) => x.id));
      if (error) return fail(error.message);
      state.expanded.delete(source.key);
      await load();
    }
  }

  window.VoteAdmin = Object.assign({}, api, {
    init(client, root) {
      state.client = client;
      state.root = root;
      if (!root.dataset.voteWired) {
        root.addEventListener('click', onClick);
        root.dataset.voteWired = '1';
      }
    },
    load,
  });
})();
