# Naigi mobile (Beta)

> This app is in **beta**: it is unfinished, things will break, and updates may
> require re-installing. Do not rely on it yet.

Native Android and iOS app for Naigi, built as a [Capacitor](https://capacitorjs.com/)
shell around the shared frontend. All user-facing UI, end-to-end encryption, and
voice/video live in [`naigi-frontend`](https://github.com/Terriakidesu/naigi-frontend);
this repository owns only the native shell, its configuration, and mobile glue.

## Layout

| Path | Purpose |
| --- | --- |
| `native/` | JavaScript bridge exposed to the bundled pages as `window.naigiMobile` |
| `scripts/` | Sync the shared frontend build into `www/` and inject the native glue |
| `android/` | Capacitor Android project, permissions plugin, and app configuration |
| `ios/` | Capacitor iOS project (generated on macOS; requires Xcode) |
| `test/` | Node tests for the sync pipeline and the permission bridge |

`www/` is generated and ignored. Never edit it by hand.

## Getting started

Requirements: Node.js 22+, JDK 21, and the Android SDK (`ANDROID_SDK_ROOT`).

```sh
npm install
npm test
npm run cap:sync
npm run android:apk
```

`npm run sync` builds `../naigi-frontend` (override with `NAIGI_FRONTEND_DIR`), copies
its **mobile** build into `www/`, and adds `native/mobile.js` to every page. If that
build is already present, use `npm run sync -- --no-build`.

`npm run preview` serves `www/` at <http://localhost:4173/chat.html> so the interface
can be reviewed in a desktop browser at a phone size. Do not open `www/*.html` from
disk: the pages use absolute paths such as `/app.css`, which need an HTTP origin.

## Choosing a server

Naigi is self-hosted, so the app asks which server to use before anything else. The
picker accepts `https` origins (plus `http` for a server on the device itself),
rejects credentials, paths, and other schemes, and confirms an address really is a
Naigi server by reading `/v1/version` before saving it. Up to ten servers are kept,
most recent first, and forgetting one never removes stored keys or messages.

The bundled pages address `/v1` on their own origin, which is a local scheme inside
the app. Those calls are rewritten to the selected server and sent through the
platform, which keeps the session cookie in one place and does not require the
server to allow cross-origin requests. Encrypted attachments cross that boundary as
base64 in both directions, and the realtime socket is opened directly against the
selected server.

## Interface

The mobile build is a phone-native interface, not a scaled-down desktop layout:

- One full-screen conversation; the room drawer is the only navigation surface.
- A composer pill with a plus on the left and emoji and GIF controls on the right.
- A sheet under the composer: a four-column attachment grid with **Photos** and
  **Files** actions, or a shared **Emoji** / **GIFs** panel with search.
- Touch targets are at least 44px, with safe-area insets for notches and the home bar.


## Permissions

Naigi requests nothing at launch. Signing in and reading conversations work with no
permissions at all, and every prompt is raised by the feature that needs it.

| Permission | Requested when | Android declaration |
| --- | --- | --- |
| Microphone | Joining a voice room or call | `RECORD_AUDIO`, `MODIFY_AUDIO_SETTINGS` |
| Camera | Sharing video | `CAMERA` |
| Bluetooth | Routing calls to a headset or speaker | `BLUETOOTH_CONNECT` |
| Notifications | Enabling push messages and call alerts | `POST_NOTIFICATIONS` |

Storage is deliberately not requested. Attachments are chosen through the system
photo and document pickers and cached in app-scoped storage, so the app never needs
broad access to the shared media library. Cleartext traffic is disabled, so servers
must be reachable over HTTPS.

`native/permissions.js` exposes the request API used by the UI:

```js
const { microphone } = await naigiMobile.permissions.request("microphone");
if (microphone.blocked) { /* send the user to system settings */ }
```

Capacitor already converts `getUserMedia` calls into these runtime prompts, so voice
and video work even before the UI calls this module. The module exists so refusals
can be explained and permanently-blocked permissions can point at system settings.

## Status

- Android project builds and installs.
- The app still needs a server picker: the bundled pages talk to `/v1` on their own
  origin, which is the app's local scheme rather than your Naigi server. The shell
  must route those requests to the selected server the way the desktop app's main
  process does, and that work is not done yet.
- iOS has not been generated; that requires macOS.
- Push notifications need `google-services.json` (Android) and APNs configuration.
- No code signing, store metadata, or release automation yet.

## License

MIT, matching the rest of Naigi. See [LICENSE](LICENSE).
