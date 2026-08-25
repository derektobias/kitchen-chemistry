# Kitchen Chemistry

A cooking app that explains the science behind every step — technique
explanations at three depth levels (Quick / Standard / Deep), curated
recipes, vertical step-by-step navigation.

## Project structure

```
kitchen-chemistry/
├── index.html          the app shell — one page, JS renders the views
├── manifest.json        PWA install config (must stay at root)
├── service-worker.js     offline caching (must stay at root — see note below)
├── icon.svg              app icon
├── data/
│   ├── techniques.json    THE DATABASE: technique library, 3-tier explanations
│   └── recipes.json       THE DATABASE: curated recipes, tagged to techniques
├── css/
│   └── styles.css
├── js/
│   ├── storage.js          saves/loads the user's depth preference
│   └── app.js               fetches data/*.json, then handles state, rendering,
│                              scroll tracking, init
└── images/                placeholder — recipe photos will live here later
```

**To add or edit a recipe or technique, edit the `.json` files in `data/`
directly** — plain JSON, no JavaScript syntax involved. `app.js` fetches
them at startup with `fetch()`, so changes show up on next page load with
no other code changes needed.

### Why one `index.html` instead of a `pages/` folder

This app behaves more like a native app (tap around without page reloads,
works offline, installs to a home screen) than a traditional multi-page
website. A single-page app shell with JS-driven views fits that better than
separate `.html` files — it's simpler to cache offline, and navigation feels
instant instead of triggering a browser reload each time. If the app grows
distinct sections later (settings, a recipe browser, etc.), those become new
JS view functions rather than new HTML files, keeping this same structure.

### Why `manifest.json` and `service-worker.js` stay at the root

A service worker's scope is everything at or below the folder it's served
from. Keeping it at the project root lets it control the whole app; moving
it into `js/` would limit it to only what's inside `js/`.

## Running locally in VS Code

1. Install the **Live Server** extension (by Ritwick Dey) from the
   Extensions panel.
2. Right-click `index.html` → **Open with Live Server**.
3. This serves the app at `http://localhost:...` rather than opening the
   file directly. That matters: service workers require either `https://`
   or `localhost` to register at all, so Live Server is actually the first
   place you can properly test installability and offline caching — opening
   the file directly (`file://...`) won't demonstrate that.

## Deploying to GitHub Pages (for testing on your phone)

1. Create a new GitHub repository (public — GitHub Pages is free for public
   repos).
2. Push this whole `kitchen-chemistry/` folder's contents to the repo root.
3. In the repo, go to **Settings → Pages**, set the source to the `main`
   branch, root folder, and save.
4. GitHub gives you a URL like `https://yourusername.github.io/repo-name/`.
   Visit it on your phone — you should be able to "Add to Home Screen" and
   have it open like an installed app.

Note: since this URL isn't at a domain root, every path in this project is
intentionally relative (`./css/styles.css`, not `/css/styles.css`) so it
works correctly under a subpath like `/repo-name/`.

## A note on data persistence

`js/storage.js` saves the user's depth preference two ways:

- **`window.storage`** — only exists inside a Claude.ai chat preview. Useful
  while we're building and testing together here.
- **`localStorage`** — the real, standard browser storage. This is what
  actually matters once the app is live on GitHub Pages or in Capacitor,
  where `window.storage` won't exist.

The code tries `window.storage` first and falls back to `localStorage`
automatically, so persistence works correctly in both contexts without any
changes needed when you deploy.
