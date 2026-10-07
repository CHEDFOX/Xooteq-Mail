# Xooteq Mail — Postal on the VPS

Every app sends through this: Tailzu's sign-in codes (Supabase → SMTP → here),
and anything else that needs an email out. It is [Postal](https://postalserver.io),
open source and self-hosted: each app is a *mail server* in Postal with its own
SMTP login and API key, each domain an app sends from gets its own DKIM key, every
email is logged with its delivery status, bounces and complaints come back here
and go onto a suppression list. No per-email cost and no monthly cap; the limits
are the receivers' (Gmail, Outlook), which is what the DNS and warm-up below are
about.

One domain hosts the platform (the **platform domain**, `MAIL_DOMAIN` in `.env`,
e.g. `mail.xooteq.online`). Apps keep sending from their own domains
(`hello@tailzu.space`); the platform domain only appears in the plumbing
(return-path, DKIM identifier, the dashboard's address).

Everything lives in `/opt/postal` on the server; this repo holds the config and
the scripts that put it there. Its checkout on the VPS is `~/xooteq-mail`.

```
xooteq-mail/
  forms/                 the contact-form service (see Forms, below)
  docker-compose.yml     Postal (web, smtp, worker) + MariaDB + forms
  postal.yml.template    Postal's config; setup.sh fills it from .env
  mariadb-init.sql       the grant Postal needs for its per-server databases
  setup.sh               first run: keys, config, database, admin user, DKIM record
  check.sh               proves DNS, PTR, ports and TLS before and after
  test.py                sends real mails every way the apps do and reports the receiver's answer
  nginx-postal.conf      the dashboard behind the VPS's existing nginx
  certbot-hook.sh        hands renewed certificates to the SMTP server
  .env.example           the few values to fill in
```

## 0. Before anything: Hostinger

Two things only Hostinger can do, and both take a day, so start them first.

1. **Outbound port 25.** Hostinger closes it on every VPS. Open a support chat
   from hPanel and ask: *"Please open outbound port 25 on VPS <IP>. It will send
   transactional email (sign-in codes) from our own mail server with SPF, DKIM,
   DMARC and a PTR record configured."* Until it is open the server can receive
   but not deliver. `check.sh` shows when it is.
2. **PTR (reverse DNS).** hPanel → VPS → Settings → *PTR record*: set it to
   `smtp.<MAIL_DOMAIN>`. Gmail refuses mail from an IP whose reverse name does
   not resolve back to it.

Also in hPanel → VPS → **Firewall**: allow inbound TCP **25** and **587**
(and 80/443 are already open for nginx).

## 1. DNS for the platform domain

With `MAIL_DOMAIN=mail.xooteq.online` and the VPS at `91.108.104.168`, add at the
DNS host of `xooteq.online`:

| Type | Name | Value |
|---|---|---|
| A | `postal.mail` | `91.108.104.168` — the dashboard |
| A | `smtp.mail` | `91.108.104.168` — what apps and Supabase connect to |
| A | `mx.mail` | `91.108.104.168` — receives bounces |
| MX | `rp.mail` | `10 mx.mail.xooteq.online` |
| TXT | `rp.mail` | `v=spf1 a mx include:spf.mail.xooteq.online ~all` |
| TXT | `spf.mail` | `v=spf1 ip4:91.108.104.168 ~all` |
| TXT | `postal._domainkey.mail` | *printed by setup.sh, step 3* |
| CNAME | `track.mail` | `postal.mail.xooteq.online` (optional, click tracking) |
| TXT | `_dmarc.mail` | `v=DMARC1; p=quarantine; rua=mailto:dmarc@xooteq.online` |

(`mail` is the subdomain label; most panels want the name without the domain.
If the panel wants the full name, it is `postal.mail.xooteq.online` and so on.)

## 2. Install

On the VPS:

```bash
git clone https://github.com/CHEDFOX/xooteq-mail ~/xooteq-mail
cd ~/xooteq-mail
cp .env.example .env && nano .env        # MAIL_DOMAIN, VPS_IP, passwords, admin email
./check.sh dns                            # the records above resolve
sudo ./setup.sh                           # keys, config, database, images, admin user
```

`setup.sh` is safe to run again; it only creates what is missing. At the end it
prints the DKIM TXT record for `postal._domainkey.<MAIL_DOMAIN>`: add it, then
`./check.sh dns` again until it shows.

## 3. The dashboard and TLS

The dashboard runs on `127.0.0.1:5000`; the VPS's nginx fronts it, with a
certificate from certbot that is also handed to the SMTP server (STARTTLS on
587 needs one).

```bash
sudo cp nginx-postal.conf /etc/nginx/sites-available/postal.conf
sudo sed -i "s/MAIL_DOMAIN/$(grep ^MAIL_DOMAIN .env | cut -d= -f2)/g" /etc/nginx/sites-available/postal.conf
sudo ln -sf /etc/nginx/sites-available/postal.conf /etc/nginx/sites-enabled/postal.conf
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d postal.$MAIL_DOMAIN -d smtp.$MAIL_DOMAIN -d mx.$MAIL_DOMAIN \
  --deploy-hook /opt/postal/certbot-hook.sh
sudo /opt/postal/certbot-hook.sh          # first hand-over; renewals call it themselves
```

Open `https://postal.<MAIL_DOMAIN>` and sign in with the admin user from setup.

## 4. The first app: Tailzu

In the dashboard:

1. **Organization** → *Create*: `XOOTEQ LAB` (one for everything you own).
2. **Mail server** → *Create*: `Tailzu`, mode *Live*. One per app.
3. **Domains** → *Add*: `tailzu.space` (check the spelling: Postal verifies
   exactly the name typed, and a typo fails every check for good). Postal shows
   the records to add at tailzu.space's DNS: SPF (`v=spf1 a mx include:spf.<MAIL_DOMAIN> ~all`
   at `@`, merged into an existing SPF if there is one), a DKIM TXT
   (`postal-xxxx._domainkey`) and the return path CNAME (`psrp → rp.<MAIL_DOMAIN>`).
   The MX is only for receiving (see Receiving). Add them, wait ten minutes,
   click *Check my records are correct*, all green.
   Add `_dmarc.tailzu.space` TXT `v=DMARC1; p=quarantine; rua=mailto:you@gmail.com`.
4. **Credentials** → *Add*: type **SMTP**, name `supabase`. Postal shows one
   **key**: that is the password. The username is the organization and the
   server as they appear in the dashboard's address bar: on
   `…/org/xooteq/servers/tailzu/…` it is `xooteq/tailzu`. Supabase logs
   in with CRAM-MD5, which never sends the key itself, so Postal needs the
   username to know which server's keys to check; with any other username it
   answers `535 Denied`. Add a second credential of type **API**, name `forms`,
   for the forms service and for `test.py`.

Then in Supabase → Project Settings → Authentication → **SMTP Settings**:

| Field | Value |
|---|---|
| Sender email | `hello@tailzu.space` |
| Sender name | `Tailzu` |
| Host | `smtp.<MAIL_DOMAIN>` |
| Port | `587` |
| Username | organization/server from the dashboard's address, e.g. `xooteq/tailzu` |
| Password | the SMTP credential's key |

Save, request a code from the app, and watch it appear under the Tailzu server's
**Messages** in the dashboard with its delivery status. Supabase's own limit on
sign-in mails is under Authentication → Rate Limits (30 an hour by default).

### Prove it

`test.py` sends real mails to an inbox every way the apps do, waits for the
receiver's answer through Postal, and prints it. Run it bare and it asks for
each value (pasted keys are not echoed; Enter skips an optional one):

```bash
./test.py
```

or give them as flags, for a script:

```bash
./test.py --api API_KEY --from hello@tailzu.space --to you@gmail.com \
  --smtp SMTP_KEY --smtp-user xooteq/tailzu \
  --forms tz_8f3a1c2e9b7d4a6f --origin https://tailzu.space \
  --supabase https://REF.supabase.co --anon ANON_KEY
```

The API key is the only required one (the script reads statuses back with it).
Each further value adds a path: `--smtp` with `--smtp-user` logs in exactly as
Supabase does (STARTTLS on 587, CRAM-MD5, organization/server and the key), `--forms` posts a contact-form
submission, `--supabase` asks Supabase for a sign-in code for `--to`, as a first
sign-in from the app does, and watches it come through. Every line says *ok* with
the receiver's acceptance (`250 2.0.0 OK ... gsmtp`) or *FAIL* with what went
wrong and where to look. Then open one of the mails in the inbox → *Show
original*: SPF, DKIM and DMARC should all say PASS.

Another app is steps 2–4 again with its own name, domain and credentials. An
app that sends from code uses an **API** credential instead and
`POST https://postal.<MAIL_DOMAIN>/api/v1/send/message` with the
`X-Server-API-Key` header (JSON: `to`, `from`, `subject`, `html_body`).

## 5. Warm-up

A new IP has no history. For the first two weeks keep it to real sign-in codes
and a few test mails a day; do not send a campaign. Watch
`https://postal.<MAIL_DOMAIN>` → the server → **Messages** for *Bounced* and
*Held*, and Google Postmaster Tools (add tailzu.space there; it shows how Gmail
rates the domain and IP). Spam complaints above 0.3% or bounces above 5% get an
IP throttled, and the suppression list in Postal stops repeat sends to dead
addresses automatically.

## Forms: contact forms without Web3Forms

A site's contact form posts to this platform, and the message lands in an inbox,
sent through Postal from the site's own domain, with Reply-To set to the visitor
so answering is one click. Every submission is also kept on the server.

**Once:** an `A` record `forms` → `91.108.104.168` at xooteq.online, then nginx
and certbot for it:

```bash
sudo cp ~/xooteq-mail/nginx-forms.conf /etc/nginx/sites-available/forms.conf
sudo sed -i "s/FORMS_DOMAIN/xooteq.online/g" /etc/nginx/sites-available/forms.conf
sudo ln -sf /etc/nginx/sites-available/forms.conf /etc/nginx/sites-enabled/forms.conf
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d forms.xooteq.online
```

**Per site:** an entry in `/opt/postal/forms/sites.json` (the example is in
`forms/sites.example.json`):

| Field | Meaning |
|---|---|
| `key` | The public id in the form's URL. Any 8–64 letters, digits, `_`, `-`. |
| `to` | Where submissions go. Any inbox, Gmail included. |
| `from` | The sender, on a domain verified in that app's Postal mail server. |
| `postal_key` | An **API** credential of that mail server (dashboard → Credentials). |
| `origins` | Sites allowed to post. `*.example.com` matches every subdomain. Empty allows all. |
| `redirect` | Where a plain form post lands afterwards. Without it, a small "sent" page. |
| `subject` | May use `{field}`: `Message from {name}`. |
| `autoreply` | Optional `subject` and `text` sent to the visitor's `email`. |
| `admin_token` | For `/s/<key>/recent?token=…`, the last submissions as JSON. |
| `limits` | `perMinute` per visitor and `perDay` per site; above them the service answers 429. |

The service re-reads the file when it changes; no restart.

**In the site**, a plain form:

```html
<form action="https://forms.xooteq.online/s/tz_8f3a1c2e9b7d4a6f" method="post">
  <input name="name" placeholder="Your name" required>
  <input name="email" type="email" placeholder="Your email" required>
  <textarea name="message" required></textarea>
  <input type="checkbox" name="botcheck" style="display:none" tabindex="-1" autocomplete="off">
  <input type="hidden" name="_redirect" value="https://tailzu.space/thanks">
  <button>Send</button>
</form>
```

or from a script, which gets JSON back and can stay on the page:

```js
const r = await fetch("https://forms.xooteq.online/s/tz_8f3a1c2e9b7d4a6f", {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ name, email, message }),
});
const { ok, error } = await r.json();
```

Any field is sent along, with its name as the label. Special names: `email`
(becomes Reply-To and gets the auto-reply), `_subject`, `_redirect`, `_cc`;
`botcheck`, `_honey` or `_gotcha` is the honeypot (a bot that fills it is
thanked and ignored). Files are not accepted. A form moved over from Web3Forms
keeps working: only the `action` URL changes and the `access_key` field is
ignored.

## Receiving: mail sent *to* your domains

Postal also receives. To get replies and anything sent to `hello@tailzu.space`:

1. At tailzu.space's DNS: `MX` `@` → `10 mx.mail.xooteq.online`. (Only if the
   domain has no other mail; an MX moves *all* its incoming mail here.)
2. Dashboard → the Tailzu mail server → **Routes** → *Add*: address `hello`
   at `tailzu.space`, then what to do with it: **Forward to an address**
   (`madefox6666@gmail.com`) is the usual one; a **webhook** (an HTTP endpoint
   that gets the parsed message as JSON) is for an app that wants to react.
   `*` as the address catches everything on the domain.

There is no mailbox to log into: mail that arrives is forwarded or handed to a
webhook, and kept in Postal's log for a while. For a real inbox under a domain,
use a mailbox provider for that domain and keep Postal for sending.

## When a code does not arrive

0. `./test.py --api … --smtp … --supabase … --anon …` (above) says which of the
   three legs fails: Postal itself, the SMTP login, or Supabase's settings.
1. Dashboard → Tailzu → Messages: is it there? **Not there**: Supabase could not
   connect. Check the credential and that `./check.sh` shows 587 open.
   **Held**: Postal found a problem with the message (spam score, a domain not
   verified). **Bounced**: the receiver refused; the bounce text says why.
   **Delivered**: the receiver accepted it; look in Spam.
2. `./check.sh` from the VPS: DNS, PTR, port 25 out, TLS.
3. `docker compose -f /opt/postal/docker-compose.yml logs --tail 100 smtp worker`.
