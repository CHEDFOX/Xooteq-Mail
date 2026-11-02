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
  dashboard/             Xooteq Mail: the inbox, companies, forms, rules, AI replies, sending
  postal-bridge/         lets the dashboard run Postal (apps, keys, domains, message log)
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

**Per form, in Xooteq Mail** (the usual way: Settings → the company → **Forms**
→ *Connect a form*). See *Forms: any site's form on any address*, below. The
dashboard writes `/opt/postal/forms/config/sites.json` from what you fill in,
and the service re-reads it at once; it also adds the company's domain to a
sending app in Postal and makes the API key the form sends with.

**Per site, by hand** — for a form that is not one of the dashboard's companies:
another entry in `/opt/postal/forms/config/sites.json` (the example is in
`forms/sites.example.json`). The dashboard keeps entries it did not make; those
it did carry `"managed_by": "xooteq-mail"` and are rewritten from its database.

| Field | Meaning |
|---|---|
| `key` | The public id in the form's URL. Any 8–64 letters, digits, `_`, `-`. |
| `to` | Where submissions go. Any inbox, Gmail included. |
| `from` | The sender, on a domain verified in that app's Postal mail server. |
| `postal_key` | An **API** credential of that mail server (dashboard → Credentials). |
| `origins` | Sites allowed to post. `*.example.com` matches every subdomain. Empty allows all. |
| `allow_no_origin` | `true` to take posts that carry no site address: a phone or desktop app, or your own server. |
| `redirect` | Where a plain form post lands afterwards. Without it, a small "sent" page. |
| `subject` | May use `{field}`: `Message from {name}`. |
| `autoreply` | Optional `subject` and `text` sent to the visitor's `email`. |
| `admin_token` | For `/s/<key>/recent?token=…`, the last submissions as JSON. |
| `limits` | `perMinute` per visitor and `perDay` per site; above them the service answers 429. |

The service re-reads the file when it changes; no restart.

**In the site**, a plain form (the Forms tab gives this, filled in, with a copy
button):

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
`contact@`, `billing@` …), a site's contact form plugged into any of them, rules,
auto-replies, and replies written by AI in each company's voice with any AI key.
Mail apps (phone, Outlook, Apple Mail) work too.

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
   sudo cp /opt/postal/nginx-xooteq-mail.conf /etc/nginx/sites-available/xooteq-mail.conf
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

### Forms: any form, app or service on any address

Settings → the company → **Forms** → *Connect a form*. Name the form, pick which
of the company's addresses it delivers to (`contact@`, `support@`, a campaign
address — any alias), say where the message is written, and that is the whole
setup. Nothing to host, no third party, no key to paste in.

A form here is just an address that takes a POST, so anything can write to it: a
contact form on a web page, a **message card inside one of your apps** (iOS,
Android, Flutter, React Native, desktop), a "report a problem" sheet, or your own
backend. Send it as a form post or as JSON; every field becomes a labelled line
in the mail, so an app can add whatever helps you answer — who was signed in, the
screen, the app's version, an order number. When the message carries an `email`
field, **Reply-To** is set to it, so one reply in the inbox answers the person.

Connecting one does the rest by itself: the company's domain is added as a
sending domain on one of Postal's apps (Settings → **Sending**; a new app named
after the company if there is none), an **API** key is made for the forms
service if the app has none, and the form is written into the service's
`sites.json`, which it re-reads at once.

What it gives back, with copy buttons:

- the address to post to, `https://forms.<company domain>/s/<key>`;
- the code for where the message is written, filled in with that address and
  those fields: an **HTML form** (honeypot and all), **JavaScript / React
  Native**, **Swift**, **Kotlin**, **Dart / Flutter**, or **curl** for a server.

Per form you can also set:

| | |
|---|---|
| **Messages arrive at** | Any address of the company. It is filed in that address's folder, and answered from it. |
| **Sites allowed to post** | `https://tailzu.space`, or `*.tailzu.space` for every subdomain. Empty allows any site. |
| **A message written in an app, or sent by a server** | Apps and servers send no site address, so the list above cannot be checked for them. Turn this on for an app's message card; listed sites are still the only ones allowed in a browser, and the limits below still hold. |
| **Subject of the mail** | `Message from {name}`: any field in braces. |
| **After sending, go to** | A thank-you page, for a plain form. Without it, a small "sent" page. |
| **Answer the visitor** | An immediate reply to the address they gave, from the same address, `{name}` and all. |
| **Limits** | Most per visitor a minute, most a day. Above them the site gets a clear refusal. |
| **Sent through** | Which Sending app's domain and key send it. Picked for you. |

