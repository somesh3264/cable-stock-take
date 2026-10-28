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
    const csv = String.fromCharCode(0xFEFF) + [head].concat(rows).map(r => r.map(csvCell).join(',')).join('\r\n');
    const slug = (c.name || 'cable-count').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
    const url = URL.createObjectURL(new Blob([csv], { type:'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = slug + '.csv';
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1500);
    toast('CSV downloaded');
  });

  /* ---------- tally ---------- */
  // groupKey, unitBasis and buildEntries mirror api/_lib/tally.js; keep them identical.
  const T = { data: null, loading: false, dirty: new Map(), suggested: new Set(), timer: null, armTimer: null, renderedLines: null, err: '' };
  const tnorm = v => String(v == null ? '' : v).trim().toLowerCase();
  function groupKey(l){
    const len = l.pack === 'Coil' ? (l.origM != null ? l.origM : l.perM) : '';
    return [l.make, l.type, l.conductor, l.cores, l.size, l.insulation, l.colour, len == null ? '' : len].map(tnorm).join('|');
  }
  const METRE_U = new Set(['m','mt','mts','mtr','mtrs','meter','meters','metre','metres','rmt','rm','lm','rmtr']);
  const WEIGHT_U = new Set(['kg','kgs','g','gm','gms','gram','grams','ton','tons','tonne','tonnes','qtl','mg']);
  function unitBasis(u){
    const s = tnorm(u).replace(/[^a-z]/g,'');
    if (!s) return 'count';
    if (METRE_U.has(s)) return 'metres';
    if (WEIGHT_U.has(s)) return 'weight';
    return 'count';
  }
  function tallyGroups(){
    const m = new Map();
    S.lines.forEach(l => { const k = groupKey(l); if (!m.has(k)) m.set(k, { key:k, sample:l, lines:[] }); m.get(k).lines.push(l); });
    return Array.from(m.values()).map(g => Object.assign(g, {
      rolls: g.lines.reduce((a,l) => a + pieceQty(l), 0),
      metres: Math.round(g.lines.reduce((a,l) => a + (Number(l.lengthM) || 0), 0) * 1000) / 1000
    })).sort((a,b) => (a.sample.make||'').localeCompare(b.sample.make||'') || (parseFloat(a.sample.size)||0) - (parseFloat(b.sample.size)||0) || (a.sample.colour||'').localeCompare(b.sample.colour||''));
  }
  function buildEntries(maps){
    const items = (T.data && T.data.snapshot && T.data.snapshot.items) || [];
    const byName = new Map(items.map(i => [i.name, i]));
    const mapByKey = new Map(maps.map(m => [m.key, m.item]));
    const entries = new Map(); let unmatched = 0; const problems = [];
    tallyGroups().forEach(g => {
      const name = mapByKey.get(g.key);
      if (!name){ unmatched++; return; }
      const it = byName.get(name);
      if (!it){ problems.push(name); return; }
      const basis = unitBasis(it.unit);
      if (basis === 'weight'){ problems.push(name); return; }
      const e = entries.get(name) || { item:name, unit:it.unit, basis, qty:0, book:it.qty };
      e.qty += basis === 'metres' ? g.metres : g.rolls;
      entries.set(name, e);
    });
    return { entries: Array.from(entries.values()).map(e => Object.assign(e, { qty: Math.round(e.qty*1000)/1000 })), unmatched, problems };
  }

  // Suggest a Tally item for a cable from its make, size, colour, cores and conductor.
  const COLOUR_WORDS = ['red','yellow','blue','black','green','grey','gray','white','brown','orange'];
  function itemTokens(name){
    const lower = name.toLowerCase();
    const raw = ' ' + lower.replace(/[^a-z0-9.\/]+/g,' ') + ' ';
    // Cores ("4 Core", "3C", "3C x 4", "4 x 2.5") are taken out first so they are not read as the size.
    let cores = null, rest = lower;
    const cm = /(^|[^0-9.])(\d+)\s*(?:cores?|c)(?=x|[^a-z]|$)/.exec(lower);
    if (cm){ cores = Number(cm[2]); rest = lower.slice(0, cm.index) + cm[1] + ' ' + lower.slice(cm.index + cm[0].length); }
    else {
      const xm = /(^|[^0-9.])(\d+)\s*[x×*]\s*(?=\d)/.exec(lower);
      if (xm){ cores = Number(xm[2]); rest = lower.slice(0, xm.index) + xm[1] + ' ' + lower.slice(xm.index + xm[0].length); }
    }
    const nums = (rest.match(/\d+(?:\.\d+)?/g) || []).map(Number);
    return { raw, nums, cores, colours: COLOUR_WORDS.filter(c => raw.indexOf(' '+c+' ') >= 0 || raw.indexOf(' '+c+'/') >= 0) };
  }
  const hasW = (t, ws) => ws.some(w => t.raw.indexOf(' '+w+' ') >= 0);
  function scoreItem(l, t, makeUsed){
    const size = parseFloat(l.size);
    if (!isFinite(size) || t.nums.indexOf(size) < 0) return -99;
    let s = 4;
    const make = tnorm(l.make).split(/\s+/)[0];
    // A missing make only counts against an item when Tally names other items with that make.
    if (make){ if (hasW(t, [make])) s += 3; else if (makeUsed(make)) s -= 3; }
    const cols = tnorm(l.colour).split(/[-\s/]+/).filter(Boolean).map(c => c === 'gray' ? 'grey' : c);
    const itemCols = t.colours.map(c => c === 'gray' ? 'grey' : c);
    if (cols.length){
      if (cols.every(c => itemCols.indexOf(c) >= 0)) s += 3;
      if (itemCols.some(c => cols.indexOf(c) < 0)) s -= 4;
    } else if (itemCols.length) s -= 1;
    const gc = parseFloat(l.cores);
    if (isFinite(gc) && gc > 1){ if (t.cores === gc) s += 3; else if (t.cores) s -= 5; else s -= 1; }
    else if (t.cores && t.cores > 1) s -= 4;
    const cond = tnorm(l.conductor);
    const itemAlu = hasW(t, ['al','alu','aluminium','aluminum']);
    if (/^al/.test(cond)) s += itemAlu ? 2 : -1; else if (cond && itemAlu) s -= 3;
    if (l.type === 'Flexible cable' && hasW(t, ['flex','flexible'])) s += 1;
    if (l.type === 'Solar DC' && hasW(t, ['dc','solar'])) s += 2;
    const ins = tnorm(l.insulation);
    if (ins && hasW(t, [ins, ins + 'h'])) s += 1;
    const len = l.pack === 'Coil' ? Number(l.origM != null ? l.origM : l.perM) : NaN;
    if (isFinite(len) && len > 0 && t.nums.indexOf(len) >= 0) s += 1;
    return s;
  }
  function suggestFor(g, toks, makeUsed){
    let best = null, bestS = -99, second = -99;
    toks.forEach(t => { const s = scoreItem(g.sample, t.t, makeUsed); if (s > bestS){ second = bestS; bestS = s; best = t.name; } else if (s > second) second = s; });
    return (best && bestS >= 5 && bestS > second) ? best : '';
  }

  const ago = ms => { const s = Math.max(0, (Date.now() - ms) / 1000); if (s < 60) return 'just now'; if (s < 3600) return Math.round(s/60) + ' min ago'; if (s < 86400) return Math.round(s/3600) + ' h ago'; return new Date(ms).toLocaleDateString('en-IN', { day:'numeric', month:'short' }); };
  const fmtQ = n => (n == null || !isFinite(n)) ? '–' : (Math.round(n*1000)/1000).toLocaleString('en-IN', { maximumFractionDigits: 3 });

  async function loadTally(){
    if (T.loading || !S.ready) return;
    T.loading = true;
    try {
      const d = await api('GET', '/api/tally');
      const firstLoad = !T.data;
      T.data = d; T.err = '';
      if (firstLoad || T.dirty.size === 0) applySuggestions();
    } catch(e){
      if (e.status === 401){ handleLoadErr(e); }
      T.err = e.message;
    } finally {
      T.loading = false;
      renderTally();
      scheduleTally();
    }
  }
  function scheduleTally(){
    clearTimeout(T.timer);
    const busy = T.data && T.data.jobs.some(j => j.status === 'queued' || j.status === 'running');
    if (busy && !$('#tab-tally').hidden) T.timer = setTimeout(() => { if (document.visibilityState === 'visible') loadTally(); else scheduleTally(); }, 8000);
  }
  function savedMaps(){ return (T.data && T.data.maps) || []; }
  function applySuggestions(){
    const items = (T.data && T.data.snapshot && T.data.snapshot.items) || [];
    if (!items.length) return;
    const saved = new Map(savedMaps().map(m => [m.key, m.item]));
    const toks = items.map(i => ({ name: i.name, t: itemTokens(i.name) }));
    const makeSeen = new Map();
    const makeUsed = m => { if (!makeSeen.has(m)) makeSeen.set(m, toks.some(x => hasW(x.t, [m]))); return makeSeen.get(m); };
    tallyGroups().forEach(g => {
      if (saved.has(g.key) || T.dirty.has(g.key)) return;
      const s = suggestFor(g, toks, makeUsed);
      if (s){ T.dirty.set(g.key, s); T.suggested.add(g.key); }
    });
  }

  function agentState(){
    const d = T.data;
    if (!d) return { dot:'', title: T.err ? 'Could not load Tally sync status' : 'Checking the Tally connection…', sub: T.err || '' };
    if (!d.configured) return { dot:'', title:'Tally sync isn’t switched on for this app yet', sub:'The sync key has to be added to the app’s settings first.' };
    const a = d.agent;
    if (!a || !a.lastSeen) return { dot:'', title:'Tally connector not set up yet', sub:'Book stock and posting start working once the connector checks in.', setup:true };
    const online = Date.now() - a.lastSeen < 75*60*1000;
    if (!online) return { dot:'bad', title:'Tally connector is offline', sub:'Last check-in ' + ago(a.lastSeen) + '. Start it on the Tally PC. Waiting jobs run when it is back.' };
    if (!a.tallyOk) return { dot:'warn', title:'Connector is running but can’t reach TallyPrime', sub: (a.tallyError || 'Open TallyPrime and load the company.') + ' Checked ' + ago(a.tallyCheckedAt || a.lastSeen) + '.' };
    return { dot:'ok', title:'Connected to TallyPrime' + (a.company ? ' · ' + a.company : ''), sub:'Last check-in ' + ago(a.lastSeen) + '. It checks for work within about a minute.' };
  }

  function rowNote(g, val, items){
    const it = items.get(val);
    if (!val) return { cls:'', text:'Not matched yet' };
    if (!it) return { cls:'warn', text:'Not in Tally’s item list. Pick a name from the suggestions.' };
    const basis = unitBasis(it.unit);
    if (basis === 'weight') return { cls:'warn', text:'Tally counts this item by weight (' + it.unit + '), so it can’t be posted from a cable count.' };
    const qty = basis === 'metres' ? g.metres : g.rolls;
    const saved = new Map(savedMaps().map(m => [m.key, m.item])).get(g.key) || '';
    const pre = (T.suggested.has(g.key) && val !== saved) ? 'Suggested match. ' : (val !== saved ? 'Not saved yet. ' : '');
    return { cls: pre.indexOf('Suggested') === 0 ? 'sug' : (pre ? '' : 'ok'), text: pre + 'Counts as ' + fmtQ(qty) + ' ' + (it.unit || '') + ' (Tally unit ' + (it.unit || 'not set') + ').' };
  }

  function renderTally(){
    T.renderedLines = S.lines;
    const d = T.data, c = currentCount();
    const st = agentState();
    $('#tDot').className = 'tdot ' + (st.dot || '');
    $('#tAgent').textContent = st.title;
    $('#tAgentSub').textContent = st.sub || '';
    $('#tSetup').hidden = !st.setup;
    const snap = d && d.snapshot;
    const items = (snap && snap.items) || [];
    const itemMap = new Map(items.map(i => [i.name, i]));
    if (snap){
      const off = c && c.date && snap.asOf !== c.date ? ' This count is dated ' + prettyDate(c.date) + '; refresh to compare on the same date.' : '';
      $('#tBook').textContent = 'Book stock as of ' + prettyDate(snap.asOf) + ' · ' + items.length + ' items · pulled ' + ago(snap.pulledAt) + '.' + off;
    } else $('#tBook').textContent = d && d.configured ? 'No book stock from Tally yet.' : '';
    $('#tPull').disabled = !(d && d.configured && c);

    // datalist of Tally items
    const dl = $('#tItems');
    if (dl.dataset.n !== String(items.length) + (snap ? snap.pulledAt : '')){
      dl.innerHTML = items.map(i => '<option value="'+esc(i.name)+'"></option>').join('');
      dl.dataset.n = String(items.length) + (snap ? snap.pulledAt : '');
    }

    // match list
    const groups = tallyGroups();
    const saved = new Map(savedMaps().map(m => [m.key, m.item]));
    const only = $('#tUnmatchedOnly').checked;
    const shown = groups.filter(g => !only || !(T.dirty.get(g.key) || saved.get(g.key)) || !itemMap.has(T.dirty.has(g.key) ? T.dirty.get(g.key) : saved.get(g.key)));
    $('#tFilterWrap').hidden = !groups.length || !items.length;
    $('#tMatchList').innerHTML = shown.map(g => {
      const lbl = groupLabel(g), val = T.dirty.has(g.key) ? T.dirty.get(g.key) : (saved.get(g.key) || '');
      const n = rowNote(g, val, itemMap);
      return '<li class="tm" data-key="'+esc(g.key)+'">'+
        '<div class="tm-spec"><b>'+esc(lbl.title)+'</b><span class="t">'+esc(lbl.sub)+'</span></div>'+
        '<div class="tm-qty">'+fmt(g.rolls)+' '+(g.rolls === 1 ? 'piece' : 'pieces')+'<br>'+fmt(g.metres)+' m</div>'+
        '<input type="text" class="tm-in" list="tItems" autocomplete="off" spellcheck="false" placeholder="'+(items.length ? 'Search Tally items' : 'Pull book stock first')+'" aria-label="Tally item for '+esc(lbl.title)+'" data-key="'+esc(g.key)+'" value="'+esc(val)+'"'+(items.length ? '' : ' disabled')+'>'+
        '<div class="tm-note '+n.cls+'">'+esc(n.text)+'</div></li>';
    }).join('');
    const empty = $('#tMatchEmpty');
    empty.hidden = shown.length > 0;
    empty.querySelector('p').textContent = !groups.length ? 'This count has no entries yet.' : 'Every cable in this count is matched.';
    const matched = groups.filter(g => itemMap.has(saved.get(g.key))).length;
    $('#tMatchCount').textContent = groups.length ? matched + ' of ' + groups.length + ' saved' : '';
    updateSaveBtn();

    // comparison (saved matches only)
    const be = buildEntries(savedMaps());
    // Items that differ come first, so shortages and excess are seen without scrolling.
    const off = e => Math.abs(e.qty - (e.book || 0)) > 0.0005 ? 0 : 1;
    const rows = be.entries.slice().sort((a,b) => off(a) - off(b) || a.item.localeCompare(b.item));
    $('#tCmpBody').innerHTML = rows.length ? rows.map(e => {
      const diff = Math.round((e.qty - (e.book || 0)) * 1000) / 1000;
      const cls = diff < 0 ? 'short' : diff > 0 ? 'over' : 'even';
      const u = '<span class="u">'+esc(e.unit || '')+'</span>';
      return '<tr><td>'+esc(e.item)+'</td><td class="num" data-l="Book">'+fmtQ(e.book)+u+'</td><td class="num" data-l="Counted">'+fmtQ(e.qty)+u+'</td><td class="num '+cls+'" data-l="Difference">'+(diff > 0 ? '+' : '')+fmtQ(diff)+(diff ? u : '')+'</td></tr>';
    }).join('') : '<tr><td colspan="4" style="color:var(--muted)">'+(items.length ? 'Save matches above to compare book stock with the count.' : 'Book stock appears here once the connector pulls it from Tally.')+'</td></tr>';
    const short = rows.filter(e => e.qty < (e.book || 0)).length, over = rows.filter(e => e.qty > (e.book || 0)).length;
    $('#tCmpNote').textContent = rows.length ? short + ' short · ' + over + ' excess' : '';

    // in tally, not counted
    const matchedNames = new Set(rows.map(e => e.item));
    const miss = items.filter(i => i.qty > 0 && !matchedNames.has(i.name)).sort((a,b) => b.qty - a.qty);
    $('#tMissBody').innerHTML = miss.length ? miss.slice(0, 150).map(i => '<tr><td>'+esc(i.name)+(i.parent ? '<span class="ty">'+esc(i.parent)+'</span>' : '')+'</td><td class="num">'+fmtQ(i.qty)+'<span class="u">'+esc(i.unit||'')+'</span></td></tr>').join('') +
      (miss.length > 150 ? '<tr><td colspan="2" style="color:var(--muted)">and '+(miss.length-150)+' more</td></tr>' : '')
      : '<tr><td colspan="2" style="color:var(--muted)">'+(items.length ? 'Nothing. Every Tally item with stock is matched.' : 'Appears once book stock is pulled.')+'</td></tr>';
    $('#tMissCount').textContent = items.length ? miss.length + ' items with book stock' : '';

    // post
    const a = d && d.agent;
    const godown = (a && a.godown) || 'Main Location';
    const pending = d && d.jobs.find(j => j.type === 'post' && c && j.countId === c.id && (j.status === 'queued' || j.status === 'running'));
    let info;
    if (!d || !d.configured) info = 'Posting needs Tally sync to be switched on.';
    else if (!items.length) info = 'Pull book stock first, then match the cables to Tally items.';
    else if (!rows.length) info = 'Save at least one match to post.';
    else info = 'Creates a Physical Stock voucher in Tally dated ' + prettyDate((c && c.date) || snap.asOf) + ' for godown "' + godown + '", setting ' + rows.length + ' item' + (rows.length === 1 ? '' : 's') + ' to the counted quantity. Tally adjusts closing stock for these items only.' +
      (be.unmatched ? ' ' + be.unmatched + ' unmatched cable' + (be.unmatched === 1 ? ' is' : 's are') + ' left out.' : '') +
      ' Posting this count again updates the same voucher.';
    $('#tPostInfo').textContent = info;
    const pb = $('#tPost');
    pb.disabled = !(d && d.configured && rows.length && c) || !!pending;
    if (!pb.classList.contains('armed')) pb.textContent = pending ? 'Waiting for the connector…' : 'Post Physical Stock';

    // jobs
    const jobs = (d && d.jobs) || [];
    const statusText = { queued:'Waiting for connector', running:'Working', done:'Done', warning:'Done, check', error:'Failed', expired:'Expired', cancelled:'Cancelled' };
    $('#tJobs').innerHTML = jobs.slice(0, 6).map(j => {
      const r = j.result || {};
      let extra = '';
      if (j.type === 'post' && Array.isArray(r.checks)){
        const badc = r.checks.filter(x => !x.ok).slice(0, 5);
        if (badc.length) extra = '<ul>' + badc.map(x => '<li>'+esc(x.item)+': posted '+fmtQ(x.posted)+', book now '+(x.book == null ? 'not found' : fmtQ(x.book))+'</li>').join('') + '</ul>';
      }
      if (j.type === 'post' && Array.isArray(r.lineErrors) && r.lineErrors.length) extra += '<ul>' + r.lineErrors.slice(0, 5).map(x => '<li>'+esc(x)+'</li>').join('') + '</ul>';
      return '<li class="tjob"><div class="tjob-h"><b>'+(j.type === 'post' ? 'Physical Stock post' : 'Book stock pull')+'</b><span class="spill '+esc(j.status)+'">'+esc(statusText[j.status] || j.status)+'</span><span class="when">'+esc(ago(j.updatedAt || j.at))+'</span></div>'+
        (r.message ? '<div>'+esc(r.message)+'</div>' : (j.status === 'queued' ? '<div class="hint">The connector picks this up within about a minute while it is running.</div>' : ''))+
        extra + (j.status === 'queued' ? '<div><button type="button" class="btn small" data-tcancel="'+esc(j.id)+'">Cancel</button></div>' : '') + '</li>';
    }).join('');
  }

  function groupLabel(g){
    const l = g.sample;
    const len = l.pack === 'Coil' ? (l.origM != null ? l.origM : l.perM) : null;
    return {
      title: (l.make ? l.make + ' · ' : '') + specLabel(l),
      sub: [l.type || 'Type not set', len ? fmt(len) + ' m coils' : (l.pack === 'Drum' ? 'Drums' : (l.pack || ''))].filter(Boolean).join(' · ')
    };
  }

  function updateSaveBtn(){
    const saved = new Map(savedMaps().map(m => [m.key, m.item]));
    let n = 0;
    T.dirty.forEach((v, k) => { if ((saved.get(k) || '') !== v) n++; });
    const b = $('#tSave');
    b.disabled = n === 0;
    b.textContent = n ? 'Save ' + n + ' match' + (n === 1 ? '' : 'es') : 'Save matches';
  }

  $('#tMatchList').addEventListener('input', e => {
    const inp = e.target.closest('.tm-in'); if (!inp) return;
    const key = inp.dataset.key, val = inp.value.trim();
    T.dirty.set(key, val); T.suggested.delete(key);
    const g = tallyGroups().find(x => x.key === key);
    const items = new Map((((T.data && T.data.snapshot) || {}).items || []).map(i => [i.name, i]));
    if (g){ const n = rowNote(g, val, items); const el = inp.parentNode.querySelector('.tm-note'); el.className = 'tm-note ' + n.cls; el.textContent = n.text; }
    $('#tSaveErr').hidden = true;
    updateSaveBtn();
  });
  $('#tUnmatchedOnly').addEventListener('change', renderTally);

  $('#tSave').addEventListener('click', async () => {
    const saved = new Map(savedMaps().map(m => [m.key, m.item]));
    const names = new Set((((T.data && T.data.snapshot) || {}).items || []).map(i => i.name));
    const changes = []; const badNames = [];
    T.dirty.forEach((v, k) => { if ((saved.get(k) || '') === v) return; if (v && !names.has(v)) badNames.push(v); else changes.push({ key:k, item:v }); });
    const err = $('#tSaveErr');
    if (badNames.length){ err.hidden = false; err.textContent = badNames.length + ' match' + (badNames.length === 1 ? ' isn’t' : 'es aren’t') + ' in Tally’s item list, e.g. “' + badNames[0] + '”. Pick names from the suggestions or clear them.'; return; }
    if (!changes.length) return;
    const b = $('#tSave'); b.disabled = true;
    try {
      const j = await api('POST', '/api/tally', { action:'map', maps: changes, by: S.name });
      T.data.maps = j.maps;
      changes.forEach(ch => { T.dirty.delete(ch.key); T.suggested.delete(ch.key); });
      toast('Saved ' + changes.length + ' match' + (changes.length === 1 ? '' : 'es'));
      renderTally();
    } catch(x){ err.hidden = false; err.textContent = x.message; updateSaveBtn(); }
  });

  $('#tPull').addEventListener('click', async () => {
    const c = currentCount(); if (!c) return;
    const b = $('#tPull'); b.disabled = true;
    try {
      const j = await api('POST', '/api/tally', { action:'pull', count: c.id, by: S.name });
      toast(j.existing ? 'A refresh is already waiting for the connector' : 'Asked the connector to refresh book stock');
      await loadTally();
    } catch(x){ toast(x.message); b.disabled = false; }
  });

  $('#tPost').addEventListener('click', async () => {
    const c = currentCount(); if (!c) return;
    const b = $('#tPost');
    if (!b.classList.contains('armed')){
      const n = buildEntries(savedMaps()).entries.length;
      b.classList.add('armed'); b.textContent = 'Tap again to post ' + n + ' item' + (n === 1 ? '' : 's') + ' to Tally';
      clearTimeout(T.armTimer);
      T.armTimer = setTimeout(() => { b.classList.remove('armed'); renderTally(); }, 5000);
      return;
    }
    clearTimeout(T.armTimer); b.classList.remove('armed'); b.disabled = true; b.textContent = 'Sending…';
    try {
      const j = await api('POST', '/api/tally', { action:'post', count: c.id, by: S.name });
      toast('Sent ' + j.summary.items + ' items to the Tally connector');
      await loadTally();
    } catch(x){ toast(x.message); renderTally(); }
  });

  $('#tJobs').addEventListener('click', async e => {
    const btn = e.target.closest('[data-tcancel]'); if (!btn) return;
    btn.disabled = true;
    try { await api('POST', '/api/tally', { action:'cancel', id: btn.dataset.tcancel }); toast('Cancelled'); }
    catch(x){ toast(x.message); }
    loadTally();
  });

  /* ---------- tabs ---------- */
  const TABS = ['count','entries','summary','tally'];
  function switchTab(name){
    TABS.forEach(t => {
      $('#tab-'+t).hidden = t !== name;
      $('#tabbtn-'+t).setAttribute('aria-selected', String(t === name));
    });
    if (name === 'tally'){ renderTally(); loadTally(); }
  }
  TABS.forEach(t => $('#tabbtn-'+t).addEventListener('click', () => switchTab(t)));

  function fillDatalists(){
    const uniq = k => Array.from(new Set(S.lines.map(l => l[k]).filter(Boolean))).sort();
    $('#makeList').innerHTML = uniq('make').map(v => '<option value="'+esc(v)+'"></option>').join('');
    $('#locList').innerHTML = uniq('location').map(v => '<option value="'+esc(v)+'"></option>').join('');
  }

  function renderAll(){
    renderCounts(); renderAccess();
    $('#nEntries').textContent = S.lines.length;
    renderEntries(); renderSummary(); fillDatalists(); checkDup();
    if (!$('#tab-tally').hidden && T.data && T.renderedLines !== S.lines && !(document.activeElement && document.activeElement.classList && document.activeElement.classList.contains('tm-in'))) renderTally();
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
