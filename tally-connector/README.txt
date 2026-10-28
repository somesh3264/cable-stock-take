CABLE STOCK TAKE - TALLY CONNECTOR
==================================

This small program links TallyPrime to the Cable Stock Take app
(https://cable-stock-take.vercel.app). It runs on the PC where TallyPrime is open.

What it does
  - Sends Tally's stock items and book (closing) stock to the app, so the app can
    show shortage and excess against the physical count.
  - When someone taps "Post Physical Stock" in the app's Tally tab, it creates a
    Physical Stock voucher in TallyPrime with the counted quantities.

It only talks to TallyPrime on this PC and to the app. Nothing else is installed.


ONE-TIME SETUP
--------------
1. TallyPrime: open F1 (Help) > Settings > Connectivity > Client/Server configuration.
   Set "TallyPrime is acting as" to Both and "Port" to 9000. Save, then restart Tally
   and open your company.

2. Install Node.js (the LTS version) from https://nodejs.org . Accept the defaults.

3. Put this folder somewhere permanent, for example C:\CableStockTake\tally-connector

4. On this PC, open the app, go to the Tally tab and tap "Create connector file".
   Save the downloaded config.json into this folder. If the browser saved it as
   "config (1).json", rename it to config.json. It holds the connector's private key,
   so do not share it. You can change these settings in it with Notepad:
     company      Leave empty to use the company open in Tally, or type the exact
                  company name if several are open.
     godown       The godown the counted stock is posted to. Default "Main Location".
                  If you do not use godowns in Tally, leave it as "Main Location".
     tallyUrl     Change only if Tally uses a port other than 9000.

5. Double-click start-connector.bat. A black window opens and shows what it is doing.
   Keep it open (minimise it). Within a minute the app's Tally tab turns green.

6. Optional: double-click install-autostart.bat once so the connector starts each
   time you sign in to Windows. remove-autostart.bat undoes this.


USING IT
--------
- In the app, open the Tally tab. Tap "Refresh book stock" to pull stock as of the
  count date. The connector also refreshes it about once an hour.
- Match each cable to its Tally stock item (likely matches are filled in), then save.
- Check "Book vs counted". When it looks right, tap "Post Physical Stock" twice.
- The connector posts the voucher, re-reads book stock and reports the result in the
  app. Posting the same count again updates the same voucher instead of adding a
  second one.

The first time you post, open the voucher in Tally (Day Book, on the count date) and
check the items, quantities and godown before relying on it.


QUANTITIES AND UNITS
--------------------
The connector uses each Tally item's base unit:
  - metres (m, mtr, mtrs, meter, rmt ...): the counted length in metres is posted
  - anything else (roll, coil, nos, pcs, drum ...): the number of drums/coils is posted
  - weight units (kg, ton ...): cannot be posted from a cable count and are skipped


IF SOMETHING IS WRONG
---------------------
"Cannot reach TallyPrime"   Tally is closed, or the XML server port is not 9000
                            (see setup step 1).
"Key not accepted"          The key was replaced in the app. Download a new
                            config.json from the Tally tab.
"Cannot reach the app"      No internet on this PC, or a firewall blocks it.
Jobs stay "Waiting"         The connector window is closed. Start it again; waiting
                            jobs run when it is back (they expire after 24 hours).

To test without leaving it running:  node connector.js --once
