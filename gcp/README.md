# Deploying Ascendant Labs Landing Page on GCP

This guide walks you through deploying the static website to **Firebase Hosting** and configuring the backend **Cloud Function** to process lead entries.

---

## Prerequisites
1. A **Google Cloud Platform (GCP)** account.
2. Node.js installed locally.
3. Access to your domain registrar settings for `ascendantlabs.co`.

---

## Step 1: Install Firebase CLI and Login

1. Install the global Firebase CLI tool:
   ```bash
   npm install -g firebase-tools
   ```
2. Log in using your Google credentials:
   ```bash
   firebase login
   ```

---

## Step 2: Initialize Firebase Project

1. Navigate to the `gcp` directory:
   ```bash
   cd ascendant_labs/gcp
   ```
2. Link to an existing GCP project or create a new one:
   ```bash
   firebase init
   ```
   - Select **Hosting: Configure files for Firebase Hosting and (optionally) set up GitHub Action deploys**.
   - Select **Functions: Configure a Cloud Function for Firebase**.
   - Choose your GCP Project.
   - For language, select **JavaScript**.
   - Select **No** to overwrite existing files (`functions/index.js`, `firebase.json` are already set up).
   - Use `../` as your public directory (since `index.html` sits at the parent directory level).

---

## Step 3: Test Locally Using Emulators

You can run a local emulation of both Firebase Hosting and Cloud Functions to test lead capture functionality locally:

```bash
firebase emulators:start
```
- Open `http://localhost:5000` to interact with the landing page.
- Submit the lead form; it will connect to the local emulated Cloud Function and save mock details.

---

## Step 4: Deploy to Production GCP

Run the deployment command:

```bash
firebase deploy
```

Upon successful completion, the CLI will output:
- **Hosting URL:** `https://<your-gcp-project-id>.web.app`
- **Function URL:** `https://submitLead-<hash>-uc.a.run.app`

---

## Step 5: Connect Custom Domain (`ascendantlabs.co`)

1. Go to the [Firebase Console](https://console.firebase.google.com/).
2. Select your project, navigate to **Hosting**, and click **Add Custom Domain**.
3. Enter your domain: `ascendantlabs.co`.
4. The console will generate custom **A records** or a **TXT record** (for ownership verification).
5. Log into your domain DNS manager (GoDaddy, Namecheap, Route 53, etc.) and add the generated DNS records.
6. SSL certificates are provisioned automatically by Google Cloud CDN within 1-2 hours of DNS verification.
