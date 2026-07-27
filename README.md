# Employee Time Clock — Rebuilt Version

This version uses the same simple Firebase login pattern as the earlier Yard System:

- Firebase Email/Password login in the browser
- Firestore `admins/{UID}` role document
- Anonymous Firebase Authentication for the employee kiosk
- Firestore Security Rules for access control
- No Firebase Admin SDK
- No service-account JSON
- No private key in Vercel

## Included

- Stationary QR code page
- Four-digit employee number
- Time In and Time Out buttons
- Duplicate clock-in and invalid clock-out prevention
- Administrator dashboard
- Live clocked-in employee list
- Employee management
- Date-range attendance reports
- Automatic hour calculation
- Excel export with Shift Details and Employee Summary sheets
- Toronto time formatting

## 1. Firebase Authentication

Open Firebase Console → Authentication → Sign-in method.

Enable both:

1. Email/Password
2. Anonymous

Create your administrator under Authentication → Users.

## 2. Firestore Database

Create a Cloud Firestore database.

Open Firestore → Rules and replace the rules with the complete contents of `firestore.rules` from this project. Click Publish.

## 3. Admin role document

Copy the administrator User UID from Firebase Authentication.

Create this Firestore document:

```text
admins
└── YOUR_AUTH_USER_UID
    └── role: "admin"
```

The `role` field type must be String.

## 4. Vercel variables

Only these seven variables are needed:

```env
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=
NEXT_PUBLIC_APP_URL=https://your-vercel-domain.vercel.app
```

Get the first six values from Firebase → Project Settings → General → Web app → Config.

Do not add any of these old variables:

```text
FIREBASE_ADMIN_PROJECT_ID
FIREBASE_ADMIN_CLIENT_EMAIL
FIREBASE_ADMIN_PRIVATE_KEY
FIREBASE_SERVICE_ACCOUNT_JSON
```

This rebuilt version does not use them.

## 5. Vercel deployment

If the full folder is uploaded to GitHub and `package.json` is inside the folder named `employee-time-clock-rebuilt`, set that as the Vercel Root Directory.

If the contents of this folder are placed directly at the GitHub repository root, use `./` as the Root Directory.

Keep the Framework Preset as Next.js.

## 6. Authorized domain

Firebase → Authentication → Settings → Authorized domains.

Add your Vercel domain without `https://`, for example:

```text
employee-time-clock-two.vercel.app
```

## 7. First use

1. Sign in at `/admin/login`.
2. Add employees and assign each one a four-digit number.
3. Open Station QR Code.
4. Print the QR sign.
5. Scan the QR and test Time In and Time Out.
6. Open Reports and export the Excel workbook.

## Security note

The kiosk uses Firebase Anonymous Authentication and narrow Firestore rules. It is intended for an internal attendance station. For a public internet deployment with stronger anti-abuse controls, add Firebase App Check and restrict the kiosk device or network.
