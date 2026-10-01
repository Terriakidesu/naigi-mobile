# Naigi mobile agent notes

- This repository is only the native shell. User-facing UI, end-to-end encryption, and
  voice/video belong in `../naigi-frontend`; change them there and re-run
  `npm run sync`. Never edit `www/`, it is generated.
- Use Node.js 22+ and npm, not Bun. Run `npm test`, `npm run check`, and
  `npm run cap:sync` after changes; `npm run android:apk` when touching Android code.
- Request permissions in context, never at launch. Sign-in and reading conversations
  must work with no permissions granted. Add new permissions only with a feature that
  needs them, and document them in the README table.
- Do not add broad storage permissions. Use the system pickers and app-scoped
  storage, and keep `usesCleartextTraffic` disabled so servers must use HTTPS.
- Keep the native bridge small and dependency-free: `native/` is plain ES modules
  loaded by the bundled pages, with no bundler and no framework.
- The selected server is the only destination for API traffic. `native/api-bridge.js`
  rewrites same-origin `/v1` calls and `NaigiApiPlugin` refuses any request that does
  not match the saved origin, so never relax that check or add a second origin.
- Servers are `https` origins only, except loopback over `http`. Do not accept
  credentials, paths, or other schemes, and do not raise the saved-server limit
  without a reason.
- Keep secrets out of the repository: no `google-services.json`, signing keys, or
  keystores. Do not commit `node_modules/`, `www/`, `.gradle/`, or build output.
- Never log message content, keys, or passphrases. The end-to-end encryption
  implementation is the shared frontend's WebAssembly module; do not reimplement,
  wrap, or weaken it here.
- The app is in beta and says so: the launcher label is "Naigi Beta"
  (`android/app/src/main/res/values/strings.xml`, kept in sync with
  `capacitor.config.json`), the picker shows a beta notice, and the README and
  changelog carry one. Drop all of these together when it leaves beta.
