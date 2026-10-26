// Shared by the send-visit-email and visit-reminders Netlify functions:
// the five visitor emails (welcome, date change, cancellation, day-before
// reminder, thank-you), the calendar link/attachment, and the hand-off to
// the Gmail relay (see apps-script/mail-relay.gs and the README's "Visitor
// emails" setup). Everything about the meeting that's fixed lives in
// MEETING below, in one place, on purpose.

const MEETING = {
  tz: 'America/New_York',
  startHour: 7,
  startMinute: 30,
  endHour: 9,
  endMinute: 0,
  timeLabel: '7:30 AM',
  endLabel: '9:00 AM',
  arriveLabel: '7:15 AM',
  address: 'Keller Williams Realty, 30522 US Highway 19 North, Suite 107, Palm Harbor, Florida 34684',
  textNumber: '440-752-9616',
  fromName: 'BNI Ignite',
  replyTo: 'derrick.mckenzie@kw.com',
  bcc: 'derrick.mckenzie@kw.com',
};

// Which registration status each email makes sense for. The function
// refuses (rather than sends) anything else, so, for example, a thank-you
// can't go to someone marked a no-show.
const KIND_REQUIRES_STATUS = {
  welcome: 'registered',
  date_change: 'registered',
  reminder: 'registered',
  cancellation: 'cancelled',
  thank_you: 'attended',
};

// ---------- dates ----------

function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function parseISODate(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  return { y, m, d };
}

// "2026-11-04" -> "Wednesday, November 4, 2026"
function fmtLong(iso) {
  const { y, m, d } = parseISODate(iso);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  });
}

// "2026-11-04" -> "Wednesday, November 4"
function fmtShort(iso) {
  const { y, m, d } = parseISODate(iso);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC',
  });
}

function addDaysISO(iso, days) {
  const { y, m, d } = parseISODate(iso);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}

// Today's calendar date in Eastern time, as YYYY-MM-DD.
function todayET(now) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: MEETING.tz }).format(now || new Date());
}

function tzOffsetMinutes(utcMs, tz) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(utcMs));
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return Math.round((asUtc - utcMs) / 60000);
}

// A wall-clock time in Eastern (handles daylight saving) -> a real UTC
// instant, in milliseconds.
function etToUtcMs(iso, hour, minute) {
  const { y, m, d } = parseISODate(iso);
  const wanted = Date.UTC(y, m - 1, d, hour, minute);
  let guess = wanted;
  for (let i = 0; i < 2; i++) guess = wanted - tzOffsetMinutes(guess, MEETING.tz) * 60000;
  return guess;
}

