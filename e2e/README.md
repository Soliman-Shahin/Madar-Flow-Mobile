# Consumer app browser e2e (Playwright)

Runs the real Angular app in Google Chrome (Pixel 7 viewport) against a **local QA backend**
(in-memory MongoDB, throwaway secrets). It never targets staging or production:
`playwright.config.ts` rejects any `E2E_API_TARGET` that is not localhost.

## Run

```powershell
# Madar-Flow-BE: fresh backend with seeded QA accounts
$env:QA_PORT='3115'; $env:QA_PASSWORD='<throwaway password>'; node scripts/qa-server.cjs

# Madar-Flow-Mobile
$env:E2E_API_TARGET='http://localhost:3115'; $env:E2E_PASSWORD='<same password>'; npm run e2e
npm run e2e:report   # HTML report
```

Start a **fresh** QA backend for each full run: the auth rate limiter (100 attempts / 15 min in
non-production) is intentionally left on, and each test signs in through the UI.

## What is covered

| Spec | Covers |
|---|---|
| `auth.spec.ts` | login form, protected-route redirect, wrong password, disabled empty submit, login + reload, request body not plaintext |
| `currency.spec.ts` | account without a currency (`qa-user-nocurrency`) is asked after sign-in; Later skips, Save stores it on the server |
| `data.spec.ts` | server data shown in categories / transactions, search, account in settings |
| `categories.spec.ts` | create category in the UI and verify it on the server, required title |
| `transactions.spec.ts` | create transaction + server check, **offline create then sync with no duplicate**, required amount |

Notes: the first-run onboarding is pre-completed in `fixtures.ts`; server-side checks use the
QA API directly (`support.ts`). Ionic puts sheet content outside its `dialog` element, so sheet
locators query the page, not the dialog.

## Real Android device against the local QA backend

Used to verify the native build without touching production. Nothing here is committed.

1. Copy `src/environments/environment.ts` to `environment.qa.ts` (git-ignored), pointing `nativeApiUrl` to `http://localhost:<port>/v1` and `backendOrigin` to `http://localhost:<port>`, and add a `qa-android` build configuration in `angular.json` that file-replaces `environment.ts` with it (copy the `staging` block).
2. Temporarily set `server.androidScheme: 'http'` and `server.cleartext: true` in `capacitor.config.ts` (a new web origin also keeps the installed app's real data separate). Revert afterwards.
3. `npx ng build --configuration qa-android`, `npx cap sync android`, `android\gradlew.bat assembleDebug`, then `adb reverse tcp:<port> tcp:<port>` and `adb install -r app-debug.apk` (never uninstall).
4. Drive and inspect with Chrome DevTools Protocol: `adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>`, then Playwright `chromium.connectOverCDP('http://localhost:9222')`.
5. Restore: revert the Capacitor config, `npm run build`, `npx cap sync android`, `gradlew assembleDebug`, `adb install -r`, and remove the `adb reverse`/`forward` rules.
