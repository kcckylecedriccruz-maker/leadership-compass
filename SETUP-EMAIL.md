# Email setup: Gmail (Leadership Compass)

**Owners:** Kyle Cedric Cruz and Vivian Cruz

Leadership Compass sends every notification and alert through one Gmail account. There are two ways to connect it.
Pick **Option A** unless your Google Workspace admin has turned off App passwords.

## Option A (recommended): Gmail SMTP with an App password

No Google Cloud project is needed. Mail goes through `smtp.gmail.com` on port 465 (TLS).
Supabase blocks outbound ports 25 and 587, so 465 is the only port used.

1. Sign in to the Gmail / Google Workspace account that should send the emails.
2. Turn on 2-Step Verification: myaccount.google.com > Security > 2-Step Verification.
3. Create an App password: myaccount.google.com > Security > **App passwords**. Name it `Leadership Compass`.
   Copy the 16-character password (spaces don't matter).
4. In Supabase > Edge Functions > Secrets, add:

   | Secret | Value |
   | --- | --- |
   | `GMAIL_SMTP_USER` | The Gmail address, e.g. `hr.notifications@yourcompany.com` |
   | `GMAIL_SMTP_APP_PASSWORD` | The App password from step 3 |
   | `APP_URL` | Your published app address (no trailing slash) |
   | `INTERNAL_SECRET` | Any long random string (probably set already) |

5. Redeploy the edge functions (at least `send-email`, `send-test-email`, `check-gmail-connection`).
6. In the app (admin): Notifications > **Sender settings** > choose **Gmail**, set **Sender email** to the same
   address as `GMAIL_SMTP_USER`, save, then select **Check connection**. A test email arrives and the status shows
   **Connected as ...**.

When both secrets are set, SMTP is used for every Gmail send and takes priority over an OAuth connection (Option B).
Remove the secrets to go back to Option B.

| What you see | Fix |
| --- | --- |
| "Gmail SMTP sign-in failed" | Use an App password, not the normal password. Check that 2-Step Verification is on and the address matches `GMAIL_SMTP_USER`. |
| "App passwords" page missing | Your Workspace admin disabled them, or 2-Step Verification is off. Use Option B. |
| "Gmail daily sending limit reached" | Personal Gmail allows about 500 emails per day, Workspace about 2,000. Resend is used as backup if configured. |

## Option B: Gmail API with OAuth (send-only)
### 1. Supabase: apply the database change

Run the new migration `supabase/migrations/20261117090000_gmail_token_vault_functions.sql`
(Bolt applies it when you import the project, or paste it into Supabase > SQL editor).
Without it, Gmail can't be connected.

### 2. Google Cloud (one time)

1. Go to console.cloud.google.com, signed in as the Gmail account the emails will come from.
2. Create a project: **Leadership Compass Mail**.
3. Go to APIs & Services > Library > **Gmail API** > Enable.
4. Go to Google Auth Platform > Get started. App name: Leadership Compass. Audience: **External**.
5. On the **Branding** page:
   - Home page: your published app address.
   - Privacy policy: `<your app address>/privacy` (this page now ships with the app).
   - Authorised domains: your app's domain and `supabase.co`.
6. Go to **Data access** and add these scopes: `https://www.googleapis.com/auth/gmail.send`, `openid`,
   `https://www.googleapis.com/auth/userinfo.email`.
7. Go to **Audience** > **Publish app**. Don't stay in Testing: in Testing, Google expires the connection every 7 days.
8. Go to **Clients** > Create client > Web application.
   - Authorised redirect URI: `https://<project-ref>.supabase.co/functions/v1/gmail-oauth-callback`
   - Copy the **Client ID** (ends in `.apps.googleusercontent.com`) and the **Client secret** (starts with `GOCSPX-`).

### 3. Supabase secrets (Edge Functions > Secrets)

| Secret | Value | Required |
| --- | --- | --- |
| GOOGLE_CLIENT_ID | Client ID ending in `.apps.googleusercontent.com` | Yes |
| GOOGLE_CLIENT_SECRET | Client secret starting with `GOCSPX-` | Yes |
| APP_URL | Your published app address, e.g. `https://your-app.netlify.app` (no trailing slash) | Yes |
| INTERNAL_SECRET | Any long random string | Yes (probably set already) |
| RESEND_API_KEY, FROM_EMAIL | Backup sender | Optional |

Then redeploy the edge functions.

### 4. In the app (admin)

1. Open Notification settings > **Sender settings**. Choose **Gmail**.
2. Enter the sender name and, as **Sender email**, the Gmail address. Select **Save sender settings**.
3. Select **Connect Gmail**. Sign in as that Gmail account, accept the "unverified app" warning
   (Advanced > Go to Leadership Compass), then tick **Send email on your behalf**.
4. You come back to Sender settings showing **Connected as ...**. Select **Check connection**: a test email arrives.

## Troubleshooting

| What you see | Fix |
| --- | --- |
| "GOOGLE_CLIENT_ID is not a Google OAuth client ID" | The secret holds something else (e.g. a password). Paste the Client ID from Google Cloud. |
| Google "Error 401: invalid_client" | Same as above, or the client was deleted. Check the Client ID in Google Cloud > Clients. |
| Google "redirect_uri_mismatch" | The redirect URI in the Google client must match step 2.8 exactly. |
| "access_denied" | The Google app is still in Testing. Publish it (step 2.7). |
| "Approved with the wrong account" | Connect while signed in to Google as the saved sender email. |
| Status "Reconnect needed" | The Gmail password changed or access was removed. Select Reconnect Gmail. |

Personal Gmail accounts have a lower daily sending limit than Google Workspace accounts (2,000 per day).
For production, a Workspace account on your company domain is recommended.
