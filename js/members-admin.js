// The Members tab in admin.html: add, edit and remove chapter members, and
// see the seat list the callers see. Reads and writes vote_members (also the
// profession vote roster). Callers can read the roster but only coordinators
// and the owner can change it (policies in migration 025).

(function () {
  if (typeof window === 'undefined') return;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const state = { client: null, root: null, data: { members: [], open: [] }, editingId: null, onChanged: null };

  async function load() {
    state.data = await window.Seats.load(state.client);
    render();
    if (state.onChanged) state.onChanged(state.data);
  }

  function rowHtml(m) {
    return `<tr>
      <td><strong>${esc(m.category || '')}</strong>${m.category ? '' : '<span class="hint">No category yet</span>'}</td>
      <td>${esc(m.name)}</td>
      <td>${esc(m.company || '')}</td>
      <td style="white-space:nowrap;">${esc(m.phone || '')}</td>
      <td class="hint" style="max-width:260px;">${esc(m.keywords || '')}</td>
      <td style="white-space:nowrap; text-align:right;">
        <button type="button" class="btn btn--outline btn--sm" data-mem-act="edit" data-id="${esc(m.id)}">Edit</button>
        <button type="button" class="btn btn--danger btn--sm" data-mem-act="remove" data-id="${esc(m.id)}" data-name="${esc(m.name)}">Remove</button>
      </td>
    </tr>`;
  }

  function render() {
    const { root, data } = state;
    if (!root) return;
    if (data.error) {
      root.innerHTML = `<div class="card"><p class="empty-state">Couldn't load the members: ${esc(data.error)}. If this mentions a missing column, the latest database update (migration 025) hasn't been run yet.</p></div>`;
      return;
    }
    const members = data.members.slice().sort((a, b) => String(a.category || '~').localeCompare(String(b.category || '~')) || a.name.localeCompare(b.name));
    const editing = state.editingId ? members.find((m) => m.id === state.editingId) : null;
    const v = editing || { name: '', company: '', phone: '', category: '', keywords: '' };

    root.innerHTML = `
      <div class="card">
        <h2>Chapter Members</h2>
        <p class="hint" style="margin-top:-6px;">${members.length} members. The callers see this same list on their Chapter Seats tab (without the edit buttons). BNI allows one member per category, so each category here is a taken seat.</p>
        ${members.length ? `<div class="table-wrap"><table class="seats-table">
          <thead><tr><th>Seat (category)</th><th>Member</th><th>Company</th><th>Phone</th><th>Also matches</th><th></th></tr></thead>
          <tbody>${members.map(rowHtml).join('')}</tbody>
        </table></div>` : '<p class="empty-state">No members yet. Add the first one below.</p>'}
      </div>

      <div class="card">
        <h2>${editing ? `Edit ${esc(editing.name)}` : 'Add a Member'}</h2>
        <form id="member-form" class="grid grid-2">
          <div class="form-group"><label for="mem-name">Name</label><input type="text" id="mem-name" value="${esc(v.name)}" required></div>
          <div class="form-group"><label for="mem-company">Company</label><input type="text" id="mem-company" value="${esc(v.company)}"></div>
          <div class="form-group"><label for="mem-phone">Phone</label><input type="tel" id="mem-phone" value="${esc(v.phone)}" placeholder="727-555-0100"></div>
          <div class="form-group"><label for="mem-category">Seat (BNI category)</label><input type="text" id="mem-category" value="${esc(v.category)}" placeholder="e.g. Residential Roofing"></div>
          <div class="form-group" style="grid-column:1/-1;">
            <label for="mem-keywords">Also matches (optional)</label>
            <input type="text" id="mem-keywords" value="${esc(v.keywords)}" placeholder="roofing, roofer, roof repair">
            <p class="hint" style="margin:4px 0 0;">Other words a prospect's industry might use for this seat, separated by commas. When a prospect's industry contains the category or any of these, the callers see a "seat may be taken" warning.</p>
          </div>
          <div style="grid-column:1/-1; display:flex; gap:8px; align-items:center;">
            <button type="submit" class="btn btn--primary">${editing ? 'Save changes' : 'Add member'}</button>
            ${editing ? '<button type="button" class="btn btn--outline" data-mem-act="cancel">Cancel</button>' : ''}
            <span class="error-msg" id="member-error" style="margin:0;"></span>
          </div>
        </form>
      </div>

      <div class="card">
        <h2>Open Seats</h2>
        <p class="hint" style="margin-top:-6px;">Categories the chapter is recruiting for. Add or remove them on the Dashboard tab.</p>
        <div>${data.open.length ? data.open.map((o) => `<span class="open-category-chip">🔥 ${esc(o.name)}</span>`).join('') : '<span class="hint">None listed right now.</span>'}</div>
      </div>`;

    root.querySelector('#member-form').addEventListener('submit', save);
  }

  async function save(e) {
    e.preventDefault();
    const { root, client } = state;
    const errEl = root.querySelector('#member-error');
    errEl.textContent = '';
    const clean = (id) => root.querySelector(id).value.replace(/\s+/g, ' ').trim();
    const name = clean('#mem-name');
    if (!name) { errEl.textContent = 'Enter the member\'s name.'; return; }
    const phone = clean('#mem-phone');
    const payload = {
      name,
      company: clean('#mem-company') || null,
      phone: (typeof formatPhone === 'function' ? formatPhone(phone) : phone) || null,
      category: clean('#mem-category') || null,
      keywords: clean('#mem-keywords') || null,
    };
    const result = state.editingId
      ? await client.from('vote_members').update(payload).eq('id', state.editingId)
      : await client.from('vote_members').insert(payload);
    if (result.error) {
      errEl.textContent = /duplicate|unique/i.test(result.error.message) ? 'A member with that name is already on the list.' : result.error.message;
      return;
    }
    state.editingId = null;
    await load();
  }

  async function onClick(e) {
    const btn = e.target.closest('[data-mem-act]');
    if (!btn) return;
    const act = btn.dataset.memAct;
    if (act === 'edit') {
      state.editingId = btn.dataset.id;
      render();
      state.root.querySelector('#member-form').scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else if (act === 'cancel') {
      state.editingId = null;
      render();
    } else if (act === 'remove') {
      if (!window.confirm(`Remove ${btn.dataset.name} from the chapter roster? If they submitted the profession vote, that submission is deleted too.`)) return;
      const { error } = await state.client.from('vote_members').delete().eq('id', btn.dataset.id);
      if (error) { window.alert(error.message); return; }
      if (state.editingId === btn.dataset.id) state.editingId = null;
      await load();
    }
  }

  window.MembersAdmin = {
    init(client, root, onChanged) {
      state.client = client;
      state.root = root;
      state.onChanged = onChanged || null;
      if (!root.dataset.membersWired) {
        root.addEventListener('click', onClick);
        root.dataset.membersWired = '1';
      }
    },
    load,
  };
})();