An endpoint an app may post to can be found in the app's own code, so keep the
limits in mind: they are what stands between the key and a flood of junk (by
default 5 per minute per sender and 200 a day per form, both adjustable). The
honeypot catches the simple bots, and every submission is recorded whether it was
sent, refused or rate-limited.

Each form in the list has a switch (off answers "No such form"),
**Submissions** (everything the form received, mail or no mail, read back from
the server), and **Send a test**, which posts through the form exactly as a
browser or an app would and lands in the address — the fastest way to see the
whole path work. Removing a form stops it at once; mail already received stays.

If the domain's DKIM or SPF record for Postal is missing, the tab says so and
links to the records.

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

### Sending: your apps, in the same dashboard

Settings → **Sending** runs Postal from Xooteq Mail, so its own admin is rarely
needed. One **app** per thing that sends (Tailzu's sign-in codes, a site's
contact form), each with:

- **Overview**: sent, bounced and held in the last 24 hours, the last 14 days,
  and the exact settings to paste into Supabase (SMTP) or code (HTTP API), with a
  **Send a test**.
- **Users**: the people who use the app, read from its own database: name,
  gender, email (or phone, and the provider), when the account was made, when
  they finished onboarding and when they last used it, with totals, search and
  sorting. See below.
- **Messages**: everything it sent or received, searchable by address and status;
  open one to see each delivery attempt and the receiver's answer, and **Send
  again** or **Release** a held one.
- **Domains**: the domains it may send from, each with its own DKIM key and the
  records to add (SPF, DKIM, return path), checked live.
- **Keys**: one SMTP or API key per thing that uses it; show, copy, **hold** (its
  mail waits under Held) or delete each alone.
- **Blocked**: addresses that hard-bounced and are not sent to for 30 days;
  remove one to try again now.
- **Settings**: rename, Live or Development (logged, never delivered), delete.

It works through `postal-bridge`, a small service in Postal's own image that the
setup starts; changes are made by Postal's own code, exactly as its admin makes
them. Rare things (IP pools, webhooks, routes, Postal users) stay in Postal's
admin at `https://postal.mail.xooteq.online`.

#### Users: connecting an app's database

The **Users** tab is on each company (Settings → the company → **Users**, beside
Addresses) and on each Sending app; each keeps its own connection. It takes a
Postgres connection string once. For a Supabase
project (Tailzu): the project's **Connect** button → **Session pooler** (the
direct host is IPv6-only, which the VPS may not reach), with the database
password filled in. Xooteq recognises Supabase and reads `auth.users`: email or
phone, the provider, created, and last used (the latest of the last sign-in, the
last session refresh and, where the app keeps one, its own last-seen time). The
name and gender come first from wherever the app
saves what it asks at onboarding, and the name falls back to the one Google,
Apple or the sign-up form sent (`full_name`, `name`, `given_name` + `family_name`
and the other usual keys). That table is found by itself: any table linked to
`auth.users` by a foreign key (one row per user), or `public.profiles` / `users`
by `user_id` or `id`, with a name column such as `full_name`, `displayName`,
`name` or first + last name, and `gender`. Tailzu's is `public.profiles`
(`full_name`, `gender`). The same table gives **Onboarded**: the day onboarding
was finished (`onboarded_at`, `onboarding_completed_at`…), or, where the app keeps
only a yes/no (`onboarded`, `is_onboarded`…), Yes or Not yet; with a count of
who finished and an Onboarded sort. Its last-seen column (`last_seen_at`,
`last_active_at`…) counts toward Last used. The Connect screen shows what it
found; **Pick another table** chooses the table, its user-id column and its
name, gender, onboarding and last-seen columns by hand, for an app that keeps
them somewhere unusual. Deleted accounts are left out. Any other Postgres works
too: pick the table, and map which column is the name, gender, email, phone,
account created, onboarded and last used (guessed from the column names; dates
may be timestamps or epoch seconds/ms).

Xooteq only reads: every query runs in a `READ ONLY` transaction with a 15-second
limit. The connection string is stored encrypted (like the AI keys) and never
sent back to the page; deleting the app forgets it. A login that can only read is
still best:

```sql
create role xooteq_reader login password '…';
grant usage on schema public to xooteq_reader;
grant select on public.users to xooteq_reader;   -- your users table
```

`sslmode` is read the way `psql` reads it: `require` (the default for a remote
host) encrypts without verifying the certificate, `verify-full` verifies it,
`disable` turns SSL off.

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
# the Users tab against a real Postgres (three databases from test/users-fixture.sql):
#   createdb sb && createdb sb2 && createdb plain
#   for w in sb sb2 plain; do psql -d $w -v which=$w -f test/users-fixture.sql; done
#   XM_TEST_PG=postgresql://postgres@localhost:5432/postgres npm test
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
