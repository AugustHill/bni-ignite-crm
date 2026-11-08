// The Dev Blog: short posts about what's new in the app, for everyone who
// uses it. updates.html shows the feed (and, for the owner, the editor);
// admin.html and caller.html call Updates.markNew() to put a dot on the
// Dev Blog link when there's a post the person hasn't seen.
//
// Needs migration 026. Everyone logged in can read published posts, only the
// owner can write, edit or delete, and only the owner sees drafts.

(function () {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const CATEGORIES = { new: 'New', improved: 'Improved', fixed: 'Fixed', note: 'Note' };

  // Escaped text in, light formatting out: **bold** and web links. Everything
  // is escaped first, so nothing typed into a post can inject markup.
  function inline(escaped) {
    return escaped
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)])/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
  }

  // Blank line starts a new paragraph, a line starting with "- " is a
  // bullet, **bold** is bold, a single line break stays a line break.
  function renderBody(text) {
    const lines = String(text || '').replace(/\r\n/g, '\n').trim().split('\n');
    const out = [];
    let para = [];
    let bullets = [];
    const flushPara = () => { if (para.length) { out.push(`<p>${para.map((l) => inline(esc(l))).join('<br>')}</p>`); para = []; } };
    const flushBullets = () => { if (bullets.length) { out.push(`<ul>${bullets.map((l) => `<li>${inline(esc(l))}</li>`).join('')}</ul>`); bullets = []; } };
    lines.forEach((line) => {
      if (!line.trim()) { flushPara(); flushBullets(); return; }
      const bullet = line.match(/^\s*[-*] (.*)$/);
      if (bullet) { flushPara(); bullets.push(bullet[1]); } else { flushBullets(); para.push(line); }
    });
    flushPara();
    flushBullets();
    return out.join('');
  }

  const fmtDate = (iso) => new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'America/New_York' });

  const api = { renderBody, fmtDate, CATEGORIES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window === 'undefined') return;

  // ---------- the "something new" dot ----------

  const seenKey = (userId) => `devblog_seen_${userId}`;
  function getSeen(userId) { try { return window.localStorage.getItem(seenKey(userId)); } catch (err) { return null; } }
  function setSeen(userId, value) { try { window.localStorage.setItem(seenKey(userId), value); } catch (err) { /* private window: no dot memory, harmless */ } }

  // Adds the has-new class to the link when the newest published post is
  // newer than the last one this person looked at. Silent if anything fails
  // (for instance the database update hasn't been run yet).
  async function markNew(client, linkEl, userId) {
    try {
      if (!linkEl) return;
      const { data, error } = await client.from('dev_posts').select('published_at').eq('published', true).order('published_at', { ascending: false }).limit(1);
      if (error || !data || !data.length) return;
      const seen = getSeen(userId);
      if (!seen || new Date(data[0].published_at) > new Date(seen)) linkEl.classList.add('has-new');
    } catch (err) { /* never let the dot break a page */ }
  }

  // ---------- the Dev Blog page ----------

  const state = { client: null, profile: null, root: null, posts: [], editingId: null, error: null };
  const isOwner = () => state.profile && state.profile.role === 'owner';

  async function load() {
    const { data, error } = await state.client.from('dev_posts').select('*').order('published_at', { ascending: false });
    if (error) {
      state.error = error.message;
    } else {
      state.error = null;
      state.posts = data || [];
      const newest = state.posts.find((p) => p.published);
      if (newest) setSeen(state.profile.id, newest.published_at);
    }
    render();
  }

  const categoryOptions = (selected) => Object.entries(CATEGORIES).map(([v, l]) => `<option value="${v}" ${v === selected ? 'selected' : ''}>${l}</option>`).join('');

  function formHtml(post) {
    const p = post || { title: '', body: '', category: 'new' };
    return `
      <div class="form-group"><label>Title</label><input type="text" class="dp-title" maxlength="140" value="${esc(p.title)}"></div>
      <div class="form-group"><label>Type</label><select class="dp-category">${categoryOptions(p.category)}</select></div>
      <div class="form-group">
        <label>Post</label>
        <textarea class="dp-body" rows="9">${esc(p.body)}</textarea>
        <p class="hint" style="margin:4px 0 0;">A blank line starts a new paragraph. Start a line with "- " for a bullet. Put **two asterisks** around a word to make it bold.</p>
      </div>`;
  }

  function postHtml(p) {
    const editing = state.editingId === p.id;
    if (editing && isOwner()) {
      return `<div class="card dev-post" data-id="${esc(p.id)}">
        <h2>Edit post</h2>
        ${formHtml(p)}
        <p class="error-msg dp-error"></p>
        <div style="display:flex; gap:8px;">
          <button type="button" class="btn btn--primary" data-dp-act="save-edit" data-id="${esc(p.id)}">Save changes</button>
          <button type="button" class="btn btn--outline" data-dp-act="cancel-edit">Cancel</button>
        </div>
      </div>`;
    }
    const owner = isOwner() ? `<div class="dev-post-actions">
      ${p.published
        ? `<button type="button" class="link-btn" data-dp-act="unpublish" data-id="${esc(p.id)}">Move to drafts</button>`
        : `<button type="button" class="btn btn--primary btn--sm" data-dp-act="publish" data-id="${esc(p.id)}">Publish</button>`}
      <button type="button" class="link-btn" data-dp-act="edit" data-id="${esc(p.id)}">Edit</button>
      <button type="button" class="link-btn" data-dp-act="delete" data-id="${esc(p.id)}" data-title="${esc(p.title)}">Delete</button>
    </div>` : '';
    return `<article class="card dev-post${p.published ? '' : ' dev-post--draft'}" data-id="${esc(p.id)}">
      <div class="dev-post-meta">
        <span class="badge badge--dev-${esc(p.category)}">${esc(CATEGORIES[p.category] || p.category)}</span>
        ${p.published ? '' : '<span class="badge badge--dnc">Draft, only you can see this</span>'}
        <span class="hint" style="margin:0;">${esc(fmtDate(p.published_at))}${p.author_name ? ` · ${esc(p.author_name)}` : ''}</span>
      </div>
      <h2 class="dev-post-title">${esc(p.title)}</h2>
      <div class="dev-post-body">${renderBody(p.body)}</div>
      ${owner}
    </article>`;
  }

  function render() {
    const root = state.root;
    if (state.error) {
      root.innerHTML = `<div class="card"><p class="empty-state">Couldn't load the Dev Blog: ${esc(state.error)}. If this mentions a missing table, the latest database update (migration 026) hasn't been run yet.</p></div>`;
      return;
    }
    const compose = isOwner() ? `<div class="card" id="dp-compose">
      <h2>New post</h2>
      ${formHtml(null)}
      <p class="error-msg dp-error"></p>
      <div style="display:flex; gap:8px; flex-wrap:wrap;">
        <button type="button" class="btn btn--primary" data-dp-act="publish-new">Publish</button>
        <button type="button" class="btn btn--outline" data-dp-act="draft-new">Save as draft</button>
      </div>
    </div>` : '';
    // Keep a half-written new post when the list re-renders (for instance
    // when another post is opened for editing).
    const old = root.querySelector('#dp-compose');
    const kept = old ? { title: old.querySelector('.dp-title').value, body: old.querySelector('.dp-body').value, category: old.querySelector('.dp-category').value } : null;
    root.innerHTML = compose + (state.posts.length ? state.posts.map(postHtml).join('') : '<div class="card"><p class="empty-state" style="margin:0;">No updates posted yet.</p></div>');
    const box = root.querySelector('#dp-compose');
    if (kept && box) {
      box.querySelector('.dp-title').value = kept.title;
      box.querySelector('.dp-body').value = kept.body;
      box.querySelector('.dp-category').value = kept.category;
    }
  }

  function readForm(container) {
    return {
      title: container.querySelector('.dp-title').value.replace(/\s+/g, ' ').trim(),
      body: container.querySelector('.dp-body').value.replace(/\s+$/g, '').replace(/^\s+/g, ''),
      category: container.querySelector('.dp-category').value,
    };
  }

  function checkForm(container, f) {
    const errEl = container.querySelector('.dp-error');
    errEl.textContent = '';
    if (!f.title) { errEl.textContent = 'Give the post a title.'; return false; }
    if (!f.body) { errEl.textContent = 'Write something in the post.'; return false; }
    return true;
  }

  async function onClick(e) {
    const btn = e.target.closest('[data-dp-act]');
    if (!btn || !isOwner()) return;
    const { client, profile } = state;
    const act = btn.dataset.dpAct;
    const fail = (container, message) => { container.querySelector('.dp-error').textContent = message; };

    if (act === 'publish-new' || act === 'draft-new') {
      const box = state.root.querySelector('#dp-compose');
      const f = readForm(box);
      if (!checkForm(box, f)) return;
      const publish = act === 'publish-new';
      const { error } = await client.from('dev_posts').insert({ ...f, published: publish, published_at: new Date().toISOString(), author_name: profile.full_name });
      if (error) return fail(box, error.message);
      // Saved: empty the form first, or the re-render would put the old text back.
      box.querySelector('.dp-title').value = '';
      box.querySelector('.dp-body').value = '';
      box.querySelector('.dp-category').value = 'new';
      await load();
    } else if (act === 'edit') {
      state.editingId = btn.dataset.id;
      render();
    } else if (act === 'cancel-edit') {
      state.editingId = null;
      render();
    } else if (act === 'save-edit') {
      const box = btn.closest('.dev-post');
      const f = readForm(box);
      if (!checkForm(box, f)) return;
      const { error } = await client.from('dev_posts').update(f).eq('id', btn.dataset.id);
      if (error) return fail(box, error.message);
      state.editingId = null;
      await load();
    } else if (act === 'publish') {
      const { error } = await client.from('dev_posts').update({ published: true, published_at: new Date().toISOString() }).eq('id', btn.dataset.id);
      if (error) return window.alert(error.message);
      await load();
    } else if (act === 'unpublish') {
      const { error } = await client.from('dev_posts').update({ published: false }).eq('id', btn.dataset.id);
      if (error) return window.alert(error.message);
      await load();
    } else if (act === 'delete') {
      if (!window.confirm(`Delete the post "${btn.dataset.title}"? This cannot be undone.`)) return;
      const { error } = await client.from('dev_posts').delete().eq('id', btn.dataset.id);
      if (error) return window.alert(error.message);
      await load();
    }
  }

  window.Updates = Object.assign({}, api, {
    markNew,
    mount(client, profile, root) {
      state.client = client;
      state.profile = profile;
      state.root = root;
      if (!root.dataset.devWired) {
        root.addEventListener('click', onClick);
        root.dataset.devWired = '1';
      }
      return load();
    },
  });
})();
