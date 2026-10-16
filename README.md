# Cable Stock Take

A phone-friendly form for physical stock counts of wire and cable: drums, coils and cut lengths.

## What it records

- Tag or sticker no., package (drum, coil, cut length) and number of identical coils
- Cable type (LT/HT power, control, instrumentation, solar DC, flexible cable, wire, earthing and more), conductor (Cu/Al), cores, size in mm², armour, insulation, colour and make
- Remaining length, read from sheath meter marks (outer minus inner), the coil label, a measurement or an estimate
- Location or bay, condition and remarks

## Views

- **Count**: the entry form, with a duplicate-tag warning and an option to keep the cable details for the next entry
- **Entries**: searchable list of everything logged, with edit and delete
- **Summary**: drums, coils and metres on hand by cable size and by location, items needing attention, CSV export and close/reopen for the count

## Running it

`index.html` is a single self-contained page. Saving entries uses the claude.ai artifact runtime (shared database, viewer identity and file downloads), so the working copy is the published Claude artifact. Opened on its own, the page loads in view-only mode.
