# Cable Stock Take

A phone-friendly form for physical stock counts of wire and cable: drums, coils and cut lengths. Several people can count at once; everyone sees new entries within a few seconds.

## What it records

- Tag or sticker no., package (drum, coil, cut length) and number of identical coils
- Cable type (LT/HT power, control, instrumentation, solar DC, flexible cable, wire, earthing and more), conductor (Cu/Al), cores, size in mm², armour, insulation, colour and make
- Length, read from sheath meter marks (outer minus inner), the coil label, a measurement or an estimate
- Location or bay, condition, remarks, and who counted it

## Views

- **Count**: the entry form, with a duplicate-tag warning and an option to keep the cable details for the next entry
- **Entries**: searchable list of everything logged, with edit and delete
- **Summary**: drums, coils and metres on hand by cable size and by location, items needing attention, CSV export, and close/reopen for the count
- **Tally**: book stock from TallyPrime against the count (shortage and excess), item matching, and posting the count to Tally as a Physical Stock voucher

## Stack

- `index.html`, `app.css`, `app.js`: the front end, no build step
- `api/counts.js`, `api/lines.js`, `api/tally.js`: Vercel Functions for the app
- `api/tally-agent.js`: the endpoint the Tally connector calls, authenticated by `TALLY_SYNC_KEY`
- `tally-connector/`: the Node.js connector that runs on the Tally PC
- Postgres through `@neondatabase/serverless`. Tables (`cst_counts`, `cst_lines` and the `cst_tally_*` tables) are created automatically on first use.
- Functions run in Singapore (`sin1`); pick the Singapore region for the Neon database too.

## Setup on Vercel

1. In the project, open **Storage** and connect a **Neon** Postgres database. This adds `DATABASE_URL` to the project.
2. Optional but recommended: in **Settings → Environment Variables**, add `COUNT_PIN` with a PIN for your team. When it is set, the app asks for it before anyone can view or save counts.
3. Redeploy so the new variables take effect.

## Tally sync

Two-way sync with TallyPrime through a small connector on the PC where Tally runs. The app never connects to that PC; the connector calls out to the app.

**How it works**

- The connector talks to TallyPrime's XML server (port 9000) and to `/api/tally-agent`.
- To avoid waking the database all day, it watches a tiny public file in Vercel Blob (`tally/signal.json`). The app rewrites that file whenever someone asks for a pull or a post. The connector checks the database only when the file changes, plus about once an hour to refresh book stock.
- **Pull**: reads every stock item with its base unit and closing stock as of the count date (from 1 April of that financial year).
- **Match**: each cable spec in a count (make, type, conductor, cores, size, insulation, colour, coil length) is matched once to a Tally stock item, and the match is reused for later counts. Several specs can share one item.
- **Quantities** follow the Tally item's base unit. Metre units (m, mtr, mtrs, meter, rmt …) get the counted metres; any other unit (roll, coil, bundle, nos, drum …) gets the number of drums and coils. Weight units are not posted.
- **Post**: creates one Physical Stock voucher dated on the count date for the configured godown, with remote ID `cst-<count id>`. Posting the same count again updates that voucher. After posting, the connector re-reads book stock and reports any item that still differs.

**Setup**

1. In Vercel, connect a public Blob store to the project (it adds `BLOB_READ_WRITE_TOKEN`) and redeploy. Without it the connector still works, checking for work every 10 minutes instead of within a minute.
2. On the Tally PC: in TallyPrime, set **F1 (Help) → Settings → Connectivity → Client/Server configuration** to **Both** on port **9000**. Install Node.js LTS and copy the `tally-connector` folder there.
3. On that PC, open the app's Tally tab and tap **Create connector file**. Save the downloaded `config.json` into the `tally-connector` folder. The app keeps only a hash of the key, and replacing the file in the app disconnects the old one. (A `TALLY_SYNC_KEY` environment variable also works as a fixed key.)
4. Run `start-connector.bat`, and `install-autostart.bat` once to start it at sign-in.

See `tally-connector/README.txt` for the settings and troubleshooting.
