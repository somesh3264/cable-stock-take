#!/usr/bin/env node
/*
 * Cable Stock Take - Tally connector
 *
 * Runs on the PC where TallyPrime is open. It:
 *   - pulls stock items and closing stock (book stock) from TallyPrime into the app,
 *   - posts counted stock to TallyPrime as a Physical Stock voucher when someone taps
 *     "Post Physical Stock" in the app.
 *
 * TallyPrime must have its XML server on (default port 9000). No other software is needed
 * besides Node.js 18 or newer. Settings live in config.json next to this file.
 *
 * Run:  node connector.js          (keeps running)
 *       node connector.js --once   (one check-in, then exit)
 */
'use strict';

const fs = require('fs');
const path = require('path');

const VERSION = '1.0.0';
const ONCE = process.argv.includes('--once');
const CONFIG_PATH = process.env.CST_CONFIG || path.join(__dirname, 'config.json');
const CHECKIN_MS = 60 * 60 * 1000;   // hourly check-in and book stock refresh
const FALLBACK_MS = 10 * 60 * 1000;  // check-in interval if the app has no signal file
const TALLY_TIMEOUT_MS = 120 * 1000;
const APP_TIMEOUT_MS = 60 * 1000;

const DEFAULTS = {
  appUrl: 'https://cable-stock-take.vercel.app',
  syncKey: '',
  tallyUrl: 'http://localhost:9000',
  company: '',
  godown: 'Main Location',
  batch: 'Primary Batch',
  voucherType: 'Physical Stock',
  pollSeconds: 30,
};

/* ---------------- small helpers ---------------- */

const sleep = ms => new Promise(r => setTimeout(r, ms));
function log(...args) {
  const t = new Date().toLocaleString('en-IN', { hour12: false });
  console.log(`[${t}]`, ...args);
}

function loadConfig() {
  let raw;
  try { raw = fs.readFileSync(CONFIG_PATH, 'utf8'); }
  catch (e) { throw new Error(`Cannot read ${CONFIG_PATH}. Copy config.example.json to config.json and fill it in.`); }
  let cfg;
  try { cfg = JSON.parse(raw.replace(/^\uFEFF/, '')); }
  catch (e) { throw new Error(`config.json is not valid JSON: ${e.message}`); }
  cfg = Object.assign({}, DEFAULTS, cfg);
  if (!cfg.syncKey) throw new Error('syncKey is empty in config.json.');
  cfg.appUrl = String(cfg.appUrl).replace(/\/+$/, '');
  cfg.tallyUrl = String(cfg.tallyUrl).replace(/\/+$/, '');
  cfg.pollSeconds = Math.max(10, Number(cfg.pollSeconds) || 30);
  return cfg;
}

async function fetchWithTimeout(url, opts, ms) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try { return await fetch(url, Object.assign({}, opts, { signal: ac.signal })); }
  finally { clearTimeout(t); }
}

/* ---------------- XML helpers ---------------- */

const xmlEsc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

function xmlDecode(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e) => {
    const k = e.toLowerCase();
    if (k === 'amp') return '&';
    if (k === 'lt') return '<';
    if (k === 'gt') return '>';
    if (k === 'quot') return '"';
    if (k === 'apos') return "'";
    const code = k[1] === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
    return Number.isFinite(code) ? String.fromCodePoint(code) : m;
  });
}

