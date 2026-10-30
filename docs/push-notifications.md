# Push notifications setup

Madar Flow uses the documented `@capacitor/push-notifications` plugin on Android and iOS, and Firebase Messaging's Web SDK for browser/PWA push. The client registers the resulting FCM token with the authenticated API at `POST /v1/push/devices`; tokens are device credentials and must not be logged, pasted into shared examples, or committed.

## Android

- Keep the Firebase Android app configuration in the app's existing local Firebase setup. Do not copy its contents into documentation or Postman.
- Build with the Firebase Messaging Capacitor plugin after `npx cap sync android`.
- Verify permission prompts, foreground notifications, notification taps, and token refresh on a real device. Emulator delivery depends on its Google Play services image.

## iOS

- Add the Firebase iOS app configuration as `ios/App/App/GoogleService-Info.plist` locally. It is not present in this checkout.
- In Apple Developer and the Firebase project, enable the Push Notifications capability and configure an APNs authentication key or certificate for the iOS app.
- Open the iOS project in Xcode on macOS, select the correct team and signing profile, then build and verify on a physical iPhone. The project includes separate Debug and Release APS entitlements.
- Confirm foreground presentation, background delivery, and notification tap routing on device. A Windows build cannot validate the Xcode project or APNs delivery.

## Web and PWA

- Serve the app over HTTPS (localhost is accepted for development) and provide Firebase Web app configuration in `src/fcm/firebase-config.json`.
- Fill `apiKey`, `authDomain`, `projectId`, `messagingSenderId`, `appId`, and `vapidKey` from the Firebase Web app and Web Push certificate settings. These are public client configuration values; never put service-account credentials or private keys in this file.
- The app registers `/fcm/firebase-messaging-sw.js` at scope `/fcm/`, separate from Angular's `/ngsw-worker.js`. Verify browser permission, foreground notifications, background notifications, and click-through routing in supported browsers.

## Backend and end-to-end checks

- The backend needs its existing Firebase Admin service configuration to send messages. Configure it through the project's approved deployment secret management; do not add credential values to source files.
- Use a local/test account and a test device token to verify token registration, deactivation, push delivery, and notification navigation. No live Firebase or APNs configuration is changed by the source setup.
