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

## Files

| File | Purpose |
|---|---|
| `master_running_sheet.csv` | The plan. Edit this. |
| `index.html` | Page structure. |
| `style.css` | Tokens, light/dark themes, table and chart chrome. |
| `app.js` | CSV parsing, the chart, the table. No dependencies. |
| `.nojekyll` | Tells Pages to serve the files as-is. |

## Notes on the chart

Columns are weekly miles; the line is the long run, drawn on the **same** miles
axis rather than a second y-scale. Elapsed weeks use a lighter step of the same
blue as upcoming weeks, and race weeks are picked out in orange. Long-run cells
that name two runs (`Sat 20 / Sun 12`) are summed for the line; the table always
shows the original text.
