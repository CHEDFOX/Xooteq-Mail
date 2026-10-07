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
  dashboard/             Xooteq Mail: the inbox, companies, rules, AI replies
  engine.py              sets up and configures Stalwart (the mailboxes)
  workspace-setup.sh     installs or updates Stalwart and Xooteq Mail
  nginx-dashboard.conf   Xooteq Mail behind the VPS's nginx
```

Postal sends; [Xooteq Mail](#xooteq-mail-mailboxes-for-every-domain) receives,
keeps and answers. Together they replace Google Workspace and Zoho.

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

## Xooteq Mail: mailboxes for every domain

Everything Google Workspace or Zoho did for a domain, here: real mailboxes, an
inbox in the browser, addresses that each get their own folder (`support@`,
`contact@`, `billing@` …), rules, auto-replies, and replies written by AI in each
company's voice with any AI key. Mail apps (phone, Outlook, Apple Mail) work too.

Two parts, both started by `workspace-setup.sh`:

- **Stalwart** (open source mail server) holds the mailboxes. It owns port 25, so
  all mail for every domain arrives there; it hands Postal the bounces for
  Postal's return paths, and sends what you write through Postal's route.
- **The dashboard** (`dashboard/`) is the app at `https://mail.xooteq.online`:
  one company per domain, its inbox, and its settings.

Postal is unchanged: apps and Supabase keep sending on 587.

### Install, and every update

```bash
cd ~/xooteq-mail && git pull && sudo ./workspace-setup.sh
```

It makes the secrets it needs (in `.env`), moves port 25 from Postal to Stalwart,
starts Stalwart and configures it (`engine.py`), builds and starts the dashboard,
and the first time asks for **your login** (an email and a password, kept in the
dashboard's database). Run it again after every `git pull`; it keeps what is there.

Then, once:

1. **DNS** at xooteq.online: `A` `mail` → `91.108.104.168` (the dashboard's
   address). `smtp.mail` and `mx.mail` exist already (step 1).
2. **nginx + TLS** for the dashboard:
   ```bash
   sed "s/MAIL_DOMAIN/mail.xooteq.online/" ~/xooteq-mail/nginx-dashboard.conf \
     | sudo tee /etc/nginx/sites-available/xooteq-mail.conf >/dev/null
   sudo ln -sf /etc/nginx/sites-available/xooteq-mail.conf /etc/nginx/sites-enabled/
   sudo nginx -t && sudo systemctl reload nginx
   sudo certbot --nginx -d mail.xooteq.online
   ```
3. **hPanel firewall**: accept TCP **465** and **993** (mail apps). 25 is open
   already.
4. `./check.sh`: the Stalwart lines should all say ok.

Forgot the password: `cd /opt/postal && docker compose exec dashboard node --disable-warning=ExperimentalWarning server/cli.ts reset-password you@example.com`.

### Add a company (one per domain)

Settings → **Add a company**: its name, its domain, the main address (`hello@`)
and the others (`support@`, `contact@` …), each with the folder its mail is filed
in. Mail to any of them arrives in the one mailbox: in the Inbox *and* in that
address's folder, so support mail and contact-form mail never mix.

Then the company's **Domain & DNS** tab lists the records to add at the
domain's DNS (Hostinger → Domains → DNS): MX, SPF, DKIM and DMARC, each with a
copy button and a live check. Mail starts arriving once the MX is there.

**Moving from Google Workspace or Zoho**, without losing mail:

1. Add the company here. Add its SPF, DKIM and DMARC records (they do not move
   mail yet). While the domain's mail is still at Google, do not write from here
   to that domain's own addresses: this server now counts the domain as its own
   and keeps such mail locally.
2. Replace the domain's MX records with the one shown, and delete the old ones.
   New mail arrives here within the hour.
3. Copy the old mail across. In the company's **Mail apps** tab set an app
   password, then (Gmail needs an [app password](https://myaccount.google.com/apppasswords);
   Zoho: `imappro.zoho.com` for organisation accounts, else `imap.zoho.com`):
   ```bash
   docker run --rm gilleslamiral/imapsync imapsync \
     --host1 imap.gmail.com --ssl1 --user1 hello@tailzu.space --password1 'GOOGLE-APP-PASSWORD' \
     --host2 mx.mail.xooteq.online --ssl2 --user2 hello@tailzu.space --password2 'MAIL-APP-PASSWORD' \
     --automap --exclude '\[Gmail\]/All Mail'
   ```
   Run it again just before cancelling the old plan, to catch the last mail.
4. Cancel the old plan.

### AI replies

Settings → **AI providers** → *Add a provider*: Anthropic (Claude), OpenAI,
Google Gemini, OpenRouter, Groq, Mistral, DeepSeek, xAI, Together, your own
Ollama, or any OpenAI-compatible server. Paste the key, *Load models*, pick one,
*Save and test*. Keys are stored encrypted with `DASHBOARD_SECRET`; change
provider or key any time.

Each company's **AI replies** tab is its brief: what the company does, how
replies sound, the facts the AI may use (plans, prices, fixes, links), the rules
it must keep, and the sign-off. Then, per address under **Addresses**:

- **Off**: nobody answers but you.
- **Draft**: each new message gets a reply in Drafts, marked *AI reply to review*;
  open the conversation, *Review and send*.
- **Send**: the AI answers by itself after the wait set in the brief (2 minutes
  by default). Until then the conversation shows *AI reply sends in 1:52* with
  **Stop**, **Edit** and **Send now**. Anything about money, legal matters or a
  complaint, anything it is unsure of, and a sender's 4th message of the day
  become drafts instead. Newsletters, robots and no-reply senders are never
  answered.

Settings → **AI activity** lists every message the AI looked at, what it did and
why. Plain **auto-replies** (an out-of-office, "we got your message") are set per
address too, and need no AI.

### Rules

A company's **Rules** tab: when mail matches (sender, recipient, subject, text,
a header, an attachment name), move it, also file it in a folder, mark it read,
star it, forward a copy, or delete it. The mail server runs them as mail arrives,
before auto-replies and AI.

### Using it

Press `?` in the app for every shortcut. The ones worth learning: `C` write,
`/` search, `⌘K` / `Ctrl K` go anywhere, `J`/`K` move, `E` archive, `#` delete,
`R` reply, `⌘↵` send (with five seconds to undo), `⌘1`…`⌘9` switch company.

Mail apps: the company's **Mail apps** tab has the settings (IMAP
`mx.mail.xooteq.online:993`, SMTP `smtp.mail.xooteq.online:465`, both SSL/TLS;
the username is the main address) and sets the app password.

### Backups

The mail is in the `stalwart_data` volume and the dashboard's settings in
`dashboard_data` (`docker volume ls`). Back both up with the rest of `/opt/postal`.

### Development

```bash
cd dashboard && npm install
npm run dev          # the server, on :5200 (needs a Stalwart; see .env names in server/config.ts)
npm run dev:web      # the web app with hot reload, on :5173
npm test             # unit tests
npm run typecheck
XM_EMAIL=… XM_PASSWORD=… python3 test/e2e.py   # end to end against a local Stalwart
```

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