/** Tally sometimes emits control characters (like &#4;) that are not valid XML. */
function cleanTally(s) {
  return s
    .replace(/&#(\d+);/g, (m, n) => (+n < 32 && ![9, 10, 13].includes(+n) ? '' : m))
    .replace(/&#x([0-9a-f]+);/gi, (m, h) => (parseInt(h, 16) < 32 && ![9, 10, 13].includes(parseInt(h, 16)) ? '' : m))
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}

function tagText(block, name) {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i').exec(block);
  return m ? xmlDecode(m[1]).trim() : '';
}

function tagAll(block, name) {
  const re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'gi');
  const out = [];
  let m;
  while ((m = re.exec(block))) out.push(xmlDecode(m[1]).trim());
  return out;
}

/** " 25 Roll", "-3.5 Mtr", "(-)2 Nos", "1,250 Mtr" -> { qty, unit } */
function parseQty(text) {
  const t = String(text || '').trim();
  if (!t) return { qty: 0, unit: '' };
  const neg = /^\(-\)/.test(t) || /^-/.test(t);
  const m = /([\d,]*\.?\d+)\s*([^\d=\s][^=]*?)?\s*(?:=|$)/.exec(t.replace(/^\(-\)/, ''));
  if (!m) return { qty: 0, unit: '' };
  const qty = parseFloat(m[1].replace(/,/g, '')) * (neg ? -1 : 1);
  return { qty: Number.isFinite(qty) ? qty : 0, unit: (m[2] || '').trim() };
}

function parseNum(text) {
  const m = /-?[\d,]*\.?\d+/.exec(String(text || ''));
  return m ? Math.abs(parseFloat(m[0].replace(/,/g, ''))) || 0 : 0;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ymd = iso => iso.replace(/-/g, '');                   // 2026-10-16 -> 20261016
function fyStart(iso) {                                       // Indian financial year start
  const [y, mo] = iso.split('-').map(Number);
  return `${mo >= 4 ? y : y - 1}0401`;
}
function prettyDate(iso) {
  const [y, mo, d] = iso.split('-').map(Number);
  return `${d}-${MONTHS[mo - 1]}-${y}`;
}
function fmtQty(n) {
  return String(Math.round(Number(n) * 1000) / 1000);
}

/* ---------------- TallyPrime ---------------- */

let cfg;

async function tallyPost(xml) {
  let res;
  try {
    res = await fetchWithTimeout(cfg.tallyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml;charset=utf-8' },
      body: xml,
    }, TALLY_TIMEOUT_MS);
  } catch (e) {
    throw new Error(`Cannot reach TallyPrime at ${cfg.tallyUrl}. Is Tally open with the XML server on? (${e.cause ? e.cause.code || e.cause.message : e.message})`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  let text;
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) text = buf.slice(2).toString('utf16le');
  else if (buf.length >= 2 && buf[1] === 0x00 && buf[0] !== 0x00) text = buf.toString('utf16le');
  else text = buf.toString('utf8');
  text = cleanTally(text.replace(/^\uFEFF/, ''));
  if (!res.ok) throw new Error(`TallyPrime replied ${res.status}: ${text.slice(0, 200)}`);
  return text;
}

async function tallyHealth() {
  try {
    const res = await fetchWithTimeout(cfg.tallyUrl, { method: 'GET' }, 15000);
    const text = await res.text();
    if (/running/i.test(text)) return { ok: true, error: '' };
    return { ok: false, error: `Unexpected reply from ${cfg.tallyUrl}: ${text.slice(0, 120)}` };
  } catch (e) {
    return { ok: false, error: `Cannot reach TallyPrime at ${cfg.tallyUrl}. Open Tally and check the XML server port.` };
  }
}

function companyVars() {
  return cfg.company ? `<SVCURRENTCOMPANY>${xmlEsc(cfg.company)}</SVCURRENTCOMPANY>` : '';
}

/** Stock items with closing stock as of a date (YYYY-MM-DD). */
async function fetchStockItems(asOf) {
  const xml =
    '<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE>' +
    '<ID>CSTStockItems</ID></HEADER><BODY><DESC><STATICVARIABLES>' +
    '<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>' + companyVars() +
    `<SVFROMDATE TYPE="Date">${fyStart(asOf)}</SVFROMDATE><SVTODATE TYPE="Date">${ymd(asOf)}</SVTODATE>` +
    '</STATICVARIABLES><TDL><TDLMESSAGE>' +
    '<COLLECTION NAME="CSTStockItems" ISINITIALIZE="Yes"><TYPE>StockItem</TYPE>' +
    '<NATIVEMETHOD>Name</NATIVEMETHOD><NATIVEMETHOD>Parent</NATIVEMETHOD><NATIVEMETHOD>BaseUnits</NATIVEMETHOD>' +
    '<NATIVEMETHOD>ClosingBalance</NATIVEMETHOD><NATIVEMETHOD>ClosingValue</NATIVEMETHOD>' +
    '</COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>';
  const text = await tallyPost(xml);
  const err = tagText(text, 'LINEERROR');
  if (err) throw new Error(`Tally: ${err}`);
  const items = [];
  const re = /<STOCKITEM\b([^>]*)>([\s\S]*?)<\/STOCKITEM>/gi;
  let m;
  while ((m = re.exec(text))) {
    const attr = /\bNAME="([^"]*)"/i.exec(m[1]);
    const name = attr ? xmlDecode(attr[1]).trim() : tagText(m[2], 'NAME');
    if (!name) continue;
    const closing = tagText(m[2], 'CLOSINGBALANCE');
    const baseUnit = tagText(m[2], 'BASEUNITS');
    const pq = parseQty(closing);
    items.push({
      name,
      parent: tagText(m[2], 'PARENT'),
      unit: baseUnit || pq.unit,
      qty: pq.qty,
      value: parseNum(tagText(m[2], 'CLOSINGVALUE')),
      text: closing,
    });
  }
  if (!items.length && !/<COLLECTION\b|<DATA\b|<ENVELOPE\b/i.test(text)) {
    throw new Error(`Unexpected reply from Tally: ${text.replace(/\s+/g, ' ').slice(0, 200)}`);
  }
  return items;
}

