# Bing's 24-Week Tracker

A phone-friendly web app for the 6-month plan: daily log (weight, food, steps, sleep, training, ankle routine, learning hours), a weight chart against the plan, a job application pipeline, and monthly ankle tests. It syncs between your phone and computer through a free Supabase database, and you host it free on GitHub Pages.

Setup takes about 20 minutes, once.

## What's in the folder

| File | What it is |
| --- | --- |
| `index.html`, `app.js` | The app |
| `schema.sql` | Creates the database tables (plus a few practice queries at the bottom) |
| `manifest.webmanifest`, `sw.js`, `icon-*.png`, `apple-touch-icon.png` | Let you add it to your home screen and open it offline |

## Step 1: Create the database (Supabase, free)

1. Go to supabase.com and sign up (GitHub sign-in is fastest).
2. Click **New project**. Name it `bing-tracker`, set a database password (save it somewhere), pick a US region, and choose the Free plan. Wait a minute or two while it starts.
3. In the left menu open **SQL Editor**, click **New query**, paste the whole of `schema.sql`, and click **Run**. You should see "Success. No rows returned."
4. Open **Authentication → Sign In / Providers** (the wording can differ slightly), find **Email**, and turn **off** "Confirm email". This lets you sign in right after creating your account. If you leave it on, Supabase emails you a confirmation link first; that works too.
5. Open **Project Settings → API** (or **API Keys**). Copy two things:
   - the **Project URL**, like `https://abcdefgh.supabase.co`
   - the **public key**, labeled `anon` `public` or **publishable**

   Never use the `service_role` or **secret** key in the app. The app refuses it if you paste it by mistake.

## Step 2: Put the app online (GitHub Pages, free)

1. On github.com click **New repository**. Name it `bing-tracker`, set it to **Public**, and create it.
2. Click **uploading an existing file**, drag in every file from this folder, and click **Commit changes**.
3. Open the repository's **Settings → Pages**. Under "Build and deployment", choose **Deploy from a branch**, branch **main**, folder **/ (root)**, then **Save**.
4. After a minute the page shows your address: `https://YOUR-USERNAME.github.io/bing-tracker/`

The code is public, but your data isn't. It lives in Supabase, and only your signed-in account can read it. The key isn't stored in the code; you type it into each device once.

## Step 3: Connect your devices

**On your computer:**

1. Open your GitHub Pages address.
2. Paste the Project URL and public key, then click **Connect**.
3. Enter your email and a password, then click **Create account**. Next time, use **Sign in**.

**On your phone:**

1. Open the same address in Safari (iPhone) or Chrome (Android).
2. Connect and sign in with the same account.
3. Add it to your home screen:
   - iPhone: tap **Share → Add to Home Screen**
   - Android: tap **⋮ → Add to Home screen** (or **Install app**)

It now opens full-screen like an app. When you open it, it loads the latest entries from the other device.

## Step 4: Lock it down (recommended)

Once your account exists, go to **Authentication → Sign In / Providers** (or **Settings**) in Supabase and turn off **Allow new users to sign up**. Your data is already private to your account, but this stops anyone else from creating accounts on your project.

## Good to know

- **Free-plan pause:** Supabase pauses free projects after about a week with no activity. Daily logging keeps it awake. If it ever pauses, open the Supabase dashboard and click **Restore**.
- **No-sync mode:** "Use on this device only" stores entries in that browser alone. If you start that way and connect Supabase later, open the **Sync** tab and use **Copy this device's data to the cloud**.
- **Backups:** the **Sync** tab exports each table as CSV, ready for Excel or pandas.
- **SQL practice:** in Supabase's SQL Editor you can query your own data. `schema.sql` ends with three example queries, including a weekly summary and a 7-day rolling average using window functions.
- **Changing the plan:** the start date (Nov 2, 2026), starting weight (95 kg) and goal (85 kg) are at the top of `app.js`. Edit them on GitHub and the site updates within a minute.
