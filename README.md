# Dossier — Job & Application Tracker

A private, self-hosted tracker for job applications, PhD/postdoc positions, and any other
opportunity you're applying to. Track statuses, upload the actual documents you send
(CV, cover letter, JD, offer letters), log every interview round, and see exactly which
materials you shared with which employer — all in one place.

No sign-up, no server, no account. It runs entirely in your browser.

## Features

- Track any opportunity type: Job, PhD Position, Postdoc, Internship, Fellowship, Other
- Every field is optional — add what you know now, fill in the rest later
- Upload real files per entry (CV, cover letter, JD, offer letter, transcripts, anything),
  with inline preview for images and PDFs
- Log document *versions* shared, separately from the files themselves
- Record interview rounds with format, outcome, notes, and exactly which materials were
  shared in that round
- Contacts (recruiter, hiring manager, PI) per entry
- Search, filter by type, and click any status (Saved / Applied / Screening / Interview /
  Offer / Rejected / Withdrawn) to filter the board by it
- Bulk import entries from a spreadsheet (.xlsx/.csv), and bulk-attach a folder of
  documents from a single .zip, matched to entries by Case ID in the filename
- Export/import a full JSON backup (including attached files)
- Optional passphrase lock: encrypts all data at rest with AES-256

## Bulk import

Open **Bulk import** in the toolbar. Two independent tools live there:

**Spreadsheet import** — upload an `.xlsx` or `.csv` file. Recognised columns (any order,
case-insensitive): `Type, Status, Company, Position, Location, Source, Applied Date,
Deadline, Link, JD, Notes`. Unrecognised columns are ignored; unrecognised Status/Type
values fall back to "Saved" / blank rather than failing the import. Click
**Download template** for a starter file with the right headers.

**Document import (.zip)** — upload a `.zip` containing your CVs, cover letters, JD
files, etc. Name each file starting with the entry's **Case ID** (shown on its card,
e.g. `JT-004`), then an underscore/dash and a label:

```
JT-004_CV.pdf
JT-004_Cover-Letter.docx
JT-012_Offer-Letter.pdf
```

Matching files are attached to the right entry automatically. Files that don't match an
existing Case ID are listed after import so you can rename and retry.

## Security

This app has no backend, no accounts, and (aside from your own click on Export) never
transmits your data anywhere. Read this section before relying on it for sensitive
documents.

**What's true by default:**
- All data, including uploaded files, stays in this browser's local `IndexedDB` storage.
  Nothing is sent over the network — the app makes no network requests of its own at
  runtime (the spreadsheet/zip import libraries are bundled locally in
  `assets/js/vendor/`, not loaded from a CDN).
- Data is scoped to the browser + exact URL you open the app from (see the note below).

**What's *not* true by default, and why it matters:**
- Data is **not encrypted** by default. Anyone with access to your browser profile, or
  to the device itself while you're logged in, can open the app (or inspect the
  browser's storage files directly) and read everything, including attached documents.
- This is standard for any purely client-side, no-login tool — there's no server to put
  a password on.

**Optional passphrase lock:** click **🔒 Security** in the toolbar to turn on
encryption at rest (AES-256-GCM, key derived from your passphrase via PBKDF2,
150,000 iterations). Once enabled:
- Every entry and every attached file is encrypted before being written to storage.
- Reopening the app shows a lock screen; you must enter the passphrase to decrypt and
  view anything.
- The derived key lives only in memory for that browser tab — it is never written to
  disk, and is gone the moment you close or reload the page (you'll need to unlock again).
- **There is no password reset.** The whole point of local encryption is that Anthropic,
  GitHub, and anyone else besides you has no way to recover it either. If you forget the
  passphrase, your only way back is a backup exported *before* you forgot it (see below).

**Practical recommendations for real security:**
- If you're on a shared or public computer, either don't use this app there, or enable
  the passphrase lock and remember to lock your OS session too — the lock only protects
  the data at rest in storage, not a browser window left open and unlocked.
- Treat exported backup (`.json`) files as sensitive documents themselves — they are
  **not** encrypted regardless of whether the in-app lock is on, since they're meant to
  be portable. Store them in an already-encrypted location (an encrypted disk, a
  password manager's file storage, a private, access-controlled repository — not a
  public one).
- Full-disk encryption on your device (FileVault on macOS, BitLocker on Windows) protects
  the underlying browser storage files at rest if your device is lost or stolen, on top
  of anything this app does.
- If you host this on GitHub Pages, remember that's a *public* URL by default — only the
  app code is public, not your data (which stays in your own browser), but don't rely on
  security-through-obscurity for the URL itself.

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
index.html                     Main page, modals (entry, bulk import, security), lock screen
assets/css/style.css           All styling
assets/js/db.js                IndexedDB storage layer (records, meta, file attachments)
assets/js/crypto.js            Optional AES-256 encryption layer (passphrase lock)
assets/js/app.js               UI logic: rendering, filtering, CRUD, bulk import, export/import
assets/js/vendor/xlsx.full.min.js   SheetJS, vendored locally, for spreadsheet import
assets/js/vendor/jszip.min.js       JSZip, vendored locally, for .zip document import
```

## License

MIT — see `LICENSE`.