function voucherXml(p, format) {
  const list = format === 'all' ? 'ALLINVENTORYENTRIES.LIST' : 'INVENTORYENTRIESIN.LIST';
  const rows = p.entries.map(e => {
    const qty = `${fmtQty(e.qty)} ${xmlEsc(e.unit)}`;
    return `<${list}><STOCKITEMNAME>${xmlEsc(e.item)}</STOCKITEMNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>` +
      `<ACTUALQTY> ${qty}</ACTUALQTY><BILLEDQTY> ${qty}</BILLEDQTY>` +
      `<BATCHALLOCATIONS.LIST><GODOWNNAME>${xmlEsc(cfg.godown)}</GODOWNNAME><BATCHNAME>${xmlEsc(cfg.batch)}</BATCHNAME>` +
      `<ACTUALQTY> ${qty}</ACTUALQTY><BILLEDQTY> ${qty}</BILLEDQTY></BATCHALLOCATIONS.LIST></${list}>`;
  }).join('');
  const sv = cfg.company ? `<STATICVARIABLES>${companyVars()}</STATICVARIABLES>` : '';
  return '<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA>' +
    `<REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME>${sv}</REQUESTDESC><REQUESTDATA>` +
    '<TALLYMESSAGE xmlns:UDF="TallyUDF">' +
    `<VOUCHER REMOTEID="${xmlEsc(p.remoteId)}" VCHTYPE="${xmlEsc(cfg.voucherType)}" ACTION="Create" OBJVIEW="Inventory Voucher View">` +
    `<DATE>${ymd(p.date)}</DATE><VOUCHERTYPENAME>${xmlEsc(cfg.voucherType)}</VOUCHERTYPENAME>` +
    `<NARRATION>${xmlEsc(p.narration || '')}</NARRATION><PERSISTEDVIEW>Inventory Voucher View</PERSISTEDVIEW>` +
    rows + '</VOUCHER></TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>';
}

function importResult(text) {
  const n = name => parseInt(tagText(text, name), 10) || 0;
  return {
    created: n('CREATED'),
    altered: n('ALTERED'),
    errors: n('ERRORS'),
    exceptions: n('EXCEPTIONS'),
    voucherId: tagText(text, 'LASTVCHID'),
    lineErrors: tagAll(text, 'LINEERROR').slice(0, 20),
    raw: text.replace(/\s+/g, ' ').slice(0, 400),
  };
}

async function postPhysicalStock(p) {
  const attempts = [];
  for (const format of ['in', 'all']) {
    const r = importResult(await tallyPost(voucherXml(p, format)));
    attempts.push(Object.assign({ format }, r));
    if (r.created + r.altered > 0) return { ok: true, format, attempts, result: r };
    // Nothing was created, so trying the other entry format is safe.
  }
  return { ok: false, attempts, result: attempts[attempts.length - 1] };
}

/* ---------------- the app ---------------- */

let tally = { ok: false, error: 'Not checked yet', checkedAt: 0 };

