# MoneyMind — Build & Publish Guide

## Prerequisites

| Tool | Install |
|------|---------|
| Node.js 18+ | https://nodejs.org |
| EAS CLI | `npm install -g eas-cli` |
| Expo account | https://expo.dev/signup (free) |
| Apple Developer | https://developer.apple.com ($99/yr, for iOS) |
| Google Play Console | https://play.google.com/console ($25 one-time, for Android) |

---

## Step 1 — Clone & install

```bash
git clone <your-repo-url>
cd artifacts/mobile
npm install -g eas-cli
```

---

## Step 2 — Create your EAS project

```bash
eas login
eas build:configure
```

This will:
- Create an EAS project at expo.dev
- Replace the placeholder `projectId` in `app.json` with a real UUID
- Generate your first `eas.json` if it doesn't exist

---

## Step 3 — Set your production API URL

Edit `eas.json` and replace the `EXPO_PUBLIC_API_BASE` value in the `production` env block with your deployed API domain:

```json
"production": {
  "env": {
    "EXPO_PUBLIC_API_BASE": "https://your-deployed-api.replit.app"
  }
}
```

> **How to get this URL**: In Replit, click **Publish** on the API Server artifact to deploy it. The `.replit.app` URL shown after deployment is your production API base.

---

## Step 4 — Android Build (APK for testing / AAB for Play Store)

### Test APK (sideload / internal testing)
```bash
eas build --platform android --profile preview
```
Downloads as `.apk`. Share via QR code or direct install on any Android device.

### Production AAB (Google Play)
```bash
eas build --platform android --profile production
```
Downloads as `.aab`. Upload to Google Play Console → Internal Testing → Production.

> **Keystore**: EAS creates and manages your Android keystore automatically on first build. Store the keystore in your EAS account — never lose it.

---

## Step 5 — iOS Build (IPA for App Store / TestFlight)

### Simulator build (local testing on Mac)
```bash
eas build --platform ios --profile development
```

### TestFlight / App Store
```bash
eas build --platform ios --profile production
```

> **Requirements**: You must have an active Apple Developer account and have created an App ID for `com.moneymind.app` in App Store Connect. EAS will handle provisioning profiles and certificates automatically.

---

## Step 6 — Submit to stores

### Submit to Google Play
```bash
eas submit --platform android
```
Needs `google-play-service-account.json` (download from Google Play Console → Setup → API Access).

### Submit to App Store
```bash
eas submit --platform ios
```
Needs your Apple ID, App Store Connect App ID, and Apple Team ID set in `eas.json` submit block.

---

## Step 7 — Set up Firebase (for push notifications on Android)

Currently `google-services.json` is a placeholder stub. To enable push notifications:

1. Go to https://console.firebase.google.com
2. Create project **MoneyMind**
3. Add Android app with package `com.moneymind.app`
4. Download the real `google-services.json` and replace the stub at `artifacts/mobile/google-services.json`
5. Rebuild with `eas build --platform android --profile production`

---

## SMS Auto-Read (Android only)

The `react-native-get-sms-android` package reads bank SMS automatically.

- Works in: **EAS Build APK/AAB** (any profile)
- Does NOT work in: Expo Go (normal development app)
- On iOS: SMS reading is not allowed by Apple — users use the **Paste** feature instead

---

## App Store Information

| Field | Value |
|-------|-------|
| App Name | MoneyMind — قطر للتمويل |
| Bundle ID | `com.moneymind.app` |
| Category | Finance |
| Age Rating | 4+ |
| Privacy Policy | Required (financial app) |
| Description | AI-powered personal finance app for Qatar. Track expenses, read bank SMS automatically, get AI coaching, monitor your financial health score, and invest in Qatar stocks. |
| Keywords | finance, budget, Qatar, QAR, expense tracker, AI, money |

---

## Google Play Information

| Field | Value |
|-------|-------|
| Package | `com.moneymind.app` |
| Category | Finance |
| Content Rating | Everyone |
| Target Countries | Qatar, GCC |
| Sensitive Permission | READ_SMS — explain that only bank transaction messages are read, nothing leaves the device |

---

## Troubleshooting

| Error | Fix |
|-------|-----|
| `google-services.json not found` | Replace stub with real Firebase file |
| `projectId must be a UUID` | Run `eas build:configure` to generate real ID |
| `Build failed: bundleIdentifier` | Make sure `com.moneymind.app` is registered in App Store Connect |
| `SMS permission rejected` | Normal — fallback to clipboard paste still works |
| API errors in production | Check `EXPO_PUBLIC_API_BASE` is set to deployed URL in `eas.json` |