function icsStamp(ms) {
  return new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function localStamp(iso, hour, minute) {
  const { y, m, d } = parseISODate(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${y}${p(m)}${p(d)}T${p(hour)}${p(minute)}00`;
}

// ---------- calendar ----------

const CAL_TITLE = 'BNI Ignite Weekly Meeting (Guest)';
const CAL_DETAILS = `BNI Ignite weekly chapter meeting. Please arrive around ${MEETING.arriveLabel}. Parking is free and plentiful. Business casual. Bring business cards. Running late or have a question? Text ${MEETING.textNumber}.`;

function googleCalendarUrl(iso) {
  const dates = `${localStamp(iso, MEETING.startHour, MEETING.startMinute)}/${localStamp(iso, MEETING.endHour, MEETING.endMinute)}`;
  return 'https://calendar.google.com/calendar/render?action=TEMPLATE'
    + `&text=${encodeURIComponent(CAL_TITLE)}`
    + `&dates=${dates}`
    + `&ctz=${encodeURIComponent(MEETING.tz)}`
    + `&details=${encodeURIComponent(CAL_DETAILS)}`
    + `&location=${encodeURIComponent(MEETING.address)}`;
}

function icsEscape(text) {
  return String(text).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

// Fold to 75 characters per RFC 5545, continuation lines start with a space.
function icsFold(line) {
  const out = [];
  let rest = line;
  while (rest.length > 75) {
    out.push(rest.slice(0, 75));
    rest = ` ${rest.slice(75)}`;
  }
  out.push(rest);
  return out.join('\r\n');
}

function buildIcs(reg, nowMs) {
  const now = nowMs || Date.now();
  const start = etToUtcMs(reg.meeting_date, MEETING.startHour, MEETING.startMinute);
  const end = etToUtcMs(reg.meeting_date, MEETING.endHour, MEETING.endMinute);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//BNI Ignite//Visitor Registration//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:visit-${reg.id}@bniignite`,
    `DTSTAMP:${icsStamp(now)}`,
    // Minutes since the epoch: always increasing, so a re-sent invite for a
    // moved date replaces the earlier event in calendars that honor UIDs.
    `SEQUENCE:${Math.floor(now / 60000)}`,
    `DTSTART:${icsStamp(start)}`,
    `DTEND:${icsStamp(end)}`,
    `SUMMARY:${icsEscape(CAL_TITLE)}`,
    `LOCATION:${icsEscape(MEETING.address)}`,
    `DESCRIPTION:${icsEscape(CAL_DETAILS)}`,
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    'DESCRIPTION:BNI Ignite meeting starts at 7:30 AM',
    'TRIGGER:-PT1H',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return { filename: 'BNI-Ignite-Visit.ics', content: `${lines.map(icsFold).join('\r\n')}\r\n` };
}

// ---------- email building blocks ----------

const BRAND = '#1B6B4A';

function layout(preheader, inner) {
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f5f6f4;font-family:Arial,Helvetica,sans-serif;">
<span style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f6f4;padding:24px 0;"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:10px;overflow:hidden;border:1px solid #dde1db;">
<tr><td style="background:${BRAND};padding:20px 28px;color:#ffffff;font-size:20px;font-weight:bold;">BNI Ignite</td></tr>
<tr><td style="padding:28px;">${inner}</td></tr>
<tr><td style="padding:16px 28px;background:#eef0ec;color:#656b62;font-size:12px;line-height:1.5;">BNI Ignite weekly chapter meeting | Wednesdays at ${MEETING.timeLabel} | ${esc(MEETING.address)}</td></tr>
</table></td></tr></table></body></html>`;
}

const P = (html) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:#1a1d1a;">${html}</p>`;
const H = (text) => `<h2 style="margin:22px 0 8px;font-size:17px;color:${BRAND};">${esc(text)}</h2>`;

function detailsTableHtml(reg) {
  const rows = [
    ['Date', fmtLong(reg.meeting_date)],
    ['Time', `${MEETING.timeLabel} to ${MEETING.endLabel} (please arrive around ${MEETING.arriveLabel})`],
    ['Where', MEETING.address],
    ['Parking', 'Free and plentiful'],
    ['Dress', 'Business casual'],
    ['Cost', 'Free to visit'],
    ['Bring', 'Business cards'],
  ];
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:0 0 16px;border:1px solid #dde1db;border-radius:8px;">${rows.map(([k, v]) => `<tr><td style="padding:9px 12px;font-size:14px;font-weight:bold;color:#656b62;width:90px;vertical-align:top;border-bottom:1px solid #eef0ec;">${esc(k)}</td><td style="padding:9px 12px;font-size:14px;color:#1a1d1a;border-bottom:1px solid #eef0ec;">${esc(v)}</td></tr>`).join('')}</table>`;
}

function detailsText(reg) {
  return [
    `Date: ${fmtLong(reg.meeting_date)}`,
    `Time: ${MEETING.timeLabel} to ${MEETING.endLabel} (please arrive around ${MEETING.arriveLabel})`,
    `Where: ${MEETING.address}`,
    'Parking: Free and plentiful',
    'Dress: Business casual',
    'Cost: Free to visit',
    'Bring: Business cards',
  ].join('\n');
}

function calendarBlockHtml(reg) {
  return `<p style="margin:0 0 8px;"><a href="${esc(googleCalendarUrl(reg.meeting_date))}" style="display:inline-block;background:${BRAND};color:#ffffff;text-decoration:none;font-weight:bold;font-size:15px;padding:11px 20px;border-radius:6px;">Add to Google Calendar</a></p>`
    + '<p style="margin:0 0 14px;font-size:13px;line-height:1.5;color:#656b62;">Use Apple Calendar or Outlook instead? Open the calendar file (.ics) attached to this email.</p>';
}

function calendarBlockText(reg) {
  return `Add to Google Calendar: ${googleCalendarUrl(reg.meeting_date)}\n(Apple Calendar or Outlook: open the attached .ics file.)`;
}

const questionsHtml = () => P(`Running late or have a question? Text <strong>${MEETING.textNumber}</strong>.`);
const questionsText = () => `Running late or have a question? Text ${MEETING.textNumber}.`;

function signatureHtml(reg) {
  return P(`Warm regards,<br>${esc(reg.registered_by_name || 'The BNI Ignite Team')}<br>BNI Ignite`);
}
function signatureText(reg) {
  return `Warm regards,\n${reg.registered_by_name || 'The BNI Ignite Team'}\nBNI Ignite`;
}

const ABOUT_BNI = "BNI (Business Network International) is the world's largest business networking and referral organization. Each chapter brings together local business owners and professionals, with one member per profession, who meet every week to pass qualified business referrals to one another. The guiding philosophy is Givers Gain: the more you help others succeed, the more success comes back to you.";

const HOW_IT_WORKS = [
  `The meeting runs from ${MEETING.timeLabel} to ${MEETING.endLabel}, and we start promptly. Arrive around ${MEETING.arriveLabel} so you have time to meet members before we begin.`,
  'You will be welcomed as a guest and given a moment to briefly introduce yourself and your business.',
  'Members each give a short presentation about their business and the kinds of referrals they are looking for, and one member gives a longer featured presentation.',
  'The group then passes referrals and thank-yous. There is no pressure to join, this is a chance to see how the chapter works and meet the people in it.',
];

function firstName(reg) {
  return reg.first_name || 'there';
}

// ---------- the five emails ----------

// Returns { subject, html, text, ics?, bcc } where bcc says whether Derrick
// is blind-copied. Reminders don't BCC him (one per visitor would flood his
// inbox); everything else does.
function buildEmail(kind, reg, nowMs) {
  const name = esc(firstName(reg));

  if (kind === 'welcome') {
    const subject = `You're Registered to Visit BNI Ignite on ${fmtShort(reg.meeting_date)}`;
    const html = layout(`Your visit is set for ${fmtShort(reg.meeting_date)} at ${MEETING.timeLabel}.`,
      P(`Hi ${name},`)
      + P('Thank you for agreeing to visit BNI Ignite! We are excited to have you join us as our guest.')
      + H('Your visit')
      + detailsTableHtml(reg)
      + calendarBlockHtml(reg)
      + questionsHtml()
      + H('What is BNI?')
      + P(esc(ABOUT_BNI))
      + H('How the meeting works')
      + `<ul style="margin:0 0 14px;padding-left:20px;font-size:15px;line-height:1.55;color:#1a1d1a;">${HOW_IT_WORKS.map((s) => `<li style="margin-bottom:6px;">${esc(s)}</li>`).join('')}</ul>`
      + P('Please bring plenty of business cards, as we are eager to network with you.')
      + P('We look forward to meeting you!')
      + signatureHtml(reg));
    const text = [
      `Hi ${firstName(reg)},`, '',
      'Thank you for agreeing to visit BNI Ignite! We are excited to have you join us as our guest.', '',
      'YOUR VISIT', detailsText(reg), '',
      calendarBlockText(reg), '',
      questionsText(), '',
      'WHAT IS BNI?', ABOUT_BNI, '',
      'HOW THE MEETING WORKS', ...HOW_IT_WORKS.map((s) => `- ${s}`), '',
      'Please bring plenty of business cards, as we are eager to network with you.', '',
      'We look forward to meeting you!', '',
      signatureText(reg),
    ].join('\n');
    return { subject, html, text, ics: buildIcs(reg, nowMs), bcc: true };
  }

  if (kind === 'date_change') {
    const was = reg.previous_meeting_date ? fmtLong(reg.previous_meeting_date) : null;
    const subject = `Your BNI Ignite Visit Has Moved to ${fmtShort(reg.meeting_date)}`;
    const html = layout(`Your visit is now ${fmtShort(reg.meeting_date)} at ${MEETING.timeLabel}.`,
      P(`Hi ${name},`)
      + P(`Your visit to BNI Ignite has been moved${was ? ` from ${esc(was)}` : ''} to <strong>${esc(fmtLong(reg.meeting_date))}</strong>. Everything else stays the same.`)
      + detailsTableHtml(reg)
      + calendarBlockHtml(reg)
      + P('If you added the earlier date to your calendar, please remove it.')
      + questionsHtml()
      + P('We look forward to meeting you!')
      + signatureHtml(reg));
    const text = [
      `Hi ${firstName(reg)},`, '',
      `Your visit to BNI Ignite has been moved${was ? ` from ${was}` : ''} to ${fmtLong(reg.meeting_date)}. Everything else stays the same.`, '',
      detailsText(reg), '',
      calendarBlockText(reg), '',
      'If you added the earlier date to your calendar, please remove it.', '',
      questionsText(), '',
      'We look forward to meeting you!', '',
      signatureText(reg),
    ].join('\n');
    return { subject, html, text, ics: buildIcs(reg, nowMs), bcc: true };
  }

  if (kind === 'cancellation') {
    const subject = 'Your BNI Ignite Visit Has Been Cancelled';
    const html = layout('We understand. Would you like to reschedule?',
      P(`Hi ${name},`)
      + P(`We understand that plans change. Your visit to BNI Ignite on <strong>${esc(fmtLong(reg.meeting_date))}</strong> has been cancelled.`)
      + P('We would still love to meet you. <strong>Would you like to reschedule?</strong> We meet every Wednesday at '
        + `${MEETING.timeLabel}. Just reply to this email or text <strong>${MEETING.textNumber}</strong> with the Wednesday that works best for you, and we will get you set up with the new date.`)
      + signatureHtml(reg));
    const text = [
      `Hi ${firstName(reg)},`, '',
      `We understand that plans change. Your visit to BNI Ignite on ${fmtLong(reg.meeting_date)} has been cancelled.`, '',
      `We would still love to meet you. Would you like to reschedule? We meet every Wednesday at ${MEETING.timeLabel}. Just reply to this email or text ${MEETING.textNumber} with the Wednesday that works best for you, and we will get you set up with the new date.`, '',
      signatureText(reg),
    ].join('\n');
    return { subject, html, text, bcc: true };
  }

  if (kind === 'reminder') {
    const subject = `Reminder: Your BNI Ignite Visit Is Tomorrow at ${MEETING.timeLabel}`;
    const html = layout(`See you tomorrow at ${MEETING.timeLabel}.`,
      P(`Hi ${name},`)
      + P('A friendly reminder that your visit to BNI Ignite is <strong>tomorrow</strong>. We are looking forward to meeting you!')
      + detailsTableHtml(reg)
      + calendarBlockHtml(reg)
      + P('Please bring plenty of business cards, as we are eager to network with you.')
      + questionsHtml()
      + signatureHtml(reg));
    const text = [
      `Hi ${firstName(reg)},`, '',
      'A friendly reminder that your visit to BNI Ignite is tomorrow. We are looking forward to meeting you!', '',
      detailsText(reg), '',
      calendarBlockText(reg), '',
      'Please bring plenty of business cards, as we are eager to network with you.', '',
      questionsText(), '',
      signatureText(reg),
    ].join('\n');
    return { subject, html, text, ics: buildIcs(reg, nowMs), bcc: false };
  }

  if (kind === 'thank_you') {
    const subject = 'Thank You for Visiting BNI Ignite';
    const html = layout('Thank you for joining us.',
      P(`Hi ${name},`)
      + P(`Thank you for visiting BNI Ignite on ${esc(fmtLong(reg.meeting_date))}. It was a pleasure having you, and we hope you enjoyed seeing how our chapter works and meeting our members.`)
      + P('If you would like to learn more about membership, or find out whether your profession is open in our chapter (each chapter has one member per profession), '
        + `just reply to this email or text <strong>${MEETING.textNumber}</strong>. We would be glad to talk through next steps with you.`)
      + P('Thanks again for spending your morning with us!')
      + signatureHtml(reg));
    const text = [
      `Hi ${firstName(reg)},`, '',
      `Thank you for visiting BNI Ignite on ${fmtLong(reg.meeting_date)}. It was a pleasure having you, and we hope you enjoyed seeing how our chapter works and meeting our members.`, '',
      `If you would like to learn more about membership, or find out whether your profession is open in our chapter (each chapter has one member per profession), just reply to this email or text ${MEETING.textNumber}. We would be glad to talk through next steps with you.`, '',
      'Thanks again for spending your morning with us!', '',
      signatureText(reg),
    ].join('\n');
    return { subject, html, text, bcc: true };
  }

  throw new Error(`Unknown email kind: ${kind}`);
}

// ---------- sending ----------

// Hands one message to the Gmail relay (a small Google Apps Script web app
// running as the BNI Ignite Gmail account). Always resolves to
// { ok, error? } rather than throwing, so a failure gets logged and shown,
// not surfaced as a crash.
async function sendViaRelay(message, options) {
  const { MAIL_RELAY_URL, MAIL_RELAY_SECRET } = process.env;
  if (!MAIL_RELAY_URL || !MAIL_RELAY_SECRET) {
    return { ok: false, error: "Email sending isn't set up yet (the MAIL_RELAY_URL and MAIL_RELAY_SECRET settings are missing)." };
  }
  const timeoutMs = (options && options.timeoutMs) || 9000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(MAIL_RELAY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ secret: MAIL_RELAY_SECRET, ...message }),
      redirect: 'follow',
      signal: controller.signal,
    });
    const text = await response.text();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      return { ok: false, error: `The email relay didn't answer as expected (HTTP ${response.status}). Check its web app deployment is set to "Anyone".` };
    }
    if (!parsed.ok) return { ok: false, error: `The email relay said: ${String(parsed.error || 'unknown error').slice(0, 200)}` };
    return { ok: true };
  } catch (err) {
    if (err.name === 'AbortError') {
      return { ok: false, error: 'The email relay timed out. It may still have been delivered, so check before sending again.' };
    }
    return { ok: false, error: `Couldn't reach the email relay: ${err.message}` };
  } finally {
    clearTimeout(timer);
  }
}