function agentInfo() {
  return {
    version: VERSION,
    company: cfg.company,
    godown: cfg.godown,
    tallyOk: tally.ok,
    tallyError: tally.error,
    tallyCheckedAt: tally.checkedAt,
  };
}

async function app(action, body) {
  let res;
  try {
    res = await fetchWithTimeout(`${cfg.appUrl}/api/tally-agent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Sync-Key': cfg.syncKey,
        'User-Agent': `cst-tally-connector/${VERSION}`,
      },
      body: JSON.stringify(Object.assign({ action, agent: agentInfo() }, body || {})),
    }, APP_TIMEOUT_MS);
  } catch (e) {
    throw new Error(`Cannot reach the app at ${cfg.appUrl} (${e.cause ? e.cause.code || e.cause.message : e.message})`);
  }
  let j = null;
  try { j = await res.json(); } catch (e) { /* ignore */ }
  if (!res.ok) throw new Error((j && j.message) || `The app replied ${res.status}`);
  return j || {};
}

async function readSignal(url) {
  try {
    const res = await fetchWithTimeout(url, { method: 'GET' }, 15000);
    if (!res.ok) return null;
    const j = await res.json();
    return j && j.seq != null ? String(j.seq) : null;
  } catch (e) {
    return null;
  }
}

/* ---------------- jobs ---------------- */

async function pullAndSend(asOf, jobId) {
  const items = await fetchStockItems(asOf);
  await app('snapshot', { jobId, asOf, company: cfg.company, items });
  log(`Book stock sent to the app: ${items.length} stock items as of ${prettyDate(asOf)}.`);
  return items;
}

async function runPost(job) {
  const p = job.payload || {};
  if (!Array.isArray(p.entries) || !p.entries.length || !p.date) throw new Error('This post has no items.');
  log(`Posting Physical Stock dated ${prettyDate(p.date)}: ${p.entries.length} items, godown "${cfg.godown}"...`);
  const posted = await postPhysicalStock(p);
  const r = posted.result;
  if (!posted.ok) {
    const msg = r.lineErrors.length ? r.lineErrors.join(' | ') : `Tally created nothing (errors: ${r.errors}). Reply: ${r.raw}`;
    log('Tally did not accept the voucher:', msg);
    await app('result', {
      jobId: job.id,
      status: 'error',
      result: { message: `Tally did not accept the voucher: ${msg}`, attempts: posted.attempts },
    });
    return;
  }
  log(`Tally ${r.created ? 'created' : 'updated'} the voucher${r.voucherId ? ` (id ${r.voucherId})` : ''}. Checking book stock...`);

  // Read book stock again for the same date and compare with what was posted.
  let checks = [];
  let checkError = '';
  try {
    const items = await pullAndSend(p.date, null);
    const byName = new Map(items.map(i => [i.name, i]));
    checks = p.entries.map(e => {
      const it = byName.get(e.item);
      const book = it ? it.qty : null;
      return { item: e.item, unit: e.unit, posted: e.qty, book, ok: book != null && Math.abs(book - e.qty) < 0.001 };
    });
  } catch (e) {
    checkError = e.message;
  }
  const bad = checks.filter(c => !c.ok);
  const status = checkError || bad.length ? 'warning' : 'done';
  let message;
  if (checkError) message = `Voucher ${r.created ? 'created' : 'updated'} in Tally, but book stock could not be re-read: ${checkError}`;
  else if (!bad.length) message = `Voucher ${r.created ? 'created' : 'updated'} in Tally. Book stock now matches the count for all ${checks.length} items.`;
  else if (bad.length === checks.length) message = `Voucher ${r.created ? 'created' : 'updated'} in Tally, but book stock does not match the count for any item. Open the voucher in Tally's Day Book and check it.`;
  else message = `Voucher ${r.created ? 'created' : 'updated'} in Tally. ${bad.length} of ${checks.length} items still differ from the count, usually because stock sits in another godown or there are later entries on the same date.`;
  log(message);
  await app('result', {
    jobId: job.id,
    status,
    result: {
      message,
      created: r.created,
      altered: r.altered,
      voucherId: r.voucherId,
      format: posted.format,
      godown: cfg.godown,
      lineErrors: r.lineErrors,
      checks: checks.slice(0, 500),
      mismatches: bad.length,
    },
  });
}

async function runJob(job) {
  try {
    if (job.type === 'pull') {
      log(`Pulling book stock as of ${prettyDate(job.asOf)}...`);
      await pullAndSend(job.asOf, job.id);
    } else if (job.type === 'post') {
      await runPost(job);
    } else {
      await app('result', { jobId: job.id, status: 'error', result: { message: `Unknown job type ${job.type}` } });
    }
  } catch (e) {
    log(`Job ${job.type} failed:`, e.message);
    try { await app('result', { jobId: job.id, status: 'error', result: { message: e.message } }); }
    catch (e2) { log('Could not report the failure to the app:', e2.message); }
  }
}

/* ---------------- main loop ---------------- */

let lastAutoPull = 0;

async function checkIn() {
  const h = await tallyHealth();
  tally = { ok: h.ok, error: h.error, checkedAt: Date.now() };
  if (!h.ok) log(h.error);
  // Only take jobs when Tally answers; otherwise they stay queued in the app until it does.
  const r = await app('poll', { claim: h.ok });
  const jobs = Array.isArray(r.jobs) ? r.jobs : [];
  if (jobs.length) log(`${jobs.length} job(s) from the app.`);
  if (!h.ok && r.waiting) log(`${r.waiting} job(s) are waiting in the app. They will run once TallyPrime answers.`);
  for (const job of jobs) await runJob(job);
  const pulled = jobs.some(j => j.type === 'pull' || j.type === 'post');
  if (pulled) lastAutoPull = Date.now();
  if (tally.ok && !pulled && Date.now() - lastAutoPull >= CHECKIN_MS && r.autoPullAsOf) {
    try { await pullAndSend(r.autoPullAsOf, null); lastAutoPull = Date.now(); }
    catch (e) { log('Book stock refresh failed:', e.message); }
  }
  return r;
}

async function main() {
  const major = parseInt(process.versions.node.split('.')[0], 10);
  if (major < 18) {
    console.error(`Node.js 18 or newer is needed (this is ${process.versions.node}). Install the LTS version from https://nodejs.org`);
    process.exit(1);
  }
  try { cfg = loadConfig(); }
  catch (e) { console.error(e.message); process.exit(1); }

  log(`Cable Stock Take - Tally connector ${VERSION}`);
  log(`App: ${cfg.appUrl} | Tally: ${cfg.tallyUrl} | Company: ${cfg.company || '(company open in Tally)'} | Godown: ${cfg.godown}`);

  let signalUrl = null;
  let lastSeq = null;
  let lastCheckin = 0;
  let waitingForTally = false;
  for (;;) {
    let due = Date.now() - lastCheckin >= (signalUrl ? CHECKIN_MS : FALLBACK_MS);
    let seq = null;
    if (signalUrl) {
      seq = await readSignal(signalUrl);
      if (seq != null && seq !== lastSeq) due = true;
    }
    if (waitingForTally && !due) {
      // Jobs are waiting and Tally was down: check Tally locally, and check in as soon as it is back.
      const h = await tallyHealth();
      if (h.ok) { log('TallyPrime is answering again.'); due = true; }
    }
    if (due) {
      try {
        const r = await checkIn();
        lastCheckin = Date.now();
        waitingForTally = !tally.ok && Number(r.waiting) > 0;
        if (r.signalUrl && r.signalUrl !== signalUrl) {
          signalUrl = r.signalUrl;
          seq = await readSignal(signalUrl);
        }
        if (seq != null) lastSeq = seq;
      } catch (e) {
        log('Check-in failed:', e.message);
        lastCheckin = Date.now() - (signalUrl ? CHECKIN_MS : FALLBACK_MS) + 60 * 1000; // retry in about a minute
      }
    }
    if (ONCE) break;
    await sleep(cfg.pollSeconds * 1000);
  }
}

if (require.main === module) {
  main().catch(e => { console.error(e); process.exit(1); });
}

module.exports = { parseQty, cleanTally, xmlDecode, voucherXml: (p, f, c) => { cfg = Object.assign({}, DEFAULTS, c); return voucherXml(p, f); } };
