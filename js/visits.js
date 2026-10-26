// Visitor registration, shared by caller.html and admin.html (load after
// js/session.js). Builds its own popup, so neither page needs markup for it.
//
//   Visits.register({ client, profile, contact?, callers?, onChanged })
//   Visits.changeDate({ client, profile, registration, label, onChanged })
//   Visits.cancel({ client, profile, registration, label, onChanged })
//   Visits.setAttendance({ client, profile, registration, label, status, onChanged })
//   Visits.resend({ client, registrationId, kind, onChanged })
//
// The email itself is sent by the send-visit-email Netlify function (this
// file only asks for it), so emails only work on the live site, not on a
// local preview.

(function () {
  'use strict';

  const KIND_LABELS = {
    welcome: 'Welcome', date_change: 'Date change', cancellation: 'Cancellation',
    reminder: 'Reminder', thank_you: 'Thank-you',
  };
  const EARLY_STATUSES = ['uncontacted', 'no_answer', 'interested'];

  // ---------- small helpers ----------

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function fmtDate(iso) {
    const [y, m, d] = String(iso).split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC',
    });
  }

  function isoFromLocal(date) {
    const p = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
  }

  function splitName(full) {
    const parts = String(full || '').trim().split(/\s+/).filter(Boolean);
    return { first: parts[0] || '', last: parts.slice(1).join(' ') };
  }

  function setupMessage(error) {
    const text = `${error.code || ''} ${error.message || ''}`;
    if (/42P01|PGRST205|does not exist|schema cache/i.test(text)) {
      return "Visitor registration isn't set up in the database yet. The latest database update (migration 023) needs to be run first.";
    }
    return error.message || 'Something went wrong.';
  }

  // ---------- toast ----------

  let toastTimer;
  function toast(message, kind) {
    let el = document.getElementById('visit-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'visit-toast';
      document.body.appendChild(el);
    }
    el.textContent = message;
    el.className = `visit-toast visit-toast--${kind || 'ok'} is-visible`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('is-visible'), kind === 'error' ? 9000 : 4500);
  }

  // ---------- popup ----------

  function ensureModal() {
    if (document.getElementById('visit-modal')) return;
    const el = document.createElement('div');
    el.className = 'modal-overlay';
    el.id = 'visit-modal';
    el.style.display = 'none';
    el.innerHTML = '<div class="modal-box" style="max-width:480px;">'
      + '<div class="modal-header"><h2 id="visit-modal-title"></h2>'
      + '<button type="button" class="modal-close" id="visit-modal-close" aria-label="Close">&times;</button></div>'
      + '<div class="modal-body" id="visit-modal-body"></div></div>';
    document.body.appendChild(el);
    el.addEventListener('click', (e) => { if (e.target === el) closeModal(); });
    el.querySelector('#visit-modal-close').addEventListener('click', closeModal);
  }

  function openModal(title) {
    ensureModal();
    document.getElementById('visit-modal-title').textContent = title;
    document.getElementById('visit-modal').style.display = 'flex';
    return document.getElementById('visit-modal-body');
  }

  function closeModal() {
    const el = document.getElementById('visit-modal');
    if (el) el.style.display = 'none';
  }

  // ---------- server calls ----------

  async function sendEmail(client, registrationId, kind) {
    const { data: { session } } = await client.auth.getSession();
    if (!session) return { ok: false, error: 'You are logged out. Please log in again.' };
    try {
      const response = await fetch('/.netlify/functions/send-visit-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ registration_id: registrationId, kind }),
      });
      const text = await response.text();
      let body;
      try {
        body = JSON.parse(text);
      } catch (err) {
        return { ok: false, error: "The email service gave an unexpected answer. (Emails only send from the live site, not a local preview.)" };
      }
      return body.ok ? { ok: true } : { ok: false, error: body.error || "The email couldn't be sent." };
    } catch (err) {
      return { ok: false, error: `Couldn't reach the email service: ${err.message}` };
    }
  }

  // Moves a contact's status forward/back, but only if it's currently in
  // one of the statuses it makes sense to move from, so a contact a
  // coordinator already set deliberately (or who has joined) is left alone.
  async function moveContact(client, contactId, to, onlyFrom) {
    const { data } = await client.from('contacts').select('status').eq('id', contactId).maybeSingle();
    if (data && onlyFrom.includes(data.status)) {
      await client.from('contacts').update({ status: to }).eq('id', contactId);
    }
  }

  // Shows an email's progress inside the popup: sending, then sent or failed
  // with a Send again button.
  async function showEmailOutcome(container, client, registrationId, kind, toAddress, onChanged) {
    const label = (KIND_LABELS[kind] || kind).toLowerCase();
    container.innerHTML = `<span class="hint">Sending the ${esc(label)} email...</span>`;
    const result = await sendEmail(client, registrationId, kind);
    if (result.ok) {
      container.innerHTML = `<span class="visit-ok">The ${esc(label)} email was sent to ${esc(toAddress)}.</span>`;
    } else {
      container.innerHTML = `<span class="error-msg" style="display:block;">The ${esc(label)} email didn't send: ${esc(result.error)}</span>`
        + '<button type="button" class="btn btn--outline btn--sm" id="visit-retry" style="margin-top:8px;">Send again</button>';
      container.querySelector('#visit-retry').addEventListener('click', () => {
        showEmailOutcome(container, client, registrationId, kind, toAddress, onChanged);
      });
    }
    if (onChanged) onChanged();
  }

  // ---------- register a visitor ----------

  function register(opts) {
    const { client, profile, contact, callers } = opts;
    const isCaller = profile.role === 'caller';
    const body = openModal(contact ? 'Register Visitor' : 'Register a Guest');
    const who = contact ? (contact.business_name || contact.contact_name || 'this contact') : 'the guest';

    function pickDate(saved) {
      body.innerHTML = `<p class="hint" style="margin-top:0;">Pick the Wednesday ${esc(who)} will attend. Meetings are every Wednesday at 7:30 AM.</p><div id="visit-calendar"></div>`;
      renderMiniCalendar(document.getElementById('visit-calendar'), (date) => details(date, saved));
    }

    function details(date, prefill) {
      const name = splitName(contact ? contact.contact_name : '');
      const v = prefill || {
        first: name.first, last: name.last,
        company: contact ? (contact.business_name || '') : '',
        phone: contact ? (contact.phone || '') : '',
        email: contact ? (contact.email || '') : '',
        category: contact ? (contact.industry || '') : '',
        assigned: '',
      };
      const showAssign = !contact && !isCaller && callers && callers.length > 1;
      body.innerHTML = `
        <p style="margin:0 0 14px;"><strong>${esc(fmtDate(isoFromLocal(date)))}</strong>, 7:30 AM
          <a href="#" id="vr-change-date" style="margin-left:8px;font-size:0.85rem;">Change</a></p>
        <div class="grid grid-2">
          <div class="form-group"><label>First name</label><input type="text" id="vr-first" value="${esc(v.first)}"></div>
          <div class="form-group"><label>Last name</label><input type="text" id="vr-last" value="${esc(v.last)}"></div>
          <div class="form-group"><label>Company</label><input type="text" id="vr-company" value="${esc(v.company)}"></div>
          <div class="form-group"><label>Category</label><input type="text" id="vr-category" value="${esc(v.category)}" placeholder="e.g. Roofing"></div>
          <div class="form-group"><label>Phone</label><input type="tel" id="vr-phone" value="${esc(v.phone)}" placeholder="727-555-0100"></div>
          <div class="form-group"><label>Email (for the welcome)</label><input type="email" id="vr-email" value="${esc(v.email)}"></div>
          ${showAssign ? `<div class="form-group" style="grid-column:1/-1;"><label>Assign to</label><select id="vr-assign">${callers.map((c) => `<option value="${c.id}" ${c.id === v.assigned ? 'selected' : ''}>${esc(c.full_name)}</option>`).join('')}</select></div>` : ''}
        </div>
        <p class="error-msg" id="vr-error"></p>
        <button type="button" class="btn btn--primary" id="vr-submit">Register and Send Welcome Email</button>`;

      const readForm = () => ({
        first: body.querySelector('#vr-first').value, last: body.querySelector('#vr-last').value,
        company: body.querySelector('#vr-company').value, category: body.querySelector('#vr-category').value,
        phone: body.querySelector('#vr-phone').value, email: body.querySelector('#vr-email').value,
        assigned: showAssign ? body.querySelector('#vr-assign').value : '',
      });
      body.querySelector('#vr-change-date').addEventListener('click', (e) => { e.preventDefault(); pickDate(readForm()); });
      body.querySelector('#vr-submit').addEventListener('click', async () => {
        const btn = body.querySelector('#vr-submit');
        const errEl = body.querySelector('#vr-error');
        const form = readForm();
        errEl.textContent = '';
        btn.disabled = true;
        btn.textContent = 'Registering...';
        try {
          const reg = await createRegistration(opts, isoFromLocal(date), form);
          done(reg, date);
        } catch (err) {
          errEl.textContent = err.message;
          btn.disabled = false;
          btn.textContent = 'Register and Send Welcome Email';
        }
      });
    }

    function done(reg, date) {
      body.innerHTML = `
        <p style="margin:0 0 8px;"><strong>Registered!</strong> ${esc(reg.first_name)}${reg.last_name ? ` ${esc(reg.last_name)}` : ''} is set for ${esc(fmtDate(reg.meeting_date))}.</p>
        <div id="vr-email-status" style="margin:0 0 16px;"></div>
        <button type="button" class="btn btn--primary" id="vr-done">Done</button>`;
      body.querySelector('#vr-done').addEventListener('click', closeModal);
      showEmailOutcome(body.querySelector('#vr-email-status'), client, reg.id, 'welcome', reg.email, opts.onChanged);
    }

    pickDate();
  }

  async function createRegistration(opts, meetingDate, f) {
    const { client, profile, contact, callers } = opts;
    const first = f.first.trim();
    const last = f.last.trim();
    const email = f.email.trim();
    const company = f.company.trim();
    const phone = formatPhone(f.phone);
    const industry = titleCase(f.category);

    if (!first) throw new Error('First name is required.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid email address, the welcome email goes there.');

    const fullName = [first, last].filter(Boolean).join(' ');
    let contactId;
    let label;
    let contactPhone;

    if (contact) {
      contactId = contact.id;
      label = contact.business_name || contact.contact_name || fullName;
      const { data: active, error: activeError } = await client
        .from('visit_registrations').select('meeting_date').eq('contact_id', contact.id).eq('status', 'registered').limit(1);
      if (activeError) throw new Error(setupMessage(activeError));
      if (active && active.length) {
        throw new Error(`Already registered for ${fmtDate(active[0].meeting_date)}. Use Change date on their card instead.`);
      }
      // Keep the contact in step with what was just confirmed, changing only
      // what the form actually has a different value for.
      const updates = {};
      if (fullName && fullName !== contact.contact_name) updates.contact_name = fullName;
      if (company && company !== contact.business_name) updates.business_name = company;
      if (phone && phone !== contact.phone) updates.phone = phone;
      if (email !== contact.email) updates.email = email;
      if (industry && industry !== contact.industry) updates.industry = industry;
      if (Object.keys(updates).length) {
        const { error } = await client.from('contacts').update(updates).eq('id', contact.id);
        if (error) throw new Error(error.message);
        Object.assign(contact, updates);
      }
      contactPhone = phone || contact.phone;
    } else {
      if (!phone) throw new Error('A phone number is required for a new guest.');
      const { data: dupes } = await client.from('contacts').select('business_name,contact_name').eq('phone', phone).limit(1);
      if (dupes && dupes.length) {
        throw new Error(`Someone with that phone number is already in the list (${dupes[0].business_name || dupes[0].contact_name || 'no name'}). Open their card and use Register Visitor there.`);
      }
      let assignedTo = profile.id;
      if (profile.role !== 'caller') {
        assignedTo = f.assigned || (callers && callers[0] && callers[0].id);
        if (!assignedTo) throw new Error('Add a caller on the Team tab first, new guests are assigned to a caller.');
      }
      const { data: created, error } = await client.from('contacts').insert({
        business_name: company || null, contact_name: fullName, phone, email,
        industry: industry || null, status: 'visit_scheduled', assigned_to: assignedTo,
      }).select().single();
      if (error) throw new Error(error.message);
      contactId = created.id;
      label = company || fullName;
      contactPhone = phone;
    }

    const { data: reg, error: regError } = await client.from('visit_registrations').insert({
      contact_id: contactId, meeting_date: meetingDate, first_name: first, last_name: last || null,
      company: company || null, phone: contactPhone || null, email, category: industry || null,
      registered_by: profile.id, registered_by_name: profile.full_name,
    }).select().single();
    if (regError) {
      if (regError.code === '23505') throw new Error('This contact already has an active registration.');
      throw new Error(setupMessage(regError));
    }

    if (contact) await moveContact(client, contactId, 'visit_scheduled', EARLY_STATUSES);
    logActivity(client, profile.id, 'visitor_registered', contactId, label, fmtDate(meetingDate));
    return reg;
  }

  // ---------- change date ----------

  function changeDate(opts) {
    const { client, profile, registration, label } = opts;
    const body = openModal('Change Visit Date');
    const name = [registration.first_name, registration.last_name].filter(Boolean).join(' ');

    function pick() {
      body.innerHTML = `<p class="hint" style="margin-top:0;">Currently ${esc(fmtDate(registration.meeting_date))}. Pick the new Wednesday for ${esc(name)}:</p><div id="visit-calendar"></div>`;
      renderMiniCalendar(document.getElementById('visit-calendar'), (date) => confirmMove(isoFromLocal(date)));
    }

    function confirmMove(newDate) {
      if (newDate === registration.meeting_date) { pick(); return; }
      body.innerHTML = `
        <p style="margin:0 0 14px;">Move <strong>${esc(name)}</strong> from ${esc(fmtDate(registration.meeting_date))} to <strong>${esc(fmtDate(newDate))}</strong>? They will get an email with the new date.</p>
        <p class="error-msg" id="cd-error"></p>
        <button type="button" class="btn btn--primary" id="cd-go">Move and Send Email</button>
        <button type="button" class="btn btn--outline" id="cd-back" style="margin-left:8px;">Pick another</button>`;
      body.querySelector('#cd-back').addEventListener('click', pick);
      body.querySelector('#cd-go').addEventListener('click', async () => {
        const btn = body.querySelector('#cd-go');
        btn.disabled = true;
        const { error } = await client.from('visit_registrations').update({
          meeting_date: newDate, previous_meeting_date: registration.meeting_date, reminder_sent_at: null,
        }).eq('id', registration.id);
        if (error) {
          body.querySelector('#cd-error').textContent = setupMessage(error);
          btn.disabled = false;
          return;
        }
        logActivity(client, profile.id, 'visit_changed', registration.contact_id, label,
          `${fmtDate(registration.meeting_date)} to ${fmtDate(newDate)}`);
        body.innerHTML = `
          <p style="margin:0 0 8px;"><strong>Moved.</strong> ${esc(name)} is now set for ${esc(fmtDate(newDate))}.</p>
          <div id="cd-email" style="margin:0 0 16px;"></div>
          <button type="button" class="btn btn--primary" id="cd-done">Done</button>`;
        body.querySelector('#cd-done').addEventListener('click', closeModal);
        showEmailOutcome(body.querySelector('#cd-email'), client, registration.id, 'date_change', registration.email, opts.onChanged);
      });
    }

    pick();
  }

  // ---------- cancel ----------

  async function cancel(opts) {
    const { client, profile, registration, label } = opts;
    const name = [registration.first_name, registration.last_name].filter(Boolean).join(' ');
    if (!confirm(`Cancel ${name}'s visit on ${fmtDate(registration.meeting_date)}?\n\nThey will get an email saying we understand and asking if they would like to reschedule.`)) return;

    const { error } = await client.from('visit_registrations').update({ status: 'cancelled' }).eq('id', registration.id);
    if (error) { toast(setupMessage(error), 'error'); return; }
    await moveContact(client, registration.contact_id, 'interested', ['visit_scheduled']);
    logActivity(client, profile.id, 'visit_cancelled', registration.contact_id, label, fmtDate(registration.meeting_date));
    toast('Visit cancelled. Sending the email...');
    if (opts.onChanged) opts.onChanged();
    const result = await sendEmail(client, registration.id, 'cancellation');
    toast(result.ok ? `Cancelled, and ${name} was emailed.` : `Cancelled, but the email didn't send: ${result.error}`, result.ok ? 'ok' : 'error');
    if (opts.onChanged) opts.onChanged();
  }

  // ---------- attendance (admin Visitors tab) ----------

  async function setAttendance(opts) {
    const { client, registration, status } = opts;
    const name = [registration.first_name, registration.last_name].filter(Boolean).join(' ');
    const attended = status === 'attended';
    const question = attended
      ? `Mark ${name} as attended?\n\nA thank-you email will be sent to them.`
      : `Mark ${name} as a no-show?\n\nThey will be added to the caller's No-Show pool to follow up with.`;
    if (!confirm(question)) return;

    const { error } = await client.from('visit_registrations').update({ status }).eq('id', registration.id);
    if (error) { toast(setupMessage(error), 'error'); return; }
    if (attended) await moveContact(client, registration.contact_id, 'visit_attended', ['uncontacted', 'no_answer', 'interested', 'visit_scheduled']);
    else await moveContact(client, registration.contact_id, 'interested', ['visit_scheduled']);
    if (opts.onChanged) opts.onChanged();
    if (!attended) { toast(`${name} marked as a no-show.`); return; }

    toast('Marked attended. Sending the thank-you email...');
    const result = await sendEmail(client, registration.id, 'thank_you');
    toast(result.ok ? `${name} was thanked by email.` : `Marked attended, but the thank-you didn't send: ${result.error}`, result.ok ? 'ok' : 'error');
    if (opts.onChanged) opts.onChanged();
  }

  // ---------- resend ----------

  async function resend(opts) {
    toast('Sending...');
    const result = await sendEmail(opts.client, opts.registrationId, opts.kind);
    const label = KIND_LABELS[opts.kind] || opts.kind;
    toast(result.ok ? `${label} email sent.` : `${label} email didn't send: ${result.error}`, result.ok ? 'ok' : 'error');
    if (opts.onChanged) opts.onChanged();
  }

  // ---------- display helper for the Visitors tab ----------

  // Latest email of each kind for one registration, as small status chips,
  // with a Send again button on any whose latest attempt failed.
  function emailChipsHtml(emails, registrationId) {
    if (!emails || !emails.length) return '<span class="hint">No emails yet</span>';
    const latest = {};
    emails.slice().sort((a, b) => new Date(a.created_at) - new Date(b.created_at)).forEach((e) => { latest[e.kind] = e; });
    return Object.keys(latest).map((kind) => {
      const e = latest[kind];
      const label = KIND_LABELS[kind] || kind;
      const when = new Date(e.created_at).toLocaleString();
      if (e.status === 'sent') return `<span class="email-chip email-chip--ok" title="${esc(when)}">${esc(label)} sent</span>`;
      return `<span class="email-chip email-chip--fail" title="${esc(e.error || '')}">${esc(label)} failed</span>`
        + `<button type="button" class="link-btn visit-resend-btn" data-reg="${esc(registrationId)}" data-kind="${esc(kind)}">Send again</button>`;
    }).join(' ');
  }

  window.Visits = { register, changeDate, cancel, setAttendance, resend, fmtDate, esc, emailChipsHtml, toast, KIND_LABELS };
}());
