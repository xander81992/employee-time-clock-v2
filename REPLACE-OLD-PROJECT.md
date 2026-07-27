# Replace the Current Broken Project

This rebuilt project can use your existing Firebase project and existing Vercel project.

## GitHub

The safest approach is to create a new repository, for example:

```text
employee-time-clock-v2
```

Upload the contents of the extracted ZIP so that `package.json` is visible on the repository's main page.

Your GitHub repository should look like:

```text
app/
components/
lib/
public/
.env.example
firestore.rules
package.json
README.md
```

It should not look like:

```text
employee-time-clock-v2/
  employee-time-clock-rebuilt/
    package.json
```

## Vercel

Import the new GitHub repository.

Use:

```text
Framework Preset: Next.js
Root Directory: ./
Build Command: Default
Output Directory: Default
```

Keep only these existing Vercel variables:

```text
NEXT_PUBLIC_FIREBASE_API_KEY
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
NEXT_PUBLIC_FIREBASE_PROJECT_ID
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
NEXT_PUBLIC_FIREBASE_APP_ID
NEXT_PUBLIC_APP_URL
```

Delete these variables because the rebuilt project does not use them:

```text
FIREBASE_ADMIN_PROJECT_ID
FIREBASE_ADMIN_CLIENT_EMAIL
FIREBASE_ADMIN_PRIVATE_KEY
FIREBASE_SERVICE_ACCOUNT_JSON
```

## Firebase

Keep your existing administrator Authentication user and `admins/{UID}` document.

Enable Anonymous Authentication for the kiosk.

Publish the included `firestore.rules` file.
