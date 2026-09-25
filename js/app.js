/* CSU-TAPS data site. Three views chosen at the top: Map (default), Charts, Tables.
   Left: what to show (season, color, chart list, dataset list). Right: chart controls, columns and filters.
   All text from the data is inserted with textContent (never as HTML). */
'use strict';
(() => {
  const $ = id => document.getElementById(id);
  function el(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'text') e.textContent = v; else if (k === 'on') for (const [ev, f] of Object.entries(v)) e.addEventListener(ev, f);
      else if (k === 'className') e.className = v; else e.setAttribute(k, v === true ? '' : v);
    }
    for (const k of kids.flat()) if (k !== null && k !== undefined) e.append(k instanceof Node ? k : document.createTextNode(String(k)));
    return e;
  }
  const busy = (on, msg) => { $('busy').hidden = !on; if (msg) $('busyMsg').textContent = msg; };
  const stamp = () => new Date().toISOString().slice(0, 10);
  const CHARTS = VIEWS.filter(v => !['map', 'downloads'].includes(v.id));
  const MAP_DATASETS = ['plots', 'yield_strips', 'soil_lab', 'plant_tissue', 'vegetation_indices', 'irrigation_events', 'nitrogen_events'];
  let chart = null, current = null, lastTable = null, manifest = null;
  const S = { mode: 'map', view: null, ds: null, st: null, drawFn: null,
    map: { ds: 'plots', year: 2025, color: 'User_Average_Yield_bu_ac', agg: 'mean', filters: {} },
    charts: { topic: '', q: '' }, tables: { topic: '', ds: 'plots', cols: {}, page: 0 }, extra: {} };
  const geoCache = {};
  const sel = (lab, opts, val, onChange) => el('label', {}, lab, el('select', { on: { change: e => onChange(e.target.value) } },
    opts.map(([v, t]) => el('option', { value: v, text: t, selected: String(v) === String(val) }))));
  const seg = (vals, cur, onPick, labels) => el('div', { className: 'seg' }, vals.map((v, i) => el('button', { type: 'button', className: String(v) === String(cur) ? 'on' : null,
    text: labels ? labels[i] : String(v), on: { click: () => onPick(v) } })));

  // ---------------- sign-in
  $('loginForm').addEventListener('submit', async ev => {
    ev.preventDefault();
    $('loginMsg').textContent = ''; $('loginBtn').disabled = true; busy(true, 'Checking your sign-in');
    try { const who = await Crypt.signIn($('email').value, $('password').value); $('password').value = ''; await start(who); }
    catch (e) { $('loginMsg').textContent = e.message || 'Sign-in failed.'; }
    finally { $('loginBtn').disabled = false; busy(false); }
  });
  $('logoutBtn').addEventListener('click', () => { Crypt.signOut(); location.hash = ''; location.reload(); });

  async function start(who) {
    $('login').hidden = true; $('app').hidden = false; $('who').hidden = false; $('whoEmail').textContent = who;
    chart = echarts.init($('chart'), null, { renderer: 'canvas' });
    window.addEventListener('resize', () => { if (chart) { chart.resize(); if (S.mode === 'map' && S.drawFn) S.drawFn(); } });
    setupResizers();
    manifest = await Data.getManifest();
    document.querySelectorAll('.mode').forEach(b => b.addEventListener('click', () => {
      const m = b.dataset.mode;
      location.hash = m === 'map' ? 'map' : m === 'charts' ? 'charts/' + (S.view ? S.view.id : CHARTS.find(v => v.id === 'plots_yield').id) : 'tables/' + S.tables.ds;
    }));
    window.addEventListener('hashchange', () => route());
    route();
  }
  (async () => { busy(true, 'Loading'); try { const who = await Crypt.resume(); if (who !== null) await start(who); } finally { busy(false); } })();

  // drag handles: left and right side widths, figure height (kept for this browser)
  function setupResizers() {
    const root = document.documentElement, body = document.querySelector('.body');
    const store = { get(k) { try { return localStorage.getItem('taps_' + k); } catch (e) { return null; } }, set(k, v) { try { v === null ? localStorage.removeItem('taps_' + k) : localStorage.setItem('taps_' + k, v); } catch (e) {} } };
    for (const k of ['lw', 'rw', 'ch', 'mh']) { const v = store.get(k); if (v) root.style.setProperty('--' + k, v); }
    let raf = 0;
    const refit = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { if (!chart) return; chart.resize(); if (S.mode === 'map' && S.drawFn) S.drawFn(); }); };
    function drag(handle, onMove, key) {
      handle.addEventListener('pointerdown', e => {
        e.preventDefault(); handle.setPointerCapture(e.pointerId); handle.classList.add('drag'); document.body.classList.add('resizing');
        const move = ev => { onMove(ev); refit(); };
        const up = () => { handle.releasePointerCapture(e.pointerId); handle.classList.remove('drag'); document.body.classList.remove('resizing');
          handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up); const k = key(); store.set(k, root.style.getPropertyValue('--' + k)); refit(); };
        handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', up);
      });
      handle.addEventListener('dblclick', () => { const k = key(); root.style.removeProperty('--' + k); store.set(k, null); refit(); });
    }
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    drag($('gutL'), ev => { const x = ev.clientX - body.getBoundingClientRect().left; root.style.setProperty('--lw', clamp(x, 150, window.innerWidth * 0.45) + 'px'); }, () => 'lw');
    drag($('gutR'), ev => { const x = body.getBoundingClientRect().right - ev.clientX; root.style.setProperty('--rw', clamp(x, 180, window.innerWidth * 0.45) + 'px'); }, () => 'rw');
    drag($('chartGrip'), ev => { const top = $('chart').getBoundingClientRect().top; root.style.setProperty(S.mode === 'map' ? '--mh' : '--ch', clamp(ev.clientY - top, 260, 1600) + 'px'); }, () => (S.mode === 'map' ? 'mh' : 'ch'));
  }

  async function route() {
    const [m, arg] = (location.hash || '#map').slice(1).split('/');
    S.mode = ['map', 'charts', 'tables'].includes(m) ? m : 'map';
    document.querySelectorAll('.mode').forEach(b => b.classList.toggle('active', b.dataset.mode === S.mode));
    const main = document.querySelector('.main');
    main.classList.toggle('map-mode', S.mode === 'map'); main.classList.toggle('table-mode', S.mode === 'tables');
    $('chartCard').hidden = S.mode === 'tables'; $('pngBtn').hidden = S.mode === 'tables';
    $('pager').textContent = ''; $('chartMsg').textContent = ''; chart.clear(); S.drawFn = null;
    document.querySelector('.body').classList.toggle('no-panel', false);
    try {
      busy(true, 'Loading data');
      if (S.mode === 'map') await pageMap();
      else if (S.mode === 'charts') await pageCharts(arg);
      else await pageTables(arg);
    } catch (e) { console.error(e); $('chartMsg').textContent = 'Could not load: ' + (e.message || e); }
    finally { busy(false); }
    chart.resize();
  }

  // ================= MAP
  async function pageMap() {
    const M = S.map;
    const ds = await Data.load(M.ds, m => busy(true, m));
    const years = Data.uniques(ds, 'Year');
    if (!years.includes(M.year)) M.year = years[years.length - 1];
    const colorCols = ds.columns.filter(c => !['Year', 'Plot', 'Farm_PlotI', 'Date', 'Datetime'].includes(c.key) && (c.type === 'num' || Data.uniques(ds, c.key).length <= 40));
    if (!colorCols.find(c => c.key === M.color)) M.color = (colorCols.filter(c => c.type === 'num').pop() || colorCols[0]).key;
    $('pageTitle').textContent = 'Plot map';
    $('pageNote').textContent = 'The field layout for the season. Each plot is colored by the value chosen on the left: red is the lowest, green the highest, grey has no value. Click a plot for its details.';

    const L = $('left'); L.textContent = '';
    L.append(el('h3', { text: 'Season' }), seg(years.filter(y => manifest.datasets.find(d => d.id === 'map_' + y)), M.year, y => { M.year = y; S.season = y; pageMap(); }),
      el('h3', { text: 'Color the plots by' }),
      sel('Data', MAP_DATASETS.filter(id => manifest.datasets.find(d => d.id === id)).map(id => [id, manifest.datasets.find(d => d.id === id).title]), M.ds,
        v => { M.ds = v; M.color = null; M.filters = {}; busy(true, 'Loading'); pageMap().finally(() => busy(false)); }),
      sel('Value', colorCols.map(c => [c.key, Data.label(c)]), M.color, v => { M.color = v; drawMap(); }),
      sel('If a plot has several rows', [['mean', 'Mean'], ['sum', 'Sum'], ['min', 'Minimum'], ['max', 'Maximum'], ['median', 'Median']], M.agg, v => { M.agg = v; drawMap(); }),
      el('div', { className: 'info', text: 'Pick the data, then the value. For soil, tissue and indices, narrow the rows on the right (for example one variable and one depth) so each plot shows one number.' }));

    // right: filters for the chosen data, and plot details on click
    const P = $('panel'); P.textContent = '';
    const details = el('div', { className: 'filter' }, el('h3', { text: 'Plot details' }), el('div', { className: 'info', text: 'Click a plot on the map.' }));
    P.append(details);
    const fcols = ds.columns.filter(c => c.type !== 'num' && !['Year', 'Plot', 'Farm', 'Team', 'Farm_PlotI', 'Datetime'].includes(c.key));
    const shown = fcols.filter(c => { const n = Data.uniques(ds, c.key).length; return n > 1 && n <= 60; });
    if (shown.length) {
      P.append(el('h3', { text: 'Filters' }));
      for (const c of shown) P.append(filterBox(c, Data.uniques(ds, c.key), M.filters, drawMap));
    }

    async function drawMap() {
      const f = Object.assign({}, M.filters, { Year: new Set([M.year]) });
      const idx = Data.filter(ds, f, null);
      current = { ds, idx, name: `map_${M.year}` };
      if (!geoCache[M.year]) geoCache[M.year] = await Data.load('map_' + M.year);
      chart.clear(); $('chartMsg').textContent = '';
      const st = { ys: [M.color], agg: M.agg };
      const res = Charts.plotMap(ds, idx, st, geoCache[M.year], M.year);
      if (!res) { $('chartMsg').textContent = 'Nothing to draw.'; return; }
      fitMapGrid(res.option);
      chart.setOption(res.option, true);
      chart.off('click');
      chart.on('click', p => showPlot(p.name || (p.data && p.data.name)));
      lastTable = res.table; $('tableTitle').textContent = `Plots, ${M.year}`; renderTable(res.table, idx.length);
      function showPlot(pl) {
        if (!pl) return;
        const rows = Data.filter(S.map.ds === 'plots' ? ds : ds, { Plot: new Set([pl]), Year: new Set([M.year]) }, null);
        const box = el('table', { className: 'kv' });
        if (M.ds === 'plots' && rows.length) {
          const i = rows[0];
          for (const c of ds.columns) { const v = ds.data[c.key][i]; if (v === null || v === undefined || v === '') continue; box.append(el('tr', {}, el('td', { text: Data.label(c) }), el('td', { text: Data.fmt(v, c) }))); }
        } else {
          box.append(el('tr', {}, el('td', { text: 'Rows for this plot' }), el('td', { text: rows.length })));
        }
        details.textContent = ''; details.append(el('h3', { text: `Plot ${pl}` }), box);
      }
    }
    S.drawFn = drawMap;
    await drawMap();
  }

  function fitMapGrid(o) {
    const W = $('chart').clientWidth || 900, H = $('chart').clientHeight || 600;
    const aw = W - 60, ah = H - 110; let gw = aw, gh = aw / o._aspect;
    if (gh > ah) { gh = ah; gw = ah * o._aspect; }
    o.grid = { left: (W - gw) / 2, width: gw, top: 44 + (ah - gh) / 2, height: gh };
    delete o._aspect;
  }

  // ================= CHARTS
  async function pageCharts(id) {
    const v = CHARTS.find(x => x.id === id) || CHARTS.find(x => x.id === 'plots_yield') || CHARTS[0];
    S.view = v;
    $('pageTitle').textContent = v.title; $('pageNote').textContent = v.note || '';
    renderChartList();
    if (v.special === 'sm') return pageSM();
    if (v.special === 'explore') {
      const list = manifest.datasets.filter(d => !d.id.startsWith('map_'));
      const dsId = S.extra.exploreId || 'plots';
      const top = sel('Dataset', list.map(d => [d.id, `${d.title} (${d.n.toLocaleString()} rows)`]), dsId, async val => { S.extra.exploreId = val; busy(true, 'Loading data'); try { await standard(val, null, true); } finally { busy(false); } });
      S.exploreTop = top;
      return standard(dsId, null, true);
    }
    S.exploreTop = null;
    return standard(v.ds, v.st, false);
  }

  function renderChartList() {
    const C = S.charts, L = $('left'); L.textContent = '';
    const groups = [...new Set(CHARTS.map(v => v.group))];
    const list = el('div', { className: 'list' });
    const fill = () => {
      list.textContent = '';
      const q = C.q.trim().toLowerCase();
      for (const v of CHARTS) {
        if (C.topic && v.group !== C.topic) continue;
        if (q && !(v.title + ' ' + v.group).toLowerCase().includes(q)) continue;
        list.append(el('a', { href: '#charts/' + v.id, className: S.view && v.id === S.view.id ? 'active' : null }, v.title, C.topic ? null : el('span', { className: 'sub', text: v.group })));
      }
      if (!list.children.length) list.append(el('div', { className: 'info', text: 'No chart matches.' }));
    };
    L.append(el('div', { id: 'seasonSlot' }), el('h3', { text: 'Charts' }),
      sel('Topic', [['', 'All topics']].concat(groups.map(g => [g, g])), C.topic, t => { C.topic = t; fill(); }),
      el('input', { type: 'search', placeholder: 'Find a chart', value: C.q, on: { input: e => { C.q = e.target.value; fill(); } } }),
      list);
    fill();
  }

  function initState(ds, preset) {
    const st = JSON.parse(JSON.stringify(preset || {}));
    const cats = ds.columns.filter(c => c.type !== 'num'), nums = ds.columns.filter(c => c.type === 'num');
    st.type = st.type || 'bar';
    st.x = ds.data[st.x] ? st.x : (cats.find(c => c.key === 'Farm') || cats[1] || cats[0] || ds.columns[0]).key;
    st.ys = (st.ys || []).filter(k => ds.data[k]); if (!st.ys.length && nums.length) st.ys = [nums[nums.length - 1].key];
    st.agg = st.agg || 'mean';
    st.color = st.color && ds.data[st.color] ? st.color : null;
    const years = seasonsOf(ds);
    const py = (st.filters || {}).Year;
    st.season = years.length > 1 ? (py && py.length === 1 ? py[0] : 'both') : null;
    if (st.season !== null && S.season && (S.season === 'both' || years.includes(S.season))) st.season = S.season;   // keep the season picked on the last page
    const f = {};
    for (const [k, vals] of Object.entries(st.filters || {})) {
      if (!ds.data[k] || k === 'Year') continue;
      const have = new Set(Data.uniques(ds, k)); const keep = vals.filter(v => have.has(v));
      if (keep.length) f[k] = new Set(keep);
    }
    st.filters = f;
    const dcol = ds.columns.find(c => c.type === 'date' || c.type === 'datetime');
    st.range = { key: dcol ? dcol.key : null, from: '', to: '' };
    return st;
  }
  const SITE_YEARS = [2023, 2024, 2025, 2026];
  function seasonsOf(ds) {
    if (!ds.data.Year) return [];
    const have = Data.uniques(ds, 'Year'); const str = have.length && typeof have[0] === 'string';
    const all = new Set(have.map(String)); SITE_YEARS.forEach(y => all.add(String(y)));
    return [...all].sort().map(y => str ? y : Number(y));
  }
  function activeFilters(st) {
    const f = Object.assign({}, st.filters);
    if (st.season && st.season !== 'both') f.Year = new Set([st.season]);
    return f;
  }

  async function standard(dsId, preset, explore) {
    const ds = await Data.load(dsId, m => busy(true, m));
    S.ds = ds; S.st = initState(ds, preset);
    S.drawFn = drawChart;
    renderChartPanel();
    drawChart();
  }

  const TYPES = [['bar', 'Bar'], ['stacked', 'Stacked bar'], ['hbar', 'Horizontal bar'], ['hstacked', 'Horizontal stacked bar'], ['line', 'Line'], ['area', 'Area'],
    ['scatter', 'Points (scatter)'], ['box', 'Box plot'], ['pie', 'Pie (percent)']];
  const AGGS = [['none', 'Each row (no grouping)'], ['mean', 'Mean'], ['sum', 'Sum'], ['count', 'Count'], ['min', 'Minimum'], ['max', 'Maximum'], ['median', 'Median']];

  function renderChartPanel() {
    const ds = S.ds, st = S.st, p = $('panel'); p.textContent = '';
    if (S.exploreTop) p.append(el('h3', { text: 'Dataset' }), S.exploreTop);
    const slot = $('seasonSlot');
    if (slot) {
      slot.textContent = '';
      if (st.season !== null) {
        const years = seasonsOf(ds);
        slot.append(el('h3', { text: 'Season' }), seg(years.concat(['both']), st.season, y => { st.season = y; S.season = y; if (typeof y === 'number') S.map.year = y; renderChartPanel(); drawChart(); }, years.map(String).concat([years.length > 2 ? 'All' : 'Both'])));
      }
    }
    const nums = ds.columns.filter(c => c.type === 'num');
    p.append(el('h3', { text: 'Chart' }));
    p.append(sel('Chart type', TYPES, st.type, v => { st.type = v; if (v === 'box' || v === 'scatter') st.agg = 'none'; if (v === 'pie' && st.agg === 'none') st.agg = 'count'; renderChartPanel(); drawChart(); }));
    p.append(sel('X axis', ds.columns.map(c => [c.key, Data.label(c)]), st.x, v => { st.x = v; drawChart(); }));
    const ybox = el('div', { className: 'checks' }, nums.map(c => el('label', {}, el('input', { type: 'checkbox', checked: st.ys.includes(c.key), on: { change: e => {
      st.ys = e.target.checked ? [...st.ys, c.key] : st.ys.filter(k => k !== c.key); drawChart(); } } }), Data.label(c))));
    p.append(el('div', { className: 'filter' }, el('div', { className: 'filter-head', text: st.type === 'pie' ? 'Value (first checked)' : 'Y axis (one or more)' }), ybox));
    p.append(sel('Combine rows with the same X', AGGS, st.agg, v => { st.agg = v; drawChart(); }));
    p.append(sel('Group / color by', [['', 'None']].concat(ds.columns.filter(c => c.type === 'cat').map(c => [c.key, Data.label(c)])), st.color || '', v => { st.color = v || null; drawChart(); }));
    p.append(el('label', { className: 'toggle' }, el('input', { type: 'checkbox', checked: !!st.cumulative, on: { change: e => { st.cumulative = e.target.checked; drawChart(); } } }), 'Running total along X'));
    appendFilters(p, ds, st.filters, st.range, drawChart);
  }

  function appendFilters(p, ds, filters, range, redraw) {
    p.append(el('h3', { text: 'Filters' }));
    if (range && range.key) {
      const rc = Data.col(ds, range.key);
      p.append(el('div', { className: 'filter' }, el('div', { className: 'filter-head', text: `${rc.label} range` }),
        el('div', { className: 'row' },
          el('input', { type: 'date', value: range.from, on: { change: e => { range.from = e.target.value; redraw(); } } }),
          el('input', { type: 'date', value: range.to, on: { change: e => { range.to = e.target.value; redraw(); } } }))));
    }
    for (const c of ds.columns.filter(c => c.type === 'cat' && c.key !== 'Year')) {
      const vals = Data.uniques(ds, c.key);
      if (vals.length < 2 || vals.length > 400) continue;
      p.append(filterBox(c, vals, filters, redraw));
    }
  }

  function filterBox(c, vals, filters, redraw) {
    const set = filters[c.key];
    const box = el('div', { className: 'checks' });
    const boxes = vals.map(v => { const cb = el('input', { type: 'checkbox', checked: !set || set.has(v), on: { change: () => sync() } }); cb._v = v; box.append(el('label', {}, cb, Data.fmt(v, c) || '(blank)')); return cb; });
    function sync() { const on = boxes.filter(b => b.checked).map(b => b._v); if (on.length === vals.length) delete filters[c.key]; else filters[c.key] = new Set(on); redraw(); }
    return el('div', { className: 'filter' }, el('div', { className: 'filter-head' }, el('span', { text: Data.label(c) }),
      el('span', { className: 'links' }, el('a', { text: 'All', on: { click: () => { boxes.forEach(b => (b.checked = true)); sync(); } } }),
        el('a', { text: 'None', on: { click: () => { boxes.forEach(b => (b.checked = false)); sync(); } } }))), box);
  }

  function drawChart() {
    const ds = S.ds, st = S.st;
    let af = activeFilters(st), idx = Data.filter(ds, af, st.range), skipped = [];
    if (!idx.length && af.Year) {   // a preset filter (station, variable, farm) can have no rows in another season: skip those filters for this season
      const inSeason = Data.filter(ds, { Year: af.Year }, null), af2 = { Year: af.Year };
      const SCOPE = ['Station', 'Depth_in', 'Season', 'Position', 'Farm', 'Plot', 'Stage', 'Tissue', 'Source'];   // filters that only narrow where or when; others (Variable, Index, Unit) define what the chart shows
      const missing = [];
      for (const [k, set] of Object.entries(af)) {
        if (k === 'Year') continue;
        if (inSeason.some(i => set.has(ds.data[k][i]))) af2[k] = set;
        else if (SCOPE.includes(k)) skipped.push(Data.label(Data.col(ds, k)));
        else missing.push(`${Data.label(Data.col(ds, k))} ${[...set].join(', ')}`);
      }
      if (missing.length && inSeason.length) { $('chartMsg').textContent = `${st.season} has no ${missing.join('; ')} values in this dataset. Pick another value in the filters on the right to see what ${st.season} has.`; lastTable = null; renderTable([['No rows']], 0); chart.clear(); current = { ds, idx: [], name: S.view.id }; return; }
      if (skipped.length) { af = af2; idx = Data.filter(ds, af, st.range); }
    }
    current = { ds, idx, name: S.view.id };
    chart.clear(); $('chartMsg').textContent = '';
    const noSeason = st.season && st.season !== 'both' && ds.data.Year && !ds.data.Year.some(y => y === st.season);
    if (noSeason) { $('chartMsg').textContent = `${st.season} data for this chart has not been added yet. It will appear here once it comes in.`; lastTable = null; renderTable([['No rows yet']], 0); return; }
    if (!idx.length) { $('chartMsg').textContent = 'No rows match the filters.'; lastTable = null; renderTable([['No rows']], 0); return; }
    if (!st.ys.length) { $('chartMsg').textContent = 'Choose at least one Y value.'; return; }
    if (st.ys.every(k => idx.every(i => ds.data[k][i] === null || ds.data[k][i] === undefined))) { $('chartMsg').textContent = `No ${st.ys.map(k => Data.label(Data.col(ds, k))).join(', ')} values${st.season && st.season !== 'both' ? ' for ' + st.season : ''} yet. They will appear here once the data comes in.`; lastTable = null; renderTable([['No values yet']], 0); return; }
    let res = null;
    try { res = Charts.build(ds, idx, st); } catch (e) { console.error(e); }
    if (!res) { $('chartMsg').textContent = 'This combination cannot be drawn. Try another X, Y or chart type.'; return; }
    res.option.title = [].concat(res.option.title || [], [{ text: (S.view.special === 'explore' ? ds.title : S.view.title).toUpperCase(), left: 'center', top: 4,
      textStyle: { fontSize: 14, fontWeight: 600, color: '#22592A' } }]);
    chart.setOption(res.option, true);
    lastTable = res.table;
    if (skipped.length) $('chartMsg').textContent = `${st.season} has no rows for the preset ${skipped.join(', ')} choice, so that filter is not applied for this season.`;
    $('tableTitle').textContent = 'Values in the chart';
    renderTable(res.table, idx.length);
  }

  // ================= TABLES
  async function pageTables(id) {
    const T = S.tables;
    const list = manifest.datasets.filter(d => !d.id.startsWith('map_'));
    const d = list.find(x => x.id === id) || list.find(x => x.id === T.ds) || list[0];
    if (T.ds !== d.id) { T.ds = d.id; T.page = 0; }
    const ds = await Data.load(d.id, m => busy(true, m));
    $('pageTitle').textContent = ds.title; $('pageNote').textContent = ds.note || '';
    // left: datasets
    const L = $('left'); L.textContent = '';
    const groups = [...new Set(list.map(x => x.group))];
    const lst = el('div', { className: 'list' });
    const fill = () => {
      lst.textContent = '';
      for (const x of list) { if (T.topic && x.group !== T.topic) continue;
        lst.append(el('a', { href: '#tables/' + x.id, className: x.id === d.id ? 'active' : null }, x.title, el('span', { className: 'sub', text: `${x.n.toLocaleString()} rows` }))); }
    };
    const slot = el('div', { id: 'seasonSlot' });
    L.append(slot, el('h3', { text: 'Tables' }), sel('Topic', [['', 'All topics']].concat(groups.map(g => [g, g])), T.topic, t => { T.topic = t; fill(); }), lst);
    fill();
    // columns: start with the ID columns and the first few values; the table grows only when more are ticked
    if (!T.cols[d.id]) {
      const idc = ds.columns.filter(c => ['Year', 'Farm', 'Team', 'Track', 'Plot'].includes(c.key)).map(c => c.key);
      const rest = ds.columns.filter(c => !idc.includes(c.key)).slice(0, 5).map(c => c.key);
      T.cols[d.id] = idc.concat(rest);
    }
    const st = { filters: {}, season: ds.data.Year && Data.uniques(ds, 'Year').length > 1 ? 'both' : null,
      range: { key: (ds.columns.find(c => c.type === 'date' || c.type === 'datetime') || {}).key || null, from: '', to: '' } };
    const P = $('panel'); P.textContent = '';
    const colBox = el('div', { className: 'checks tall' });
    const cbs = ds.columns.map(c => { const cb = el('input', { type: 'checkbox', checked: T.cols[d.id].includes(c.key), on: { change: () => syncCols() } }); cb._k = c.key; colBox.append(el('label', {}, cb, Data.label(c))); return cb; });
    function syncCols() { T.cols[d.id] = cbs.filter(b => b.checked).map(b => b._k); T.page = 0; drawTable(); }
    P.append(el('div', { className: 'filter' }, el('div', { className: 'filter-head' }, el('span', { text: 'Columns shown' }),
      el('span', { className: 'links' }, el('a', { text: 'All', on: { click: () => { cbs.forEach(b => (b.checked = true)); syncCols(); } } }),
        el('a', { text: 'None', on: { click: () => { cbs.forEach(b => (b.checked = false)); syncCols(); } } }))), colBox));
    if (st.season !== null) {
      const years = Data.uniques(ds, 'Year');
      if (S.season && (S.season === 'both' || years.includes(S.season))) st.season = S.season;
      const segBox = el('div');
      const drawSeg = () => { segBox.textContent = ''; segBox.append(seg(years.concat(['both']), st.season, y => { st.season = y; S.season = y; T.page = 0; drawSeg(); drawTable(); }, years.map(String).concat([years.length > 2 ? 'All' : 'Both']))); };
      drawSeg(); slot.append(el('h3', { text: 'Season' }), segBox);
    }
    appendFilters(P, ds, st.filters, st.range, () => { T.page = 0; drawTable(); });

    function drawTable() {
      const f = Object.assign({}, st.filters); if (st.season && st.season !== 'both') f.Year = new Set([st.season]);
      const idx = Data.filter(ds, f, st.range);
      const keys = T.cols[d.id].length ? T.cols[d.id] : ds.columns.slice(0, 1).map(c => c.key);
      current = { ds, idx, name: ds.id, keys };
      const per = 200, pages = Math.max(1, Math.ceil(idx.length / per));
      T.page = Math.min(T.page, pages - 1);
      const slice = idx.slice(T.page * per, T.page * per + per);
      const rows = Data.rowsFor(ds, slice, keys);
      lastTable = null;
      $('tableTitle').textContent = `${keys.length} column${keys.length === 1 ? '' : 's'}`;
      renderTable(rows, null, `${idx.length.toLocaleString()} rows after filters.`);
      const pg = $('pager'); pg.textContent = '';
      if (pages > 1) pg.append(
        el('button', { className: 'btn', text: 'Previous', disabled: T.page === 0, on: { click: () => { T.page--; drawTable(); } } }),
        el('span', { text: `Page ${T.page + 1} of ${pages}` }),
        el('button', { className: 'btn', text: 'Next', disabled: T.page >= pages - 1, on: { click: () => { T.page++; drawTable(); } } }));
    }
    S.drawFn = drawTable;
    drawTable();
  }

  function renderTable(rows, nRows, info) {
    const t = $('table'); t.textContent = '';
    if (!rows || !rows.length) return;
    t.append(el('thead', {}, el('tr', {}, rows[0].map(h => el('th', { text: h })))));
    const body = el('tbody'); const show = rows.slice(1, 1001);
    for (const r of show) body.append(el('tr', {}, r.map(v => el('td', { className: typeof v === 'number' ? 'num' : null, text: typeof v === 'number' ? Data.num1(v) : (v ?? '') }))));
    t.append(body);
    $('tableInfo').textContent = info || `${nRows ? nRows.toLocaleString() + ' rows after filters. ' : ''}${rows.length - 1 > show.length ? `Showing ${show.length} of ${(rows.length - 1).toLocaleString()} lines; the Excel file has all of them.` : ''}`;
  }

  // ================= downloads (Excel only) and image
  $('xlsxBtn').addEventListener('click', async () => {
    if (!current) return;
    const { ds, idx, name, keys } = current;
    busy(true, 'Building the Excel file');
    try {
      const sheets = [];
      if (lastTable && lastTable.length > 1 && S.mode !== 'tables') sheets.push([S.mode === 'map' ? 'Map values' : 'Chart values', lastTable]);
      sheets.push(['Data', Data.rowsFor(ds, idx, keys || ds.columns.map(c => c.key))]);
      sheets.push(['Read_me', [['CSU-TAPS data, organized by Wub Yilma'], [ds.title], [ds.note || ''], [`Rows after filters: ${idx.length} of ${ds.n}`], [`Downloaded ${stamp()}`]]]);
      await Data.downloadXLSX(`CSU_TAPS_${name}_${stamp()}.xlsx`, sheets);
    } finally { busy(false); }
  });
  $('pngBtn').addEventListener('click', () => {
    if (!chart || S.mode === 'tables') return;
    const a = document.createElement('a'); a.href = chart.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: '#fff' });
    a.download = `CSU_TAPS_${S.mode === 'map' ? 'map_' + S.map.year : S.view.id}_${stamp()}.png`; document.body.appendChild(a); a.click(); a.remove();
  });

  // ================= soil moisture probes (CropX style), inside Charts
  const SM_COLORS = ['#347AAF', '#E67354', '#F0C367', '#1F2A22', '#4F8A5B', '#8C7A2B', '#6B4E8C', '#3E9C9C', '#A33A3A', '#7A9A01', '#12375C', '#C25B8D'];
  function smGroup(label) {
    if (label.includes(':')) return label.split(':')[0].trim();
    return label.replace(/^Sensor \d+ /, '').replace(/ [MCT]\d\d.*$/, '').replace(/ \d+ cm.*$/, '').trim();
  }
  async function pageSM() {
    const sens = manifest.datasets.filter(d => d.id.startsWith('sm_'));
    const dsId = S.extra.smDs && sens.find(d => d.id === S.extra.smDs) ? S.extra.smDs : (sens.find(d => d.id === 'sm_aquaspy_2025') || sens[0]).id;
    const ds = await Data.load(dsId, m => busy(true, m));
    S.ds = ds; S.st = null;
    const year = ds.data.Year[0];
    const plotsHere = Data.uniques(ds, 'Plot');
    const plot = plotsHere.includes(S.extra.smPlot) ? S.extra.smPlot : plotsHere[0];
    const series = ds.columns.filter(c => c.type === 'num');
    const groups = [...new Set(series.map(c => smGroup(c.label)))].sort((a, b) => (b.startsWith('Moisture') - a.startsWith('Moisture')));
    const grp = groups.includes(S.extra.smGroup) ? S.extra.smGroup : groups[0];
    const inGrp = series.filter(c => smGroup(c.label) === grp);
    if (!S.extra.smCols || !S.extra.smCols.every(k => inGrp.find(c => c.key === k))) S.extra.smCols = inGrp.slice(0, 6).map(c => c.key);
    const ex = S.extra; ex.smIrr = ex.smIrr !== false; ex.smRain = ex.smRain !== false; ex.smFrom = ex.smFrom || ''; ex.smTo = ex.smTo || '';
    const farmOf = p => { const i = ds.data.Plot.indexOf(p); if (i < 0) return ''; const f = ds.data.Farm[i]; return f == null ? 'plot not given yet' : `farm ${f}${ds.data.Team[i] ? ', ' + ds.data.Team[i] : ''}`; };
    const again = () => { busy(true, 'Loading'); pageSM().finally(() => busy(false)); };

    const p = $('panel'); p.textContent = '';
    p.append(el('h3', { text: 'Probe' }),
      sel('Sensor and season', sens.map(d => [d.id, d.title]), dsId, v => { S.extra.smDs = v; S.extra.smCols = null; again(); }),
      sel('Plot', plotsHere.map(pl => [pl, `${pl} (${farmOf(pl)})`]), plot, v => { S.extra.smPlot = v; again(); }),
      sel('Measurement', groups.map(g => [g, g]), grp, v => { S.extra.smGroup = v; S.extra.smCols = null; again(); }),
      el('div', { className: 'filter' }, el('div', { className: 'filter-head', text: 'Depths / series' }),
        el('div', { className: 'checks' }, inGrp.map(c => el('label', {}, el('input', { type: 'checkbox', checked: ex.smCols.includes(c.key), on: { change: e => {
          ex.smCols = e.target.checked ? [...ex.smCols, c.key] : ex.smCols.filter(k => k !== c.key); drawSM(); } } }), c.label)))),
      el('div', { className: 'filter' }, el('div', { className: 'filter-head', text: 'Date range' }), el('div', { className: 'row' },
        el('input', { type: 'date', value: ex.smFrom, on: { change: e => { ex.smFrom = e.target.value; drawSM(); } } }),
        el('input', { type: 'date', value: ex.smTo, on: { change: e => { ex.smTo = e.target.value; drawSM(); } } }))),
      el('h3', { text: 'Show with the probe' }),
      el('label', { className: 'toggle' }, el('input', { type: 'checkbox', checked: ex.smIrr, on: { change: e => { ex.smIrr = e.target.checked; drawSM(); } } }), 'Irrigation on this plot (bars, in)'),
      el('label', { className: 'toggle' }, el('input', { type: 'checkbox', checked: ex.smRain, on: { change: e => { ex.smRain = e.target.checked; drawSM(); } } }), 'Daily rain, CoAgMET FTC03 (bars, in)'),
      el('div', { className: 'hint', text: ds.note || '' }));

    const [irr, wx] = await Promise.all([Data.load('irrigation_events'), Data.load('weather_daily')]);
    function drawSM() {
      const idx = Data.filter(ds, { Plot: new Set([plot]) }, { key: 'Datetime', from: ex.smFrom, to: ex.smTo });
      const keys = ['Farm', 'Plot', 'Datetime'].concat(ex.smCols);
      current = { ds, idx, name: dsId + '_' + plot, keys };
      const lo = ex.smFrom ? Date.parse(ex.smFrom) : -Infinity, hi = ex.smTo ? Date.parse(ex.smTo) + 86400000 : Infinity;
      const lines = ex.smCols.map((k, n) => {
        const c = Data.col(ds, k); const a = ds.data[k]; const pts = [];
        for (const i of idx) if (a[i] !== null) pts.push([ds.data.Datetime[i] * 60000, a[i]]);
        return { name: c.label, type: 'line', showSymbol: false, sampling: 'lttb', data: pts, lineStyle: { width: 1.6 }, color: SM_COLORS[n % SM_COLORS.length], yAxisIndex: 0 };
      });
      const bars = [];
      if (ex.smIrr) {
        const ii = Data.filter(irr, { Plot: new Set([plot]), Year: new Set([year]) });
        const byDay = new Map(); ii.forEach(i => { const d = irr.data.Date[i]; byDay.set(d, (byDay.get(d) || 0) + (irr.data.Irrigation_in[i] || 0)); });
        bars.push({ name: 'Irrigation (in)', type: 'bar', yAxisIndex: 1, barMaxWidth: 6, color: '#22592A', data: [...byDay].filter(([d]) => Date.parse(d) >= lo && Date.parse(d) <= hi) });
      }
      if (ex.smRain) {
        const wi = Data.filter(wx, { Station: new Set(['CoAgMET FTC03']), Variable: new Set(['Precipitation']), Year: new Set([year]) });
        bars.push({ name: 'Rain (in)', type: 'bar', yAxisIndex: 1, barMaxWidth: 6, color: '#99D7F3', data: wi.map(i => [wx.data.Date[i], wx.data.Value[i]]).filter(([d, v]) => v > 0 && Date.parse(d) >= lo && Date.parse(d) <= hi) });
      }
      lastTable = Data.rowsFor(ds, idx, keys); $('tableTitle').textContent = 'Readings shown'; renderTable(lastTable, idx.length);
      chart.clear();
      if (!idx.length) { $('chartMsg').textContent = 'No readings for this plot in the date range.'; return; }
      $('chartMsg').textContent = '';
      const unit = (Data.col(ds, ex.smCols[0]) || {}).unit || '';
      chart.setOption({ animation: false, color: SM_COLORS, textStyle: { fontFamily: 'Segoe UI, Roboto, Arial, sans-serif' },
        title: { text: `${grp.toUpperCase()}, PLOT ${plot} (${farmOf(plot).toUpperCase()})`, left: 'center', top: 4, textStyle: { fontSize: 14, color: '#22592A' } },
        legend: { type: 'scroll', bottom: 0 }, grid: { left: 60, right: 60, top: 50, bottom: 90 },
        tooltip: { trigger: 'axis', confine: true, valueFormatter: v => Data.num1(v) },
        xAxis: { type: 'time' },
        yAxis: [{ type: 'value', name: `${grp}${unit ? ' (' + unit + ')' : ''}`, scale: true, axisLabel: { formatter: v => Data.num1(v) } },
          { type: 'value', name: 'Water (in)', position: 'right', splitLine: { show: false }, min: 0, axisLabel: { formatter: v => Data.num1(v) } }],
        dataZoom: [{ type: 'inside' }, { type: 'slider', bottom: 30 }],
        series: lines.concat(bars) }, true);
    }
    S.drawFn = drawSM;
    drawSM();
  }
})();
