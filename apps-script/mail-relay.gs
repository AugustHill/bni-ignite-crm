// BNI Ignite mail relay. Paste this into a Google Apps Script project created
// while signed in as the BNI Ignite Gmail account, then deploy it as a web app
// ("Execute as: Me", "Who has access: Anyone"). The CRM's Netlify functions
// POST each visitor email here, and Gmail sends it from that account.
//
// Setup (full steps in the repo README, "Visitor emails"):
//   1. Project Settings -> Script properties -> add RELAY_SECRET = a long
//      random string. The same value goes in Netlify as MAIL_RELAY_SECRET.
//   2. Deploy -> New deployment -> Web app. Copy the /exec URL, it goes in
//      Netlify as MAIL_RELAY_URL.
//
// Anything that doesn't carry the right secret is refused, so knowing the
// web app's URL isn't enough to send mail through it.

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    var secret = PropertiesService.getScriptProperties().getProperty('RELAY_SECRET');
    if (!secret || body.secret !== secret) {
      return reply_({ ok: false, error: 'unauthorized' });
    }
    if (!body.to || !body.subject) {
      return reply_({ ok: false, error: 'missing to or subject' });
    }

    var options = {
      name: body.name || 'BNI Ignite',
      htmlBody: body.html || ''
    };
    if (body.bcc) options.bcc = body.bcc;
    if (body.replyTo) options.replyTo = body.replyTo;
    if (body.ics && body.ics.content) {
      options.attachments = [
        Utilities.newBlob(body.ics.content, 'text/calendar', body.ics.filename || 'invite.ics')
      ];
    }

    MailApp.sendEmail(body.to, body.subject, body.text || '', options);
    return reply_({ ok: true });
  } catch (err) {
    return reply_({ ok: false, error: String(err) });
  }
}

function reply_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
