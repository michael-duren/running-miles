# Weekly running schedule

A static viewer for `master_running_sheet.csv` — the plan from base through the
first marathon (Oct 4, 2026) to the Zumbro 50 (Apr 2027).

The CSV is the source of truth. The page reads it at load time, so editing the
CSV and pushing is the whole publishing workflow — there is no build step and
nothing to regenerate.

## Viewing it locally

The page fetches the CSV, and `fetch()` is blocked on `file://` URLs, so opening
`index.html` directly shows an error. Serve the directory instead:

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

## Publishing to GitHub Pages

Push to GitHub, then in the repo: **Settings → Pages → Build and deployment →
Deploy from a branch**, and pick `main` / `/ (root)`. The site is live at
`https://<user>.github.io/<repo>/` in a minute or so. No workflow file needed.

## Installing it on a phone

It's a PWA, so once it's on Pages you can save it to a home screen.

- **iOS / Safari:** Share → *Add to Home Screen*. (Safari only offers this from
  Safari itself, not from Chrome on iOS.)
- **Android / Chrome:** the ⋮ menu → *Install app* / *Add to Home screen*.

It opens without browser chrome, and works offline: the shell and the last
fetched copy of the CSV are cached. When the phone is offline the page says so
in a banner rather than passing a stale plan off as current.

The plan itself is fetched network-first, so the moment you have signal the app
shows the pushed CSV, not the cached one. A service worker needs a secure
context — this works on GitHub Pages (HTTPS) and on `localhost`, but not over
plain `http://` to a LAN IP.

After you push a change to the shell (`index.html`, `style.css`, `app.js`), bump
`CACHE` in `sw.js` so installed copies drop the old cache on next launch. CSV-only
edits need no bump.

## Files

| File | Purpose |
|---|---|
| `master_running_sheet.csv` | The plan. Edit this. |
| `index.html` | Page structure. |
| `style.css` | Tokens, light/dark themes, table and chart chrome. |
| `app.js` | CSV parsing, the chart, the table. No dependencies. |
| `sw.js` | Service worker: offline shell, network-first CSV. |
| `manifest.webmanifest` | PWA metadata: name, icons, standalone display. |
| `icons/` | App icons, including a maskable one for Android. |
| `.nojekyll` | Tells Pages to serve the files as-is. |

## Notes on the chart

Columns are weekly miles; the line is the long run, drawn on the **same** miles
axis rather than a second y-scale. Elapsed weeks use a lighter step of the same
blue as upcoming weeks, and race weeks are picked out in orange. Long-run cells
that name two runs (`Sat 20 / Sun 12`) are summed for the line; the table always
shows the original text.
