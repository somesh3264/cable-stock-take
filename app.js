(function(){
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  const S = { name:'', pin:'', ready:false, dbMissing:false, offline:false, loadError:'',
    counts:[], countsSig:'', countsLoaded:false, countId:null, lines:[], linesSig:'', editingId:null, filter:'', busy:false };
  const LS = {
    get(k){ try { return localStorage.getItem(k) || ''; } catch(e){ return ''; } },
    set(k,v){ try { localStorage.setItem(k, v); } catch(e){} }
  };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt = n => (n == null || !isFinite(n)) ? '–' : (Math.round(n*10)/10).toLocaleString('en-IN', {maximumFractionDigits:1});
  const round1 = n => Math.round(n*10)/10;
  const today = () => { const d = new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); };
  const prettyDate = s => { if(!s) return ''; const d = new Date(s+'T00:00:00'); return isNaN(d) ? s : d.toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'}); };
  const timeOf = ms => ms ? new Date(ms).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'}) : '';

  function docIdForTag(tag){
    const t = tag.trim().toUpperCase().replace(/\s+/g,'-').replace(/[^A-Z0-9_\-.~:@+]/g,'-').slice(0,120);
    return 'd_' + t;
  }
  function specLabel(l){
    const parts = [];
    const cs = [l.cores ? l.cores+'C' : '', l.size ? l.size+' mm²' : ''].filter(Boolean).join(' × ');
    if (cs) parts.push(cs);
    if (l.conductor) parts.push(l.conductor === 'Aluminium' ? 'Al' : 'Cu');
    if (l.insulation) parts.push(l.insulation);
    if (l.armour) parts.push(l.armour === 'Armoured' ? 'Arm.' : 'Unarm.');
    if (l.colour) parts.push(l.colour);
    return parts.join(' ') || 'Spec not set';
  }
  const isWireType = t => t === 'Flexible cable' || /^Wire/.test(t || '');
  const pieceQty = l => (l.pack === 'Coil' && l.qty > 1) ? l.qty : 1;
  const radio = name => { const el = document.querySelector('input[name="'+name+'"]:checked'); return el ? el.value : ''; };
  const setRadio = (name,val) => $$('input[name="'+name+'"]').forEach(r => { r.checked = (r.value === val); });
  const num = sel => { const v = parseFloat($(sel).value); return isFinite(v) ? v : null; };

  let toastT;
  function toast(msg){ const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(()=>t.classList.remove('show'), 2600); }

  const currentCount = () => S.counts.find(c => c.id === S.countId) || null;

  /* ---------- server ---------- */
  function ApiError(status, code, message){ const e = new Error(message || code); e.status = status; e.code = code; return e; }
  async function api(method, path, body){
    const headers = { 'Accept':'application/json' };
    if (body) headers['Content-Type'] = 'application/json';
    if (S.pin) headers['X-Count-Pin'] = S.pin;
    let r;
    try { r = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined, cache:'no-store' }); }
    catch(e){ throw ApiError(0, 'network', 'Can’t reach the server. Check your connection and try again.'); }
    let j = null; try { j = await r.json(); } catch(e){}
    if (!r.ok) throw ApiError(r.status, (j && j.error) || 'http', (j && j.message) || ('The server answered with an error ('+r.status+').'));
    return j || {};
  }
  async function loadCounts(){
    const j = await api('GET', '/api/counts');
    S.dbMissing = false; S.offline = false; S.loadError = '';
    S.countsLoaded = true;
    const sig = JSON.stringify(j.counts || []);
    if (sig !== S.countsSig){ S.countsSig = sig; S.counts = j.counts || []; }
    if (!S.countId || !S.counts.find(c => c.id === S.countId)){
      const saved = LS.get('cst.count');
      const pick = S.counts.find(c => c.id === saved) || S.counts.find(c => c.status !== 'closed') || S.counts[0];
      setCount(pick ? pick.id : null);
    }
  }
  async function loadLines(){
    const id = S.countId; if (!id) return;
    const j = await api('GET', '/api/lines?count='+encodeURIComponent(id));
    if (S.countId !== id) return;
    const sig = JSON.stringify(j.lines || []);
    if (sig !== S.linesSig){ S.linesSig = sig; S.lines = j.lines || []; }
  }
  function handleLoadErr(e){
    if (e.status === 401){ S.ready = false; showGate(true, S.pin ? 'That PIN was not accepted. Check it with the store in-charge.' : ''); return; }
    if (e.code === 'no_db'){ S.dbMissing = true; S.countsLoaded = true; return; }
    if (e.code === 'network'){ S.offline = true; return; }
    S.loadError = e.message;
  }
  async function refresh(){
    if (S.busy || !S.ready) return;
    S.busy = true;
    try { await loadCounts(); await loadLines(); }
    catch(e){ handleLoadErr(e); }
    finally { S.busy = false; renderAll(); }
  }
  setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, 12000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(); });
  window.addEventListener('online', refresh);

  /* ---------- who is counting ---------- */
  function showGate(needPin, msg){
    $('#app').hidden = true; $('#gate').hidden = false;
    $('#gName').value = S.name;
    if (needPin) $('#gPinBox').hidden = false;
    const e = $('#gErr'); e.hidden = !msg; e.textContent = msg || '';
    (S.name ? (needPin ? $('#gPin') : $('#gName')) : $('#gName')).focus();
  }
  function showApp(){
    $('#gate').hidden = true; $('#app').hidden = false;
    $('#who').hidden = !S.name; $('#whoName').textContent = S.name;
  }
  $('#gate').addEventListener('submit', async e => {
    e.preventDefault();
    const name = $('#gName').value.trim();
    const err = $('#gErr');
    if (!name){ err.hidden = false; err.textContent = 'Enter your name so each entry shows who counted it.'; return; }
    if (!$('#gPinBox').hidden){ S.pin = $('#gPin').value.trim(); }
    S.name = name; LS.set('cst.name', name);
    const btn = $('#gSubmit'); btn.disabled = true;
    try {
      await loadCounts();
      LS.set('cst.pin', S.pin);
      S.ready = true; showApp();
      await loadLines();
    } catch(x){
      if (x.status === 401){ $('#gPinBox').hidden = false; err.hidden = false; err.textContent = S.pin ? 'That PIN was not accepted. Check it with the store in-charge.' : 'Enter the team PIN to open the count.'; return; }
      handleLoadErr(x); S.ready = true; showApp();
    } finally { btn.disabled = false; renderAll(); }
  });
  $('#whoChange').addEventListener('click', () => showGate(!$('#gPinBox').hidden, ''));

  /* ---------- access ---------- */
  function blockReason(){
    if (S.dbMissing) return 'The database isn’t connected yet. In Vercel, open this project, go to Storage, connect a Neon database, then redeploy.';
    if (!S.countsLoaded) return null;
    if (!S.countId) return 'Start a count first with New count.';
    const c = currentCount();
    if (c && c.status === 'closed') return 'This count is closed. Reopen it from Summary to add more.';
    return null;
  }
  function renderAccess(){
    const r = blockReason();
    const n = $('#notice');
    if (r){ n.hidden = false; n.innerHTML = '<strong>Saving is off.</strong> ' + esc(r); }
    else if (S.offline){ n.hidden = false; n.innerHTML = '<strong>Offline.</strong> The server can’t be reached. New entries won’t save until the connection is back.'; }
    else if (S.loadError){ n.hidden = false; n.innerHTML = '<strong>Problem.</strong> ' + esc(S.loadError); }
    else n.hidden = true;
    const off = !!r || !S.countsLoaded;
    $('#formFields').disabled = off;
    $('#saveBtn').disabled = off;
    $('#newCountBtn').disabled = S.dbMissing || !S.countsLoaded;
  }

  /* ---------- counts ---------- */
  function renderCounts(){
    const sel = $('#countSel');
    if (!S.countsLoaded) return;
    sel.disabled = S.counts.length === 0;
    sel.innerHTML = S.counts.length ? S.counts.map(c => '<option value="'+esc(c.id)+'">'+esc(c.name || 'Untitled count')+(c.status==='closed'?' (closed)':'')+'</option>').join('') : '<option>No counts yet</option>';
    if (S.countId) sel.value = S.countId;
    const c = currentCount();
    const meta = $('#countMeta');
    if (c){
      const m = S.lines.reduce((a,l)=>a+(l.lengthM||0),0);
      meta.innerHTML = [c.site ? esc(c.site) : '', c.date ? esc(prettyDate(c.date)) : '',
        '<span class="pill '+(c.status==='closed'?'closed':'open')+'">'+(c.status==='closed'?'Closed':'Open')+'</span>',
        S.lines.length ? fmt(S.lines.length)+' logged · '+fmt(m)+' m' : ''].filter(Boolean).join(' · ');
    } else meta.textContent = S.dbMissing ? '' : 'Create a count for the store or site you are checking, then log each drum as you go.';
  }
  function setCount(id){
    if (S.countId === id) return false;
    S.countId = id; LS.set('cst.count', id || '');
    S.lines = []; S.linesSig = ''; cancelEdit(true);
    return true;
  }
  $('#countSel').addEventListener('change', async e => {
    if (setCount(e.target.value)){ renderAll(); try { await loadLines(); } catch(x){ handleLoadErr(x); } renderAll(); }
  });
  $('#newCountBtn').addEventListener('click', () => {
    const f = $('#newCountForm'); f.hidden = !f.hidden;
    if (!f.hidden){
      const d = new Date();
      if (!$('#ncName').value) $('#ncName').value = 'Stock take ' + d.toLocaleDateString('en-IN',{month:'short',year:'numeric'});
      if (!$('#ncDate').value) $('#ncDate').value = today();
      $('#ncName').focus();
    }
  });
  $('#ncCancel').addEventListener('click', () => { $('#newCountForm').hidden = true; $('#ncErr').hidden = true; });
  $('#newCountForm').addEventListener('submit', async e => {
    e.preventDefault();
    const name = $('#ncName').value.trim();
    const err = $('#ncErr');
    if (!name){ err.hidden = false; err.textContent = 'Give the count a name so others can find it.'; return; }
    err.hidden = true;
    const btn = $('#ncSubmit'); btn.disabled = true;
    try {
      const j = await api('POST', '/api/counts', { name, site: $('#ncSite').value.trim(), date: $('#ncDate').value || today(), by: S.name });
      $('#newCountForm').hidden = true; $('#ncName').value = ''; $('#ncSite').value = '';
      setCount(j.id);
      await loadCounts(); await loadLines();
      switchTab('count'); toast('Count created');
    } catch(x){ handleWriteErr(x, err); }
    finally { btn.disabled = false; renderAll(); }
  });

  /* ---------- form ---------- */
  function computeLength(){
    if (radio('method') === 'marks'){
      const a = num('#markOuter'), b = num('#markInner');
      return (a != null && b != null) ? round1(Math.abs(a - b)) : null;
    }
    const v = num('#lengthM'); return v == null ? null : round1(v);
  }
  function qtyVal(){
    if (radio('pack') !== 'Coil') return 1;
    const v = parseInt($('#qty').value, 10);
    return v > 0 ? v : 1;
  }
  function updatePackUI(){
    const coil = radio('pack') === 'Coil';
    $('#qtyBox').hidden = !coil;
    $('#lengthLbl').textContent = coil ? 'Length per coil (m)' : 'Remaining length (m)';
    $('#origLbl').textContent = coil ? 'Full coil length (m)' : 'Full drum length (m)';
    $('#origM').placeholder = coil ? '90' : '500';
    $('#lengthM').placeholder = coil ? '90' : '312';
    $('#colourBox').hidden = !isWireType($('#ctype').value);
    updateLengthUI();
  }
  function updateLengthUI(){
    const m = radio('method');
    $('#marksBox').hidden = m !== 'marks';
    $('#lenBox').hidden = m === 'marks';
    const L = computeLength(), o = num('#origM'), q = qtyVal();
    const unit = radio('pack') === 'Coil' ? 'coil' : 'drum';
    $('#lenOut').textContent = L != null ? fmt(round1(L*q))+' m' : '–';
    let note = '';
    if (L != null && q > 1) note = q+' coils × '+fmt(L)+' m';
    else if (L != null && o) note = Math.round(L/o*100)+'% of the '+fmt(o)+' m '+unit+' left';
    else if (m === 'marks') note = 'Remaining = outer mark minus inner mark';
    $('#pctOut').textContent = note;
    const w = $('#lenWarn');
    if (L != null && o && L > o){ w.hidden = false; w.textContent = 'Length is more than the full '+unit+' length. Check the reading or the label.'; }
    else w.hidden = true;
  }
  ['#markOuter','#markInner','#lengthM','#origM','#qty'].forEach(s => $(s).addEventListener('input', updateLengthUI));
  $$('input[name="method"]').forEach(r => r.addEventListener('change', updateLengthUI));
  $$('input[name="pack"]').forEach(r => r.addEventListener('change', updatePackUI));
  $('#ctype').addEventListener('change', () => {
    const t = $('#ctype').value;
    if (isWireType(t) && !S.editingId){
      if (radio('pack') === 'Drum') setRadio('pack','Coil');
      if (!$('#cores').value && /^Wire/.test(t)) $('#cores').value = '1';
      if (radio('method') === 'marks' && !$('#markOuter').value && !$('#markInner').value) setRadio('method','label');
    }
    if (!isWireType(t)) setRadio('colour','');
    updatePackUI();
  });

  function checkDup(){
    const tag = $('#tag').value.trim(), box = $('#dupNote');
    if (!tag){ box.hidden = true; return; }
    const id = docIdForTag(tag);
    if (S.editingId === id){ box.hidden = true; return; }
    const hit = S.lines.find(l => l.id === id);
    if (hit){ box.hidden = false; box.textContent = hit.tag+' is already counted ('+fmt(hit.lengthM)+' m'+(hit.location ? ', '+hit.location : '')+'). Saving will replace that entry.'; }
    else box.hidden = true;
  }
  $('#tag').addEventListener('input', checkDup);

  function readForm(){
    const per = computeLength(), q = qtyVal(), type = $('#ctype').value;
    return {
      tag: $('#tag').value.trim().toUpperCase(),
      pack: radio('pack'), qty: q, type: type, conductor: radio('conductor'),
      cores: $('#cores').value.trim(), size: $('#size').value.trim(), armour: radio('armour'),
      insulation: $('#insul').value, make: $('#make').value.trim(),
      colour: isWireType(type) ? radio('colour') : '',
      method: radio('method'), markOuter: num('#markOuter'), markInner: num('#markInner'),
      perM: per, lengthM: per == null ? null : round1(per * q), origM: num('#origM'),
      location: $('#loc').value.trim(), condition: radio('condition') || 'Good',
      remarks: $('#remarks').value.trim()
    };
  }
  function fillForm(l){
    $('#tag').value = l.tag || ''; setRadio('pack', l.pack || 'Drum'); $('#ctype').value = l.type || '';
    setRadio('conductor', l.conductor || ''); $('#cores').value = l.cores || ''; $('#size').value = l.size || '';
    setRadio('armour', l.armour || ''); $('#insul').value = l.insulation || ''; $('#make').value = l.make || '';
    setRadio('colour', l.colour || ''); $('#qty').value = l.qty > 1 ? l.qty : '';
    setRadio('method', l.method || 'measured');
    $('#markOuter').value = l.markOuter != null ? l.markOuter : ''; $('#markInner').value = l.markInner != null ? l.markInner : '';
    const per = l.perM != null ? l.perM : l.lengthM;
    $('#lengthM').value = (l.method !== 'marks' && per != null) ? per : '';
    $('#origM').value = l.origM != null ? l.origM : '';
    $('#loc').value = l.location || ''; setRadio('condition', l.condition || 'Good'); $('#remarks').value = l.remarks || '';
    updatePackUI(); checkDup();
  }
  function clearAfterSave(keepSpec){
    ['#tag','#qty','#markOuter','#markInner','#lengthM','#origM','#remarks'].forEach(s => $(s).value = '');
    setRadio('condition','Good');
    if (!keepSpec){
      $('#ctype').value = ''; setRadio('conductor',''); $('#cores').value = ''; $('#size').value = '';
      setRadio('armour',''); $('#insul').value = ''; $('#make').value = ''; $('#loc').value = '';
      setRadio('colour',''); setRadio('pack','Drum'); setRadio('method','marks');
    }
    $('#formErr').hidden = true; updatePackUI(); checkDup();
  }
  function startEdit(id){
    const l = S.lines.find(x => x.id === id); if (!l) return;
    S.editingId = id; fillForm(l);
    $('#editBar').hidden = false; $('#editTag').textContent = l.tag;
    $('#saveBtn').textContent = 'Save changes';
    switchTab('count'); window.scrollTo({top:0, behavior:'smooth'});
  }
  function cancelEdit(silent){
    if (!S.editingId && silent) return;
    S.editingId = null; $('#editBar').hidden = true; $('#saveBtn').textContent = 'Save entry';
    if (!silent) clearAfterSave(false);
  }
  $('#editCancel').addEventListener('click', () => cancelEdit(false));

  function handleWriteErr(x, box){
    let msg = x.message || 'Could not save. Try again.';
    if (x.status === 401){ msg = 'The team PIN was not accepted. Enter it again to keep saving.'; S.ready = false; showGate(true, msg); }
    if (x.status === 409 || x.status === 404) refresh();
    box.hidden = false; box.textContent = msg; renderAccess();
  }

  $('#lineForm').addEventListener('submit', async e => {
    e.preventDefault();
    if (blockReason()) return;
    const d = readForm(), err = $('#formErr');
    const missing = [];
    if (!d.tag) missing.push('tag no.');
    if (!d.type) missing.push('cable type');
    if (!d.size) missing.push('size');
    if (d.lengthM == null) missing.push(d.method === 'marks' ? 'both sheath marks' : 'length');
    if (missing.length){ err.hidden = false; err.textContent = 'Fill in ' + missing.join(', ') + ' before saving.'; return; }
    if (d.lengthM < 0){ err.hidden = false; err.textContent = 'Length cannot be negative.'; return; }
    const qraw = $('#qty').value.trim();
    if (d.pack === 'Coil' && qraw && !(/^\d+$/.test(qraw) && +qraw > 0)){ err.hidden = false; err.textContent = 'Number of coils must be a whole number, like 12.'; return; }
    err.hidden = true;
    const id = docIdForTag(d.tag);
    d.by = S.name;
    const editing = S.editingId;
    const btn = $('#saveBtn'); btn.disabled = true;
    try {
      const j = await api('PUT', '/api/lines?count='+encodeURIComponent(S.countId)+'&id='+encodeURIComponent(id),
        { data: d, replaces: (editing && editing !== id) ? editing : undefined });
      const saved = j.line || Object.assign({ id }, d);
      S.lines = [saved].concat(S.lines.filter(l => l.id !== id && l.id !== editing)); S.linesSig = '';
      toast((editing ? 'Updated ' : 'Saved ') + d.tag + ' · ' + fmt(d.lengthM) + ' m');
      cancelEdit(true);
      clearAfterSave(editing ? false : $('#keepSpec').checked);
      renderAll();
      $('#tag').focus();
    } catch(x){ handleWriteErr(x, err); }
    finally { btn.disabled = false; renderAccess(); }
  });

  /* ---------- entries ---------- */
  $('#filter').addEventListener('input', e => { S.filter = e.target.value; renderEntries(); });
  function renderEntries(){
    const q = S.filter.trim().toLowerCase();
    const rows = S.lines.filter(l => !q || [l.tag, specLabel(l), l.type, l.location, l.make, l.condition, l.by].join(' ').toLowerCase().includes(q));
    const canAct = !blockReason();
    $('#entryList').innerHTML = rows.map(l => {
      const flag = l.condition && l.condition !== 'Good' ? '<span class="flag">'+esc(l.condition)+'</span>' : '';
      return '<li class="entry">'+
        '<span class="e-tag">'+esc(l.tag)+'</span><span class="e-len">'+fmt(l.lengthM)+' m</span>'+
        '<span class="e-spec">'+esc(specLabel(l))+' <span class="t">· '+esc(l.type || '')+(l.make ? ' · '+esc(l.make) : '')+'</span></span>'+
        '<span class="e-meta"><span>'+(pieceQty(l) > 1 ? esc(pieceQty(l)+' coils × '+fmt(l.perM)+' m') : esc(l.pack || 'Drum'))+'</span><span>'+esc(l.location || 'No location')+'</span>'+
          (l.by ? '<span>'+esc(l.by)+'</span>' : '')+'<span>'+esc(timeOf(l.at))+'</span>'+flag+'</span>'+
        (canAct ? '<span class="e-act"><button type="button" class="btn small" data-edit="'+esc(l.id)+'">Edit</button><button type="button" class="btn small danger" data-del="'+esc(l.id)+'">Delete</button></span>' : '')+
      '</li>';
    }).join('');
    const empty = $('#entriesEmpty');
    empty.hidden = rows.length > 0;
    if (!rows.length && S.lines.length){ empty.querySelector('h3').textContent = 'No matches'; empty.querySelector('p').textContent = 'Nothing logged matches “'+S.filter+'”. Try a tag, a size like 95, or a location.'; }
    else if (!rows.length){ empty.querySelector('h3').textContent = 'Nothing logged yet'; empty.querySelector('p').textContent = 'Each drum or coil you save on the Count tab appears here with its length, location and who counted it.'; }
  }
  $('#entryList').addEventListener('click', async e => {
    const ed = e.target.closest('[data-edit]'); if (ed){ startEdit(ed.dataset.edit); return; }
    const del = e.target.closest('[data-del]'); if (!del) return;
    if (!del.hasAttribute('data-armed')){
      del.setAttribute('data-armed',''); del.textContent = 'Tap again to delete';
      setTimeout(() => { if (del.isConnected){ del.removeAttribute('data-armed'); del.textContent = 'Delete'; } }, 3500);
      return;
    }
    del.disabled = true;
    const id = del.dataset.del;
    try {
      await api('DELETE', '/api/lines?count='+encodeURIComponent(S.countId)+'&id='+encodeURIComponent(id));
      S.lines = S.lines.filter(l => l.id !== id); S.linesSig = '';
      toast('Entry deleted');
      if (S.editingId === id) cancelEdit(false);
      renderAll();
    } catch(x){ toast(x.status === 409 ? 'This count is closed.' : 'Could not delete. Try again.'); del.disabled = false; }
  });

  /* ---------- summary ---------- */
  function renderSummary(){
    const L = S.lines;
    const drums = L.filter(l => (l.pack || 'Drum') === 'Drum').length;
    const coils = L.filter(l => l.pack === 'Coil').reduce((a,l) => a + pieceQty(l), 0);
    const cuts = L.filter(l => l.pack === 'Cut length').length;
    const total = L.reduce((a,l) => a + (l.lengthM || 0), 0);
    const flagged = L.filter(l => l.condition && l.condition !== 'Good').length;
    $('#kPieces').textContent = fmt(drums + coils + cuts);
    const bits = [drums ? drums+' drums' : '', coils ? coils+' coils' : '', cuts ? cuts+' cuts' : ''].filter(Boolean);
    $('#kPiecesL').textContent = bits.length > 1 ? bits.join(', ') : coils ? 'coils counted' : cuts ? 'cut lengths counted' : 'drums counted';
    $('#kMetres').textContent = fmt(total);
    $('#kFlag').textContent = fmt(flagged);

    const groups = new Map();
    L.forEach(l => {
      const key = [l.type, l.conductor, l.cores, l.size, l.armour, l.insulation, l.colour].join('|');
      if (!groups.has(key)) groups.set(key, {spec: specLabel(l), type: l.type, drums:0, other:0, m:0});
      const g = groups.get(key);
      if ((l.pack || 'Drum') === 'Drum') g.drums++; else g.other += pieceQty(l);
      g.m += l.lengthM || 0;
    });
    const gs = Array.from(groups.values()).sort((a,b) => b.m - a.m);
    $('#specBody').innerHTML = gs.length ? gs.map(g => '<tr><td><span class="sp">'+esc(g.spec)+'</span><span class="ty">'+esc(g.type || '')+'</span></td><td class="num">'+fmt(g.drums)+'</td><td class="num">'+fmt(g.other)+'</td><td class="num">'+fmt(g.m)+'</td></tr>').join('')
      : '<tr><td colspan="4" style="color:var(--muted)">Totals by cable size appear once entries are logged.</td></tr>';
    $('#specFoot').innerHTML = gs.length ? '<tr><td>Total</td><td class="num">'+fmt(drums)+'</td><td class="num">'+fmt(coils + cuts)+'</td><td class="num">'+fmt(total)+'</td></tr>' : '';

    const locs = new Map();
    L.forEach(l => { const k = l.location || 'No location'; const g = locs.get(k) || {n:0,m:0}; g.n += pieceQty(l); g.m += l.lengthM || 0; locs.set(k,g); });
    const ls = Array.from(locs.entries()).sort((a,b) => a[0].localeCompare(b[0], 'en', {numeric:true}));
    $('#locBody').innerHTML = ls.length ? ls.map(([k,g]) => '<tr><td>'+esc(k)+'</td><td class="num">'+fmt(g.n)+'</td><td class="num">'+fmt(g.m)+'</td></tr>').join('')
      : '<tr><td colspan="3" style="color:var(--muted)">Locations appear once entries are logged.</td></tr>';

    const c = currentCount();
    const cb = $('#closeBtn');
    cb.hidden = !c;
    if (c) cb.textContent = c.status === 'closed' ? 'Reopen this count' : 'Close this count';
    $('#exportBtn').hidden = !c;
    $('#exportBtn').disabled = !L.length;
  }
  $('#closeBtn').addEventListener('click', async () => {
    const c = currentCount(); if (!c) return;
    const closing = c.status !== 'closed';
    const cb = $('#closeBtn'); cb.disabled = true;
    try { await api('PATCH', '/api/counts?id='+encodeURIComponent(c.id), { status: closing ? 'closed' : 'open', by: S.name }); toast(closing ? 'Count closed' : 'Count reopened'); await loadCounts(); }
    catch(x){ toast('Could not update the count. Try again.'); }
    finally { cb.disabled = false; renderAll(); }
  });

  function csvCell(v){ const s = v == null ? '' : String(v); return /[",\n\r]/.test(s) ? '"'+s.replace(/"/g,'""')+'"' : s; }
  $('#exportBtn').addEventListener('click', () => {
    const c = currentCount() || {};
    const head = ['Tag','Package','Pieces','Cable type','Spec','Conductor','Cores','Size (sq mm)','Armour','Insulation','Colour','Make','Length method','Outer mark (m)','Inner mark (m)','Length per piece (m)','Total metres','Full drum/coil length (m)','Location','Condition','Remarks','Counted by','Counted at'];
    const methodL = {marks:'Sheath marks', label:'From label', measured:'Measured', estimated:'Estimated'};
    const rows = S.lines.slice().sort((a,b) => (a.tag||'').localeCompare(b.tag||'', 'en', {numeric:true})).map(l => [
      l.tag, l.pack, pieceQty(l), l.type, specLabel(l), l.conductor, l.cores, l.size, l.armour, l.insulation, l.colour, l.make, methodL[l.method] || l.method,
      l.markOuter, l.markInner, l.perM != null ? l.perM : l.lengthM, l.lengthM, l.origM, l.location, l.condition, l.remarks,
      l.by || '', l.at ? new Date(l.at).toLocaleString('en-IN') : ''
    ]);
    const csv = '\ufeff' + [head].concat(rows).map(r => r.map(csvCell).join(',')).join('\r\n');
    const slug = (c.name || 'cable-count').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
    const url = URL.createObjectURL(new Blob([csv], { type:'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = slug + '.csv';
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1500);
    toast('CSV downloaded');
  });

  /* ---------- tabs ---------- */
  function switchTab(name){
    ['count','entries','summary'].forEach(t => {
      $('#tab-'+t).hidden = t !== name;
      $('#tabbtn-'+t).setAttribute('aria-selected', String(t === name));
    });
  }
  ['count','entries','summary'].forEach(t => $('#tabbtn-'+t).addEventListener('click', () => switchTab(t)));

  function fillDatalists(){
    const uniq = k => Array.from(new Set(S.lines.map(l => l[k]).filter(Boolean))).sort();
    $('#makeList').innerHTML = uniq('make').map(v => '<option value="'+esc(v)+'"></option>').join('');
    $('#locList').innerHTML = uniq('location').map(v => '<option value="'+esc(v)+'"></option>').join('');
  }

  function renderAll(){
    renderCounts(); renderAccess();
    $('#nEntries').textContent = S.lines.length;
    renderEntries(); renderSummary(); fillDatalists(); checkDup();
    if (S.ready && S.countsLoaded && !S.counts.length && !S.dbMissing && !S.autoOpened && $('#newCountForm').hidden){ S.autoOpened = true; $('#newCountBtn').click(); }
  }

  updatePackUI();
  renderAccess();

  /* ---------- boot ---------- */
  (async function boot(){
    S.name = LS.get('cst.name'); S.pin = LS.get('cst.pin');
    try {
      await loadCounts();
      if (!S.name){ showGate(false, ''); return; }
      S.ready = true; showApp();
      await loadLines();
    } catch(e){
      if (e.status === 401){ showGate(true, S.pin ? 'That PIN was not accepted. Check it with the store in-charge.' : ''); return; }
      handleLoadErr(e);
      if (!S.name){ showGate(false, ''); return; }
      S.ready = true; showApp();
    } finally { renderAll(); }
  })();
})();
