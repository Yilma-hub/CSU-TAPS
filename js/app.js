/* CSU-TAPS data site: sign-in, navigation, controls, chart, table and downloads.
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
  let chart = null, current = null, lastTable = null;
  const S = { view: null, ds: null, st: null, special: null, extra: {} };

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
    window.addEventListener('resize', () => chart && chart.resize());
    await Data.getManifest();
    buildNav();
    window.addEventListener('hashchange', () => route());
    route();
  }

  (async () => { busy(true, 'Loading'); try { const who = await Crypt.resume(); if (who !== null) await start(who); } finally { busy(false); } })();

  // ---------------- navigation
  function buildNav() {
    const nav = $('nav'); nav.textContent = '';
    let g = null;
    for (const v of VIEWS) {
      if (v.group !== g) { g = v.group; nav.append(el('div', { className: 'grp', text: g })); }
      nav.append(el('a', { 'data-id': v.id, href: '#' + v.id, text: v.title }));
    }
  }
  async function route() {
    const id = (location.hash || '#map').slice(1);
    const tc = document.querySelector('.table-scroll');
    if (!$('table')) { tc.textContent = ''; tc.append(el('table', { id: 'table' })); tc.style.maxHeight = ''; }
    const v = VIEWS.find(x => x.id === id) || VIEWS[0];
    document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('active', a.dataset.id === v.id));
    S.view = v; $('pageTitle').textContent = v.title; $('pageNote').textContent = v.note || '';
    $('chartMsg').textContent = ''; chart.clear();
    const showChart = v.special !== 'downloads';
    document.querySelector('.chart-wrap').hidden = !showChart; document.querySelector('.head-actions').hidden = !showChart;
    $('tableTitle').textContent = 'Data';
    try {
      busy(true, 'Loading data');
      if (v.special === 'map') await pageMap();
      else if (v.special === 'sm') await pageSM();
      else if (v.special === 'downloads') await pageDownloads();
      else if (v.special === 'explore') await pageExplore();
      else await pageStandard(v.ds, v.st);
    } catch (e) { console.error(e); $('chartMsg').textContent = 'Could not load this page: ' + (e.message || e); }
    finally { busy(false); }
  }

  // ---------------- standard chart page
  function initState(ds, preset) {
    const st = JSON.parse(JSON.stringify(preset || {}));
    const cats = ds.columns.filter(c => c.type !== 'num'), nums = ds.columns.filter(c => c.type === 'num');
    st.type = st.type || 'bar';
    st.x = ds.data[st.x] ? st.x : (cats[1] || cats[0] || ds.columns[0]).key;
    st.ys = (st.ys || []).filter(k => ds.data[k]); if (!st.ys.length && nums.length) st.ys = [nums[nums.length - 1].key];
    st.agg = st.agg || 'mean';
    st.color = st.color && ds.data[st.color] ? st.color : null;
    const f = {};
    for (const [k, vals] of Object.entries(st.filters || {})) {
      if (!ds.data[k]) continue;
      const have = new Set(Data.uniques(ds, k)); const keep = vals.filter(v => have.has(v));
      if (keep.length) f[k] = new Set(keep);
    }
    st.filters = f;
    const dcol = ds.columns.find(c => c.type === 'date' || c.type === 'datetime');
    st.range = { key: dcol ? dcol.key : null, from: '', to: '' };
    return st;
  }

  async function pageStandard(dsId, preset, keepPanelTop) {
    const ds = await Data.load(dsId, m => busy(true, m));
    S.ds = ds; S.st = initState(ds, preset); S.special = null;
    renderPanel(keepPanelTop);
    draw();
  }

  async function pageExplore() {
    const man = await Data.getManifest();
    const list = man.datasets.filter(d => !d.id.startsWith('map_'));
    const id = S.extra.exploreId || 'plots';
    const top = el('div', { className: 'filter' },
      el('label', {}, 'Dataset', el('select', { id: 'dsSel', on: { change: async e => { S.extra.exploreId = e.target.value; busy(true, 'Loading data'); try { await pageStandard(e.target.value, null, top); } finally { busy(false); } } } },
        list.map(d => el('option', { value: d.id, text: `${d.title} (${d.n.toLocaleString()} rows)`, selected: d.id === id })))));
    await pageStandard(id, null, top);
  }

  const TYPES = [['bar', 'Bar'], ['stacked', 'Stacked bar'], ['hbar', 'Horizontal bar'], ['hstacked', 'Horizontal stacked bar'], ['line', 'Line'], ['area', 'Area'],
    ['scatter', 'Scatter (points)'], ['box', 'Box plot'], ['pie', 'Pie (percent)']];
  const AGGS = [['none', 'Each row (no grouping)'], ['mean', 'Mean'], ['sum', 'Sum'], ['count', 'Count'], ['min', 'Minimum'], ['max', 'Maximum'], ['median', 'Median']];

  function renderPanel(top) {
    const ds = S.ds, st = S.st, p = $('panel'); p.textContent = '';
    if (top) p.append(el('h3', { text: 'Dataset' }), top);
    p.append(el('h3', { text: 'Chart' }));
    const sel = (lab, key, opts, val, onChange) => el('label', {}, lab, el('select', { on: { change: e => { onChange(e.target.value); } } },
      opts.map(([v, t]) => el('option', { value: v, text: t, selected: String(v) === String(val) }))));
    p.append(sel('Chart type', 'type', TYPES, st.type, v => { st.type = v; if (v === 'box' || v === 'scatter') st.agg = 'none'; if (v === 'pie' && st.agg === 'none') st.agg = 'count'; renderPanel(top); draw(); }));
    const colOpts = ds.columns.map(c => [c.key, Data.label(c)]);
    p.append(sel('X axis', 'x', colOpts, st.x, v => { st.x = v; draw(); }));
    const nums = ds.columns.filter(c => c.type === 'num');
    const ybox = el('div', { className: 'checks' }, nums.map(c => el('label', {}, el('input', { type: 'checkbox', checked: st.ys.includes(c.key), on: { change: e => {
      st.ys = e.target.checked ? [...st.ys, c.key] : st.ys.filter(k => k !== c.key); draw(); } } }), Data.label(c))));
    p.append(el('div', { className: 'filter' }, el('div', { className: 'filter-head', text: st.type === 'pie' ? 'Value (first checked)' : 'Y axis (one or more)' }), ybox));
    p.append(sel('Combine rows with the same X', 'agg', AGGS, st.agg, v => { st.agg = v; draw(); }));
    p.append(sel('Group / color by', 'color', [['', 'None']].concat(ds.columns.filter(c => c.type === 'cat').map(c => [c.key, Data.label(c)])), st.color || '', v => { st.color = v || null; draw(); }));
    p.append(el('label', { className: 'toggle' }, el('input', { type: 'checkbox', checked: !!st.cumulative, on: { change: e => { st.cumulative = e.target.checked; draw(); } } }), 'Running total along X'));
    p.append(el('div', { className: 'hint', text: 'Mean, sum and the others combine all rows that share an X value (and group). Filters apply first.' }));

    p.append(el('h3', { text: 'Filters' }));
    if (st.range.key) {
      const rc = Data.col(ds, st.range.key);
      p.append(el('div', { className: 'filter' }, el('div', { className: 'filter-head', text: `${rc.label} range` }),
        el('div', { className: 'row' },
          el('input', { type: 'date', value: st.range.from, on: { change: e => { st.range.from = e.target.value; draw(); } } }),
          el('input', { type: 'date', value: st.range.to, on: { change: e => { st.range.to = e.target.value; draw(); } } }))));
    }
    for (const c of ds.columns.filter(c => c.type === 'cat')) {
      const vals = Data.uniques(ds, c.key);
      if (vals.length < 2 || vals.length > 400) continue;
      p.append(filterBox(c, vals));
    }
  }

  function filterBox(c, vals) {
    const st = S.st;
    const box = el('div', { className: 'checks' });
    const set = st.filters[c.key];
    const boxes = vals.map(v => {
      const cb = el('input', { type: 'checkbox', checked: !set || set.has(v), on: { change: () => { sync(); } } }); cb._v = v;
      box.append(el('label', {}, cb, Data.fmt(v, c) || '(blank)')); return cb;
    });
    function sync() {
      const on = boxes.filter(b => b.checked).map(b => b._v);
      if (on.length === vals.length) delete st.filters[c.key]; else st.filters[c.key] = new Set(on);
      draw();
    }
    const all = () => { boxes.forEach(b => (b.checked = true)); sync(); };
    const none = () => { boxes.forEach(b => (b.checked = false)); sync(); };
    return el('div', { className: 'filter' }, el('div', { className: 'filter-head' }, el('span', { text: Data.label(c) }),
      el('span', { className: 'links' }, el('a', { text: 'All', on: { click: all } }), el('a', { text: 'None', on: { click: none } }))), box);
  }

  function draw() {
    const ds = S.ds, st = S.st;
    const idx = Data.filter(ds, st.filters, st.range);
    current = { ds, idx };
    chart.clear(); $('chartMsg').textContent = '';
    if (!idx.length) { $('chartMsg').textContent = 'No rows match the filters.'; renderTable([['No rows']], 0); return; }
    if (!st.ys.length) { $('chartMsg').textContent = 'Choose at least one Y value.'; return; }
    let res = null;
    try { res = Charts.build(ds, idx, st); } catch (e) { console.error(e); }
    if (!res) { $('chartMsg').textContent = 'This combination cannot be drawn. Try another X, Y or chart type.'; return; }
    res.option.title = [].concat(res.option.title || [], [{ text: (S.view.special === 'explore' ? ds.title : S.view.title).toUpperCase(), left: 'center', top: 4,
      textStyle: { fontSize: 14, fontWeight: 600, color: '#22592A', letterSpacing: 1 } }]);
    chart.setOption(res.option, true);
    lastTable = res.table;
    $('tableTitle').textContent = 'Values in the chart';
    renderTable(res.table, idx.length);
  }

  function renderTable(rows, nRows) {
    const t = $('table'); t.textContent = '';
    if (!rows || !rows.length) return;
    t.append(el('thead', {}, el('tr', {}, rows[0].map(h => el('th', { text: h })))));
    const body = el('tbody');
    const show = rows.slice(1, 301);
    for (const r of show) body.append(el('tr', {}, r.map(v => el('td', { className: typeof v === 'number' ? 'num' : null, text: v === null || v === undefined ? '' : v }))));
    t.append(body);
    $('tableInfo').textContent = `${nRows ? nRows.toLocaleString() + ' filtered rows. ' : ''}Table shows ${show.length} of ${(rows.length - 1).toLocaleString()} lines.`;
  }

  // ---------------- downloads (buttons above the chart)
  const stamp = () => new Date().toISOString().slice(0, 10);
  $('csvBtn').addEventListener('click', () => {
    if (!current) return;
    const { ds, idx } = current;
    Data.downloadCSV(`CSU_TAPS_${ds.id}_filtered_${stamp()}.csv`, Data.rowsFor(ds, idx, ds.columns.map(c => c.key)));
  });
  $('xlsxBtn').addEventListener('click', async () => {
    if (!current) return;
    const { ds, idx } = current;
    busy(true, 'Building the Excel file');
    try {
      await Data.downloadXLSX(`CSU_TAPS_${ds.id}_filtered_${stamp()}.xlsx`, [
        ['Data', Data.rowsFor(ds, idx, ds.columns.map(c => c.key))],
        ['Read_me', [['CSU-TAPS data, organized by Wub Yilma'], [ds.title], [ds.note || ''], [`Filtered rows: ${idx.length} of ${ds.n}`], [`Downloaded ${stamp()}`]]]]);
    } finally { busy(false); }
  });
  $('csvChartBtn').addEventListener('click', () => { if (lastTable) Data.downloadCSV(`CSU_TAPS_chart_values_${stamp()}.csv`, lastTable); });
  $('pngBtn').addEventListener('click', () => {
    if (!chart) return;
    const a = document.createElement('a'); a.href = chart.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: '#fff' });
    a.download = `CSU_TAPS_${S.view.id}_${stamp()}.png`; document.body.appendChild(a); a.click(); a.remove();
  });

  // ---------------- plot map
  async function pageMap() {
    const plots = await Data.load('plots');
    S.ds = plots; S.special = 'map';
    const year = S.extra.mapYear || 2025, colorBy = S.extra.mapColor || 'User_Average_Yield_bu_ac';
    const geo = await Data.load('map_' + year);
    echarts.registerMap('plots_' + year, geo);
    const p = $('panel'); p.textContent = '';
    p.append(el('h3', { text: 'Map' }),
      el('label', {}, 'Season', el('select', { on: { change: e => { S.extra.mapYear = +e.target.value; route(); } } }, [2024, 2025].map(y => el('option', { value: y, text: y, selected: y === year })))),
      el('label', {}, 'Color plots by', el('select', { on: { change: e => { S.extra.mapColor = e.target.value; route(); } } },
        plots.columns.filter(c => !['Year', 'Plot'].includes(c.key)).map(c => el('option', { value: c.key, text: Data.label(c), selected: c.key === colorBy })))),
      el('div', { className: 'hint', text: 'Border and fill strips have no data. Hover a plot for its values; the table lists every plot in the season.' }));
    const idx = Data.filter(plots, { Year: new Set([year]) });
    const c = Data.col(plots, colorBy);
    const data = idx.map(i => ({ name: plots.data.Plot[i], value: plots.data[colorBy][i], farm: plots.data.Farm[i], team: plots.data.Team[i], track: plots.data.Track[i] }));
    const numeric = c.type === 'num';
    const o = { animation: false, tooltip: { trigger: 'item', formatter: prm => { const d = prm.data; return d ? `Plot ${esc(prm.name)}<br>Farm ${esc(d.farm)} ${esc(d.team || '')} (${esc(d.track || '')})<br>${esc(Data.label(c))}: ${esc(Data.fmt(d.value, c))}` : esc(prm.name); } },
      series: [{ type: 'map', map: 'plots_' + year, nameProperty: 'Plot', aspectScale: 0.76, roam: true, data,
        label: { show: true, fontSize: 9, color: '#1F2A22', formatter: prm => (/^\d{1,2}[A-I]$/.test(prm.name) ? prm.name : '') }, itemStyle: { borderColor: '#fff', borderWidth: 1, areaColor: '#E5E7E1' },
        emphasis: { label: { show: true }, itemStyle: { areaColor: '#C8C372' } }, select: { disabled: true } }] };
    if (numeric) {
      const vals = data.map(d => d.value).filter(v => typeof v === 'number');
      o.visualMap = { type: 'continuous', min: Math.min(...vals), max: Math.max(...vals), calculable: true, left: 10, bottom: 20, text: ['High', 'Low'],
        inRange: { color: ['#F4F2DE', '#C8C372', '#6C9A5A', '#1E4D2B'] } };
    } else {
      const cats = [...new Set(data.map(d => d.value).filter(v => v !== null && v !== undefined))].sort(Data.sortVals);
      o.visualMap = { type: 'piecewise', categories: cats.map(String), left: 10, top: 10, inRange: { color: Charts.PALETTE } };
      data.forEach(d => { d.value = d.value === null || d.value === undefined ? null : String(d.value); });
    }
    chart.setOption(o, true);
    current = { ds: plots, idx };
    const rows = [['Plot', 'Farm', 'Team', 'Track', Data.label(c)]].concat(data.map(d => [d.name, d.farm, d.team, d.track, d.value]));
    lastTable = rows; $('tableTitle').textContent = `Plots, ${year}`; renderTable(rows, idx.length);
  }
  const esc = s => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

  // ---------------- soil moisture (CropX style)
  const SM_COLORS = ['#347AAF', '#E67354', '#F0C367', '#1F2A22', '#4F8A5B', '#8C7A2B', '#6B4E8C', '#3E9C9C', '#A33A3A', '#7A9A01', '#12375C', '#C25B8D'];
  function smGroup(label) {
    if (label.includes(':')) return label.split(':')[0].trim();
    return label.replace(/^Sensor \d+ /, '').replace(/ [MCT]\d\d.*$/, '').replace(/ \d+ cm.*$/, '').trim();
  }
  async function pageSM() {
    const man = await Data.getManifest();
    const sens = man.datasets.filter(d => d.id.startsWith('sm_'));
    const dsId = S.extra.smDs && sens.find(d => d.id === S.extra.smDs) ? S.extra.smDs : (sens.find(d => d.id === 'sm_aquaspy_2025') || sens[0]).id;
    const ds = await Data.load(dsId, m => busy(true, m));
    S.ds = ds; S.special = 'sm';
    const year = ds.data.Year[0];
    const plotsHere = Data.uniques(ds, 'Plot');
    const plot = plotsHere.includes(S.extra.smPlot) ? S.extra.smPlot : plotsHere[0];
    const series = ds.columns.filter(c => c.type === 'num');
    const groups = [...new Set(series.map(c => smGroup(c.label)))].sort((a, b) => (b.startsWith('Moisture') - a.startsWith('Moisture')));
    const grp = groups.includes(S.extra.smGroup) ? S.extra.smGroup : groups[0];
    const inGrp = series.filter(c => smGroup(c.label) === grp);
    if (!S.extra.smCols || !S.extra.smCols.every(k => inGrp.find(c => c.key === k))) S.extra.smCols = inGrp.slice(0, 6).map(c => c.key);
    const ex = S.extra; ex.smIrr = ex.smIrr !== false; ex.smRain = ex.smRain !== false;
    const farmOf = p => { const i = ds.data.Plot.indexOf(p); return i >= 0 ? `farm ${ds.data.Farm[i]}${ds.data.Team[i] ? ', ' + ds.data.Team[i] : ''}` : ''; };

    const p = $('panel'); p.textContent = '';
    p.append(el('h3', { text: 'Probe' }),
      el('label', {}, 'Sensor and season', el('select', { on: { change: e => { S.extra.smDs = e.target.value; S.extra.smCols = null; route(); } } },
        sens.map(d => el('option', { value: d.id, text: d.title, selected: d.id === dsId })))),
      el('label', {}, 'Plot', el('select', { on: { change: e => { S.extra.smPlot = e.target.value; route(); } } },
        plotsHere.map(pl => el('option', { value: pl, text: `${pl} (${farmOf(pl)})`, selected: pl === plot })))),
      el('label', {}, 'Measurement', el('select', { on: { change: e => { S.extra.smGroup = e.target.value; S.extra.smCols = null; route(); } } },
        groups.map(g => el('option', { value: g, text: g, selected: g === grp })))));
    const cb = el('div', { className: 'checks' }, inGrp.map(c => el('label', {}, el('input', { type: 'checkbox', checked: ex.smCols.includes(c.key), on: { change: e => {
      ex.smCols = e.target.checked ? [...ex.smCols, c.key] : ex.smCols.filter(k => k !== c.key); drawSM(); } } }), c.label)));
    p.append(el('div', { className: 'filter' }, el('div', { className: 'filter-head', text: 'Depths / series' }), cb));
    ex.smFrom = ex.smFrom || ''; ex.smTo = ex.smTo || '';
    p.append(el('div', { className: 'filter' }, el('div', { className: 'filter-head', text: 'Date range' }), el('div', { className: 'row' },
      el('input', { type: 'date', value: ex.smFrom, on: { change: e => { ex.smFrom = e.target.value; drawSM(); } } }),
      el('input', { type: 'date', value: ex.smTo, on: { change: e => { ex.smTo = e.target.value; drawSM(); } } }))));
    p.append(el('h3', { text: 'Show with the probe' }),
      el('label', { className: 'toggle' }, el('input', { type: 'checkbox', checked: ex.smIrr, on: { change: e => { ex.smIrr = e.target.checked; drawSM(); } } }), 'Irrigation on this plot (bars, in)'),
      el('label', { className: 'toggle' }, el('input', { type: 'checkbox', checked: ex.smRain, on: { change: e => { ex.smRain = e.target.checked; drawSM(); } } }), 'Daily rain, CoAgMET FTC03 (bars, in)'),
      el('div', { className: 'hint', text: ds.note || '' }));

    const [irr, wx] = await Promise.all([Data.load('irrigation_events'), Data.load('weather_daily')]);
    function drawSM() {
      const range = { key: 'Datetime', from: ex.smFrom, to: ex.smTo };
      const idx = Data.filter(ds, { Plot: new Set([plot]) }, range);
      current = { ds, idx };
      const lo = ex.smFrom ? Date.parse(ex.smFrom) : -Infinity, hi = ex.smTo ? Date.parse(ex.smTo) + 86400000 : Infinity;
      const lines = ex.smCols.map((k, n) => {
        const c = Data.col(ds, k); const a = ds.data[k];
        const pts = []; for (const i of idx) if (a[i] !== null) pts.push([ds.data.Datetime[i] * 60000, a[i]]);
        return { name: c.label, type: 'line', showSymbol: false, sampling: 'lttb', data: pts, lineStyle: { width: 1.6 }, color: SM_COLORS[n % SM_COLORS.length], yAxisIndex: 0 };
      });
      const bars = [];
      if (ex.smIrr) {
        const ii = Data.filter(irr, { Plot: new Set([plot]), Year: new Set([year]) });
        const byDay = new Map(); ii.forEach(i => { const d = irr.data.Date[i]; byDay.set(d, (byDay.get(d) || 0) + (irr.data.Irrigation_in[i] || 0)); });
        bars.push({ name: 'Irrigation (in)', type: 'bar', yAxisIndex: 1, barMaxWidth: 6, color: '#1E4D2B', data: [...byDay].filter(([d]) => Date.parse(d) >= lo && Date.parse(d) <= hi).map(([d, v]) => [d, Math.round(v * 1000) / 1000]) });
      }
      if (ex.smRain) {
        const wi = Data.filter(wx, { Station: new Set(['CoAgMET FTC03']), Variable: new Set(['Precipitation']), Year: new Set([year]) });
        bars.push({ name: 'Rain (in)', type: 'bar', yAxisIndex: 1, barMaxWidth: 6, color: '#99D7F3', data: wi.map(i => [wx.data.Date[i], wx.data.Value[i]]).filter(([d, v]) => v > 0 && Date.parse(d) >= lo && Date.parse(d) <= hi) });
      }
      chart.clear();
      if (!idx.length) { $('chartMsg').textContent = 'No readings for this plot in the date range.'; return; }
      $('chartMsg').textContent = '';
      const unit = (Data.col(ds, ex.smCols[0]) || {}).unit || '';
      chart.setOption({ animation: false, color: SM_COLORS, textStyle: { fontFamily: 'Segoe UI, Roboto, Arial, sans-serif' },
        title: { text: `${plot} (${farmOf(plot)})`, left: 'center', top: 0, textStyle: { fontSize: 14, color: '#1E4D2B' } },
        legend: { type: 'scroll', bottom: 0 }, grid: { left: 60, right: 60, top: 40, bottom: 90 },
        tooltip: { trigger: 'axis', confine: true },
        xAxis: { type: 'time' },
        yAxis: [{ type: 'value', name: `${grp}${unit ? ' (' + unit + ')' : ''}`, scale: true }, { type: 'value', name: 'Water (in)', position: 'right', splitLine: { show: false }, min: 0 }],
        dataZoom: [{ type: 'inside' }, { type: 'slider', bottom: 30 }],
        series: lines.concat(bars) }, true);
      const keys = ['Datetime'].concat(ex.smCols);
      const rows = Data.rowsFor(ds, idx, ['Farm', 'Plot'].concat(keys));
      lastTable = rows; $('tableTitle').textContent = 'Readings shown'; renderTable(rows, idx.length);
    }
    drawSM();
  }

  // ---------------- downloads page
  async function pageDownloads() {
    const man = await Data.getManifest();
    const p = $('panel'); p.textContent = '';
    p.append(el('h3', { text: 'About the files' }), el('div', { className: 'hint', text: 'CSV opens in Excel and any statistics software. Excel files include a Read_me sheet. Large soil moisture files take a few seconds to prepare.' }));
    $('tableTitle').textContent = 'Datasets';
    const wrap = el('div', { className: 'dl-list' });
    const groups = [...new Set(man.datasets.map(d => d.group))];
    for (const d of man.datasets.filter(d => !d.id.startsWith('map_'))) {
      const getRows = async () => { busy(true, 'Loading ' + d.title); try { const ds = await Data.load(d.id); return [ds, Data.rowsFor(ds, [...Array(ds.n).keys()], ds.columns.map(c => c.key))]; } finally { busy(false); } };
      wrap.append(el('div', { className: 'card dl-item' }, el('h4', { text: d.title }), el('div', { className: 'hint', text: `${d.group}. ${d.n.toLocaleString()} rows, ${d.columns.length} columns.` }),
        el('div', { className: 'hint', text: d.note || '' }),
        el('div', { className: 'actions' },
          el('button', { className: 'btn small', text: 'CSV', on: { click: async () => { const [ds, rows] = await getRows(); Data.downloadCSV(`CSU_TAPS_${ds.id}_${stamp()}.csv`, rows); } } }),
          el('button', { className: 'btn small primary', text: 'Excel', on: { click: async () => { const [ds, rows] = await getRows(); busy(true, 'Building the Excel file');
            try { await Data.downloadXLSX(`CSU_TAPS_${ds.id}_${stamp()}.xlsx`, [['Data', rows], ['Read_me', [['CSU-TAPS data, organized by Wub Yilma'], [ds.title], [ds.note || ''], [`Rows: ${ds.n}`], [`Downloaded ${stamp()}`]]]]); } finally { busy(false); } } } }))));
    }
    const t = $('table'); t.textContent = ''; $('tableInfo').textContent = `${man.datasets.length - 2} datasets in ${groups.length} groups.`;
    const tc = document.querySelector('.table-scroll'); tc.textContent = ''; tc.append(wrap);
    tc.style.maxHeight = 'none';
  }
})();
