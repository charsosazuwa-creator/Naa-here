# Naa here — one-click local demo

This is the real, unmodified application code — the same API and web
front end from the project — packaged to run entirely on your own
computer so you can click through it in your own browser.

## What it needs

- **Node.js 18 or newer.** If you don't have it, install it from
  https://nodejs.org (the "LTS" version) and restart your computer's
  terminal/Explorer after installing.
- An internet connection **the first time you run it** (to download a
  few npm packages). After that, it runs fully offline.
- A few hundred MB of free disk space (mostly the embedded Postgres
  binary and node_modules).

Nothing is sent anywhere over the network at runtime — the database,
API, and web server all run locally on your machine, listening only on
`localhost`.

## How to run it

**Windows:** double-click `start.bat`.

**Mac/Linux:** open a terminal in this folder and run `./start.sh`.

The first run will take a few minutes (installing dependencies and
building the API). After that, starting up takes just a few seconds.

A browser window will open automatically at the sign-up page once
everything is ready. If it doesn't, open
**http://localhost:3000/** yourself.

## Using it

- Sign up with any email and password. The app's verification codes
  aren't emailed for real in this build — the mock sender just prints
  the 6-digit code to the console window that opened, so watch that
  window and copy the code in from there.
- After verifying and signing in, go to
  **http://localhost:3000/provider/login.html** to sign in to the
  provider (business owner) portal, or register a new business from
  there.
- Everything you do — creating a business, adding services, receiving
  a booking — writes to a real local Postgres database with the same
  row-level-security tenant isolation as the production design. It's
  not mocked data this time: it's the real thing.

## Stopping it

Press `Ctrl+C` in the console window. Your data persists between runs
(it lives in `launcher/pgdata`), so you can stop and restart without
losing anything. To start completely fresh, delete the `launcher/pgdata`
folder and `launcher/.secrets.json` before restarting.

## If something goes wrong

- **"npm is not recognized" / "node is not recognized"**: Node.js
  isn't installed or isn't on your PATH. Reinstall from
  https://nodejs.org and make sure to restart your terminal afterward.
- **Port already in use** (3000 or 55433): something else on
  your machine is using one of those ports. Close it, or edit the
  `API_PORT` / `PG_PORT` constants near the top of
  `launcher/start.js`.
- **A migration or install step fails partway through**: it's safe to
  just run `start.bat` / `./start.sh` again — already-completed steps
  (dependency installs, migrations) are skipped automatically.
