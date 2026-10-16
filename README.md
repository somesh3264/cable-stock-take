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

## Stack

- `index.html`, `app.css`, `app.js`: the front end, no build step
- `api/counts.js`, `api/lines.js`: Vercel Functions
- Postgres through `@neondatabase/serverless`. Tables (`cst_counts`, `cst_lines`) are created automatically on first use.
- Functions run in Singapore (`sin1`); pick the Singapore region for the Neon database too.

## Setup on Vercel

1. In the project, open **Storage** and connect a **Neon** Postgres database. This adds `DATABASE_URL` to the project.
2. Optional but recommended: in **Settings → Environment Variables**, add `COUNT_PIN` with a PIN for your team. When it is set, the app asks for it before anyone can view or save counts.
3. Redeploy so the new variables take effect.