// ---------- Supabase (service role) ----------

async function sb(path, options) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const opts = options || {};
  const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch (err) { body = text; }
  return { ok: response.ok, status: response.status, body };
}

// Builds, sends, and logs one email for a registration. Returns { ok, error? }.
async function deliver(reg, kind, options) {
  const opts = options || {};
  const email = buildEmail(kind, reg);
  const message = {
    to: reg.email,
    name: MEETING.fromName,
    replyTo: MEETING.replyTo,
    subject: email.subject,
    html: email.html,
    text: email.text,
  };
  if (email.bcc) message.bcc = MEETING.bcc;
  if (email.ics) message.ics = email.ics;

  const result = await sendViaRelay(message, { timeoutMs: opts.timeoutMs });
  await sb('visit_emails', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      registration_id: reg.id,
      kind,
      to_email: reg.email,
      status: result.ok ? 'sent' : 'failed',
      error: result.ok ? null : result.error,
      sent_by: opts.sentBy || null,
    }),
  });
  return result;
}

module.exports = {
  MEETING, KIND_REQUIRES_STATUS,
  esc, fmtLong, fmtShort, addDaysISO, todayET, etToUtcMs, icsStamp,
  googleCalendarUrl, buildIcs, buildEmail, sendViaRelay, sb, deliver,
};
