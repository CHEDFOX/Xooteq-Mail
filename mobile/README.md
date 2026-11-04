# Xooteq Mail on a phone

The native app: every company's mail, the contact forms, what the apps send, and
the AI's work — on iPhone and Android, from one React Native (Expo) codebase.

It talks to the same dashboard the browser does (`https://mail.xooteq.online`)
over its own API. Nothing new runs on the VPS for it: the app signs in as a
**device**, keeps a token of its own in the phone's secure storage, and sends it
as a bearer token (`dashboard/server/auth.ts`). Mail itself goes over the
dashboard's JMAP route, the same one the web app uses, so there is one mail
client in two skins.

```
mobile/
  src/app/           the screens; every file is a route (Expo Router)
    _layout.tsx      what exists when signed in, and what when not
    sign-in.tsx      the server, the email, the password
    (app)/           the four tabs: Mail, Forms, Sending, Settings
    thread/…         one conversation
    compose.tsx      write, reply, forward
    form/…           one contact form: its code, its submissions, its test
    sending/…        one app's message log
  src/lib/           the server, the mail, the formatting, notifications
    api.ts           the server address, the device token, every request
    jmap.ts          the mailbox (the web app's client, over this app's fetch)
    session.tsx      who is signed in, the companies, the unread counts
    push.ts          notifications when mail arrives
  src/ui/            the pieces the screens are built from
```

## Running it while working on it

```bash
cd mobile
npm install
npx expo start            # then scan the QR code with Expo Go on the phone
npx tsc --noEmit          # typecheck
npx expo lint             # lint
```

Expo Go is enough for everything except notifications (see below). On the
sign-in screen, give it the address of your Xooteq Mail — on the same network a
development server can also be reached as `http://192.168.x.x:5200`.

The default server is in `app.json` under `expo.extra.apiUrl`; the sign-in
screen can always be given another, and it is remembered.

## Putting it on a phone for good

EAS builds and signs in the cloud, so no Mac and no Xcode are needed.

```bash
npx eas-cli@latest login
npx eas-cli@latest init          # once: creates the project and its id
npx eas-cli@latest build --profile development --platform ios     # or android
```

- **Android**: the `preview` profile gives an `.apk` to install directly.
- **iPhone**: a build that installs on a device needs an **Apple Developer
  Program** membership ($99/yr); EAS asks for the account and makes the
  certificates itself. Without one, Expo Go is the way to run it.

An update to the JavaScript can then be shipped without a new build:

```bash
npx eas-cli@latest update --branch production
```

## Notifications when mail arrives

Stalwart already tells the dashboard about every delivered message; the server
passes that on to every signed-in phone through Expo's push service
(`dashboard/server/push.ts`). In the app: **Settings → Notifications on this
phone**.

Two things are needed, and the app says so plainly when they are missing:

1. **A development (or production) build.** Expo Go has carried no remote
   notifications since SDK 53.
2. **Credentials**, made by EAS when it builds: an APNs key for iOS (hence the
   Apple account), and a Firebase service account for Android
   (`eas credentials`, then `android.googleServicesFile` in `app.json`).

The server needs nothing else: `EXPO_PUSH_URL` defaults to Expo's own endpoint,
and a phone that uninstalls the app is forgotten the first time Expo reports its
token as gone.

## What the app does, and what stays in the browser

| On the phone | In the browser |
|---|---|
| Read, reply, forward, write, archive, delete, mark unread | Rules, the AI's voice and profile |
| Switch company and address; folders | Adding a company or an address, DNS |
| Forms: connect one, its code, its submissions, a test | A form's subject, auto-reply, limits, redirect |
| Sending: each app, its message log, send again | Keys, domains, suppression lists |
| AI activity; the AI mode per address | AI providers and their keys |
| The devices signed in, and signing one out | The account's password |

## Keeping it in step with the web app

`src/lib/types.ts` and `src/lib/jmap.ts` are the web app's own files with the
smallest changes needed for the phone (its fetch, its storage). When the
dashboard's API changes, copy `dashboard/web/src/types.ts` over and apply the
same change to `jmap.ts`; both say so at the top.
