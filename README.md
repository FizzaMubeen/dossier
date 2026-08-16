# Dossier — Job & Application Tracker

A private, self-hosted tracker for job applications, PhD/postdoc positions, and any other
opportunity you're applying to. Track statuses, upload the actual documents you send
(CV, cover letter, JD, offer letters), log every interview round, and see exactly which
materials you shared with which employer — all in one place.

No sign-up, no server, no account. It runs entirely in your browser.

## Features

- Track any opportunity type: Job, PhD Position, Postdoc, Internship, Fellowship, Other
- Every field is optional — add what you know now, fill in the rest later
- Upload real files per entry (CV, cover letter, JD, offer letter, transcripts, anything)
- Log document *versions* shared, separately from the files themselves
- Record interview rounds with format, outcome, notes, and exactly which materials were
  shared in that round
- Contacts (recruiter, hiring manager, PI) per entry
- Search, filter by status/type, and sort
- Export/import a full JSON backup (including attached files)

## Running it

No build step or install required.

**Option A — open directly**
Download or clone this repository, then open `index.html` in a modern browser
(Chrome, Firefox, Edge, or Safari).

**Option B — GitHub Pages**
1. Push this repository to GitHub (see below).
2. In the repository, go to **Settings → Pages**.
3. Under "Build and deployment", set **Source** to `Deploy from a branch`, branch `main`, folder `/ (root)`.
4. Save. GitHub will give you a URL like `https://<your-username>.github.io/<repo-name>/`.

**Option C — any static host**
This is a static site (HTML/CSS/JS, no backend). You can host it on Netlify, Vercel,
Cloudflare Pages, or any static file host by pointing it at this folder.

## Where your data lives

All data — including uploaded files — is stored locally in your browser using
**IndexedDB**. Nothing is sent to a server. This means:

- Your data stays private to the device and browser you use.
- Data is tied to the specific browser + domain combination. Opening the app from a
  different browser, in private/incognito mode, or from a different URL (e.g. locally
  vs. on GitHub Pages) will show a separate, empty dataset.
- Clearing your browser's site data will delete your entries.

**Because of this, treat "Export backup" as your real record.** Click it regularly
(the app suggests this in the Attachments tab) to download a single JSON file
containing every entry and every attached file. Keep that file somewhere durable —
a synced folder, a private repository, cloud storage. Use "Import backup" to restore
it, on this device or any other.

## Pushing this project to GitHub

From inside this folder:

```bash
git init
git add .
git commit -m "Initial commit: Dossier application tracker"
git branch -M main
git remote add origin https://github.com/<your-username>/<your-repo-name>.git
git push -u origin main
```

Create the empty repository on GitHub first (no README/license, so there's no
conflict), then run the commands above with your own username and repository name.

## Project structure

```
index.html                 Main page and modal markup
assets/css/style.css       All styling
assets/js/db.js            IndexedDB storage layer (records + file attachments)
assets/js/app.js           UI logic: rendering, filtering, CRUD, export/import
```

## Privacy note

This tool has no backend and makes no network requests of its own (aside from loading
the Google Fonts stylesheet). Your application data, notes, and uploaded files never
leave your browser unless you explicitly export and share the backup file yourself.

## License

MIT — see `LICENSE`.
