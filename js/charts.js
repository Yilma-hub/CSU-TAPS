/* ECharts options from a chart state. No statistics beyond grouping (sum, mean, count, min, max, median) and box plot quartiles. */
'use strict';
const Charts = (() => {
  // colors taken from the 2025 CSU-TAPS report figures (green, navy, orange, olive) plus CSU gold
  const PALETTE = ['#22592A', '#23518F', '#CD711B', '#817922', '#C8C372', '#6CA818', '#59595B', '#8EA6C5', '#A33A3A', '#3E9C9C',
    '#1E4D2B', '#6F8DB6', '#E4900C', '#B8B483', '#6B4E8C', '#C25B8D', '#2C8C6C', '#9C6B30', '#12375C', '#7E2E2E'];
  // color choices (named after the ArcGIS Pro color schemes they follow)
  const PALETTES = {
    'CSU-TAPS report': PALETTE,
    'ArcGIS Basic Random': ['#E69800', '#4C7300', '#005CE6', '#A83800', '#8400A8', '#38A800', '#FFAA00', '#0070FF', '#E60000', '#00A884', '#FF73DF', '#734C00', '#73B2FF', '#A87000', '#55FF00', '#C500FF', '#004DA8', '#FF7F7F', '#267300', '#828282'],
    'ArcGIS Bold': ['#E60000', '#0070FF', '#38A800', '#FFAA00', '#A900E6', '#00C5FF', '#FF00C5', '#734C00', '#4C7300', '#002673', '#A83800', '#00A884'],
    'Pastel': ['#8DD3C7', '#BEBADA', '#FB8072', '#80B1D3', '#FDB462', '#B3DE69', '#FCCDE5', '#BC80BD', '#CCEBC5', '#FFED6F', '#D9D9D9', '#FFFFB3'],
    'Colorblind safe': ['#0072B2', '#E69F00', '#009E73', '#D55E00', '#CC79A7', '#56B4E9', '#F0E442', '#000000', '#999999', '#882255', '#44AA99', '#117733'],
    'Earth tones': ['#8C510A', '#BF812D', '#DFC27D', '#80CDC1', '#35978F', '#01665E', '#543005', '#003C30', '#C7EAE5', '#F6E8C3'],
    'Grayscale': ['#1A1A1A', '#4D4D4D', '#7F7F7F', '#A6A6A6', '#CCCCCC', '#333333', '#666666', '#999999'],
  };
  const RAMPS = {
    'Red-Yellow-Green': ['#B2182B', '#EF8A62', '#FDDB85', '#A6D96A', '#1A9641'],
    'Spectral': ['#9E0142', '#F46D43', '#FEE08B', '#E6F598', '#66C2A5', '#5E4FA2'],
    'Precipitation': ['#FFFFCC', '#A1DAB4', '#41B6C4', '#2C7FB8', '#253494'],
    'Temperature': ['#313695', '#74ADD1', '#FFFFBF', '#F46D43', '#A50026'],
    'Yellow-Orange-Brown': ['#FFFFD4', '#FED98E', '#FE9929', '#D95F0E', '#993404'],
    'Yellow-Green': ['#FFFFCC', '#C2E699', '#78C679', '#31A354', '#006837'],
    'Greens': ['#EDF8E9', '#BAE4B3', '#74C476', '#31A354', '#006D2C'],
    'Blues': ['#EFF3FF', '#BDD7E7', '#6BAED6', '#3182BD', '#08519C'],
    'Red-Blue (diverging)': ['#B2182B', '#EF8A62', '#F7F7F7', '#67A9CF', '#2166AC'],
    'Elevation': ['#38A800', '#A8E600', '#FFFF73', '#E6A800', '#A83800', '#FFFFFF'],
    'Viridis': ['#440154', '#3B528B', '#21918C', '#5EC962', '#FDE725'],
    'Magma': ['#000004', '#51127C', '#B63679', '#FB8861', '#FCFDBF'],
  };
  let PAL = PALETTE;
  function setPalette(name) { PAL = PALETTES[name] || PALETTE; }
  const base = () => ({
    color: PAL, animation: false,
    textStyle: { fontFamily: 'Segoe UI, Roboto, Arial, sans-serif', color: '#1F2A22' },
    grid: { left: 70, right: 70, top: 96, bottom: 90, containLabel: true },
    tooltip: { trigger: 'axis', confine: true, valueFormatter: v => Data.num1(v) },
    legend: { type: 'scroll', top: 32, left: 10, right: 110 },
    toolbox: { right: 10, top: 34, feature: { dataZoom: { yAxisIndex: 'none', title: { zoom: 'Zoom', back: 'Undo zoom' } }, restore: { title: 'Reset' } } },
  });
  const isTime = c => c && (c.type === 'date' || c.type === 'datetime');
  const tval = (v, c) => c.type === 'datetime' ? v * 60000 : v;   // ECharts time axis takes ms or ISO date strings

  let CUR = null;   // rows currently charted, so axis names can pick up the unit of long-format data
  function axisName(ds, key) {
    const c = Data.col(ds, key);
    if (c && c.type === 'num' && !c.unit && CUR && ds.data.Unit) {
      const u = Data.uniques(ds, 'Unit', CUR).filter(x => x !== '' && x !== null);
      const v = ds.data.Variable ? Data.uniques(ds, 'Variable', CUR) : [];
      const nm = v.length === 1 && key === 'Value' ? v[0] : c.label;
      if (u.length === 1) return `${nm} (${u[0]})`;
      if (v.length === 1 && key === 'Value') return nm;
    }
    return Data.label(c);
  }

  // ---- axis helpers: y title vertical beside the values; room for the widest tick label
  function gapFor(vals) {
    let m = 0;
    for (const v of vals) if (typeof v === 'number' && isFinite(v)) m = Math.max(m, Math.abs(v));
    const txt = Data.num1(m) || '0';
    return 18 + 7.2 * (String(txt).replace(/,/g, '').length + (vals.some(v => v < 0) ? 1 : 0) + (m >= 1000 ? 1 : 0));
  }
  function valueAxis(name, vals, side, extra) {
    return Object.assign({ type: 'value', name, nameLocation: 'middle', nameRotate: side === 'right' ? -90 : 90, nameGap: gapFor(vals), position: side,
      nameTextStyle: { fontWeight: 600, color: '#1F2A22' }, splitLine: { show: side !== 'right' } }, extra || {});
  }
  const seriesVals = s => s.data.map(d => (Array.isArray(d) ? d[1] : d));
  function joinNames(a) { const u = [...new Set(a.filter(Boolean))]; return u.join(' / '); }
  function namedFor(ds, y, idx) { const keep = CUR; CUR = idx; const n = axisName(ds, y); CUR = keep; return n; }

  function build(ds, idx, st) {
    CUR = idx;
    const o = base();
    const xc = Data.col(ds, st.x);
    const ys = st.ys.filter(k => ds.data[k]);
    const extras = (st._extras || []).filter(e => ds.data[e.y]);
    if (!xc || (!ys.length && !extras.length)) return null;
    const right = new Set(st.right || []);
    const yName = ys.length === 1 ? axisName(ds, ys[0]) : (st.agg === 'count' ? 'Count' : 'Value');

    if (st.type === 'pie') return pie(ds, idx, st, o);
    const horizontal = st.type === 'hbar' || st.type === 'hstacked';
    const leftNames = [], rightNames = [];

    if (st.agg === 'none' && st.type !== 'box') {
      // every row is a point
      const groups = st.color ? Data.uniques(ds, st.color, idx) : [null];
      const ca = st.color ? ds.data[st.color] : null;
      const series = [];
      const pointsFor = (y, rows, g, cagg) => {
        const ya = ds.data[y], xa = ds.data[st.x], pts = [];
        for (const i of rows) { if (cagg && cagg[i] !== g) continue; if (ya[i] === null || ya[i] === undefined || xa[i] === null) continue; pts.push([isTime(xc) ? tval(xa[i], xc) : xa[i], ya[i]]); }
        if (isTime(xc) || xc.type === 'num') pts.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
        return pts;
      };
      const mk = (name, pts, onRight, kind, cum) => {
        const s = { name, data: pts, type: kind === 'scatter' ? 'scatter' : 'line', symbolSize: 6, yAxisIndex: onRight ? 1 : 0 };
        if (s.type === 'line') Object.assign(s, { showSymbol: pts.length < 60, sampling: 'lttb', connectNulls: false, lineStyle: { width: 1.6 } });
        if (kind === 'area') s.areaStyle = { opacity: 0.25 };
        if (cum) { let c = 0; s.data = pts.map(p => [p[0], (c += p[1])]); }
        return s;
      };
      for (const y of ys) {
        for (const g of groups) {
          const pts = pointsFor(y, idx, g, ca);
          if (!pts.length) continue;
          const name = [ys.length > 1 ? axisName(ds, y) : null, g !== null ? String(g) : null].filter(Boolean).join(' | ') || axisName(ds, y);
          series.push(mk(name, pts, right.has(y), st.type, st.cumulative));
          (right.has(y) ? rightNames : leftNames).push(axisName(ds, y));
        }
      }
      for (const e of extras) {
        const pts = pointsFor(e.y, e.idx, null, null);
        if (!pts.length) continue;
        series.push(mk(e.label, pts, e.right, e.kind === 'bar' ? 'line' : (st.type === 'scatter' ? 'scatter' : 'line'), e.cum));
        (e.right ? rightNames : leftNames).push(e.unitName || namedFor(ds, e.y, e.idx));
      }
      CUR = idx;
      o.xAxis = { type: isTime(xc) ? 'time' : (xc.type === 'num' ? 'value' : 'category'), name: axisName(ds, st.x), nameLocation: 'middle', nameGap: 30, scale: xc.type === 'num', axisLabel: { rotate: 0, hideOverlap: true } };
      if (o.xAxis.type === 'category') o.xAxis.data = Data.uniques(ds, st.x, idx);
      const lv = series.filter(s => !s.yAxisIndex).flatMap(seriesVals), rv = series.filter(s => s.yAxisIndex).flatMap(seriesVals);
      o.yAxis = [valueAxis(joinNames(leftNames) || yName, lv, 'left', { scale: true })];
      if (rv.length) o.yAxis.push(valueAxis(joinNames(rightNames), rv, 'right', { scale: true }));
      else series.forEach(s => (s.yAxisIndex = 0));
      o.series = series;
      if (st.type === 'scatter') o.tooltip = { trigger: 'item', confine: true, formatter: p => `${esc(p.seriesName)}<br>${esc(axisName(ds, st.x))}: ${esc(isTime(xc) ? new Date(p.value[0]).toISOString().slice(0, 10) : Data.num1(p.value[0]))}<br>${Data.num1(p.value[1])}` };
      o.dataZoom = [{ type: 'inside' }, { type: 'slider', bottom: 20 }];
      return { option: o, table: pointTable(series, axisName(ds, st.x), joinNames(leftNames.concat(rightNames)) || yName, xc) };
    }

    const agg = st.type === 'box' ? 'box' : st.agg;
    if (st.type === 'box') {
      const g2 = groupBins(ds, idx, st.x, ys[0], st.color);
      o.xAxis = { type: 'category', data: g2.xs.map(String), name: axisName(ds, st.x), nameLocation: 'middle', nameGap: 30, axisLabel: { rotate: 0, hideOverlap: true } };
      const allv = g2.series.flatMap(s => s.bins.flat());
      o.yAxis = valueAxis(axisName(ds, ys[0]), allv, 'left', { scale: true });
      o.series = g2.series.map(s => ({ name: s.name, type: 'boxplot', data: s.bins.map(b => Data.boxStats(b) || '-') }));
      o.tooltip = { trigger: 'item', confine: true, formatter: p => { const v = p.value.slice(-5); return `${esc(p.seriesName)} ${esc(p.name)}<br>Max ${Data.num1(v[4])}<br>Q3 ${Data.num1(v[3])}<br>Median ${Data.num1(v[2])}<br>Q1 ${Data.num1(v[1])}<br>Min ${Data.num1(v[0])}`; } };
      const rows = [['Group', axisName(ds, st.x), 'Min', 'Q1', 'Median', 'Q3', 'Max', 'n']];
      g2.series.forEach(s => s.bins.forEach((b, i) => { const q = Data.boxStats(b); if (q) rows.push([s.name, g2.xs[i], ...q.map(r4), b.length]); }));
      return { option: o, table: rows };
    }
    const g = ys.length ? Data.group(ds, idx, st.x, ys, agg, st.color) : { xs: [], series: [] };
    // extra lines: grouped the same way, placed on the same X values
    const eg = extras.map(e => ({ e, r: Data.group(ds, e.idx, st.x, [e.y], agg === 'count' ? 'count' : agg, null) }));
    let xs = g.xs.slice();
    for (const { r } of eg) for (const v of r.xs) if (!xs.includes(v)) xs.push(v);
    if (eg.length && xs.length !== g.xs.length) xs.sort(Data.sortVals);
    const pos = new Map(xs.map((v, i) => [v, i]));
    const realign = (srcXs, data) => { const out = xs.map(() => null); srcXs.forEach((v, i) => { out[pos.get(v)] = data[i]; }); return out; };
    const xsLabels = xs.map(v => (xc.type === 'datetime' ? Data.fmt(v, xc) : v));
    const stacked = st.type === 'stacked' || st.type === 'hstacked';
    const lineLike = st.type === 'line' || st.type === 'area';
    const cumul = (data, on) => { if (!on) return data; let c = 0; return data.map(v => (v === null ? c : (c += v))); };
    const toSeries = (name, data, t, onRight, isExtra) => {
      const out = { name, type: t, data: isTime(xc) && t === 'line' && !horizontal ? data.map((v, i) => [tval(xs[i], xc), v]) : data, connectNulls: true, yAxisIndex: onRight ? 1 : 0 };
      if (stacked && !isExtra) out.stack = 'all' + (onRight ? 'R' : 'L');
      if (st.type === 'area' && t === 'line' && !isExtra) out.areaStyle = { opacity: 0.25 };
      if (t === 'bar') out.barMaxWidth = 38;
      if (t === 'line') Object.assign(out, { showSymbol: data.length < 60, symbolSize: 6, lineStyle: { width: isExtra ? 2.2 : 1.6 } });
      return out;
    };
    o.series = g.series.map(s => {
      const onRight = right.has(s.y);
      (onRight ? rightNames : leftNames).push(st.agg === 'count' ? 'Count' : axisName(ds, s.y));
      return toSeries(s.name, cumul(realign(g.xs, s.data), st.cumulative), lineLike ? 'line' : 'bar', onRight, false);
    });
    for (const { e, r } of eg) {
      if (!r.series.length) continue;
      (e.right ? rightNames : leftNames).push(agg === 'count' ? 'Count' : (e.unitName || namedFor(ds, e.y, e.idx)));
      o.series.push(toSeries(e.label, cumul(realign(r.xs, r.series[0].data), e.cum), e.kind === 'bar' ? 'bar' : 'line', e.right, true));
    }
    CUR = idx;
    if (!o.series.length) return null;
    // bars grouped by color where each X has only one group (for example farm colored by track): center them instead of leaving gaps
    const bars = o.series.filter(s => s.type === 'bar' && !s.stack);
    if (!stacked && bars.length > 1 && xs.every((_, i) => bars.filter(s => s.data[i] !== null && s.data[i] !== undefined).length <= 1)) bars.forEach(s => (s.stack = 'one'));
    const many = xsLabels.length;
    const catAxis = { type: 'category', data: xsLabels.map(String), name: axisName(ds, st.x), nameLocation: 'middle', nameGap: horizontal ? 60 : 30,
      nameTextStyle: { fontWeight: 600, color: '#1F2A22' }, axisLabel: { hideOverlap: true, rotate: 0, interval: !horizontal && many <= 45 ? 0 : 'auto', fontSize: many > 30 ? 10 : 12 } };
    const lv = o.series.filter(s => !s.yAxisIndex).flatMap(seriesVals), rv = o.series.filter(s => s.yAxisIndex).flatMap(seriesVals);
    const leftName = joinNames(leftNames) || yName;
    if (horizontal) {
      o.series.forEach(s => (s.yAxisIndex = 0));
      o.yAxis = catAxis; o.xAxis = { type: 'value', name: leftName, nameLocation: 'middle', nameGap: 30, nameTextStyle: { fontWeight: 600 } };
      o.grid.left = 110; o.tooltip.axisPointer = { type: 'shadow' };
    } else {
      o.yAxis = [valueAxis(leftName, lv, 'left')];
      if (rv.length) o.yAxis.push(valueAxis(joinNames(rightNames), rv, 'right'));
      else o.series.forEach(s => (s.yAxisIndex = 0));
      if (isTime(xc) && o.series.every(s => s.type === 'line')) o.xAxis = { type: 'time', name: axisName(ds, st.x), nameLocation: 'middle', nameGap: 30, nameTextStyle: { fontWeight: 600 } };
      else { o.xAxis = catAxis; if (isTime(xc)) o.series.forEach(s => { if (Array.isArray(s.data[0])) s.data = s.data.map(d => d[1]); }); }
      o.tooltip.axisPointer = { type: lineLike ? 'line' : 'shadow' };
    }
    if (many > 25 && !horizontal) o.dataZoom = [{ type: 'inside' }, { type: 'slider', bottom: 20 }];
    const rows = [[axisName(ds, st.x)].concat(o.series.map(s => s.name))];
    xs.forEach((v, i) => rows.push([xsLabels[i]].concat(o.series.map(s => { const d = s.data[i]; return r4(Array.isArray(d) ? d[1] : d); }))));
    return { option: o, table: rows };
  }

  function groupBins(ds, idx, x, y, color) {
    const xs = Data.uniques(ds, x, idx), groups = color ? Data.uniques(ds, color, idx) : [null];
    const pos = new Map(xs.map((v, i) => [v, i])); const xa = ds.data[x], ya = ds.data[y], ca = color ? ds.data[color] : null;
    const series = groups.map(g => {
      const bins = xs.map(() => []);
      for (const i of idx) { if (ca && ca[i] !== g) continue; const v = ya[i]; if (typeof v !== 'number') continue; bins[pos.get(xa[i])].push(v); }
      return { name: g === null ? axisName(ds, y) : String(g), bins };
    }).filter(s => s.bins.some(b => b.length));
    return { xs, series };
  }

  function pie(ds, idx, st, o) {
    const y = st.ys[0];
    const groups = st.color ? Data.uniques(ds, st.color, idx) : [null];
    const agg = st.agg === 'none' ? 'count' : st.agg;
    const n = groups.length; const rows = [[st.color ? axisName(ds, st.color) : '', axisName(ds, st.x), agg === 'count' ? 'Count' : axisName(ds, y), 'Percent']];
    o.series = groups.map((g, k) => {
      const sub = g === null ? idx : idx.filter(i => ds.data[st.color][i] === g);
      const r = Data.group(ds, sub, st.x, [y], agg, null);
      const s0 = r.series[0] || { data: [] };
      const data = r.xs.map((v, i) => ({ name: String(v), value: r4(s0.data[i]) })).filter(d => d.value);
      const tot = data.reduce((a, d) => a + d.value, 0);
      data.forEach(d => rows.push([g === null ? '' : g, d.name, d.value, r4(100 * d.value / tot)]));
      const w = 100 / n;
      return { type: 'pie', name: g === null ? '' : String(g), radius: n > 2 ? ['25%', '55%'] : ['30%', '62%'], center: [`${w * k + w / 2}%`, '55%'], data,
        label: { formatter: p => `${p.name}\n${p.percent.toFixed(1)}%` }, title: g };
    });
    o.title = groups.length > 1 ? groups.map((g, k) => ({ text: String(g), left: `${100 / n * k + 100 / n / 2}%`, top: '14%', textAlign: 'center', textStyle: { fontSize: 14, color: '#1E4D2B' } })) : undefined;
    o.tooltip = { trigger: 'item', formatter: p => `${esc(p.seriesName)} ${esc(p.name)}: ${Data.num1(p.value)} (${p.percent.toFixed(1)}%)` };
    delete o.toolbox; delete o.grid;
    return { option: o, table: rows };
  }

  function pointTable(series, xn, yn, xc) {
    const rows = [['Series', xn, yn]];
    for (const s of series) for (const p of s.data.slice(0, 20000)) rows.push([s.name, isTime(xc) ? new Date(p[0]).toISOString().slice(0, xc.type === 'date' ? 10 : 16).replace('T', ' ') : p[0], r4(p[1])]);
    return rows;
  }
  const esc = s => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

  /* Plot map: polygons drawn from the season's plot shapefile, colored by one value per plot (red low, green high). */
  const TILE_URL = (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
  const tileCache = new Map();
  function tileImage(url, onload) {
    let im = tileCache.get(url);
    if (!im) {
      im = new Image(); im.crossOrigin = 'anonymous';
      im.onload = () => onload && onload();
      im.onerror = () => {   // server without CORS: load the plain image (shows on screen; Save image may then be blocked by the browser)
        const plain = new Image(); plain.onload = () => { tileCache.set(url, plain); onload && onload(); }; plain.onerror = () => { plain._bad = true; tileCache.set(url, plain); onload && onload(); }; plain.src = url; };
      im.src = url; tileCache.set(url, im);
    }
    return im;
  }
  function tilesFor(lo0, lo1, la0, la1, pxWidth) {
    let z = Math.ceil(Math.log2((pxWidth || 900) * 360 / (256 * Math.max(lo1 - lo0, 1e-6))));
    z = Math.max(14, Math.min(19, z));
    const n = 2 ** z;
    const tx = lo => Math.floor((lo + 180) / 360 * n);
    const ty = la => { const r = la * Math.PI / 180; return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n); };
    const lonOf = x => x / n * 360 - 180, latOf = y => Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n))) * 180 / Math.PI;
    const out = [];
    for (let x = tx(lo0); x <= tx(lo1); x++) for (let y = ty(la1); y <= ty(la0); y++) out.push({ z, x, y, w: lonOf(x), e: lonOf(x + 1), nlat: latOf(y), slat: latOf(y + 1) });
    return out.length <= 120 ? out : [];
  }

  function plotMap(ds, idx, st, geo, year, opts) {
    opts = opts || {};
    const y = st.ys[0]; const yc = Data.col(ds, y); CUR = idx; const yLab = axisName(ds, y);
    const agg = ['none', 'count', 'box'].includes(st.agg) ? 'mean' : st.agg;
    const byPlot = new Map();
    const pa = ds.data.Plot, ya = ds.data[y];
    for (const i of idx) { const p = pa[i], v = ya[i]; if (p === null || v === null || v === undefined) continue; if (!byPlot.has(p)) byPlot.set(p, []); byPlot.get(p).push(v); }
    const numeric = yc.type === 'num';
    const val = p => { const a = byPlot.get(p); if (!a || !a.length) return null; if (!numeric) return String(a[0]); return Data.AGG[agg](a); };
    const feats = geo.features;
    const lat0 = feats.reduce((s, f) => s + f.properties.cy, 0) / feats.length;
    const k = Math.cos(lat0 * Math.PI / 180);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    const shapes = feats.map(f => {
      const rings = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
      const polys = rings.map(r => r[0].map(([lo, la]) => { const X = lo * k, Y = la; x0 = Math.min(x0, X); x1 = Math.max(x1, X); y0 = Math.min(y0, Y); y1 = Math.max(y1, Y); return [X, Y]; }));
      return { polys, name: f.properties.Plot, cx: f.properties.cx * k, cy: f.properties.cy, farm: f.properties.Farm, team: f.properties.Team, track: f.properties.Track };
    });
    // with imagery, show some ground around the field
    if (opts.imagery) { const mx = (x1 - x0) * 0.08, my = (y1 - y0) * 0.08; x0 -= mx; x1 += mx; y0 -= my; y1 += my; }
    const data = shapes.map((s, i) => { const v = val(s.name); return { value: [i, v === null ? '-' : v], name: s.name }; });
    const vals = data.map(d => d.value[1]).filter(v => v !== '-');
    const ramp = (RAMPS[opts.ramp] || RAMPS['Red-Yellow-Green']).slice(); if (opts.reverse) ramp.reverse();
    const alpha = opts.imagery ? (opts.opacity ?? 0.75) : 1;
    const o = { animation: false, color: PAL,
      title: { text: `${yLab.toUpperCase()}, ${year}`, left: 'center', top: 4, textStyle: { fontSize: 14, color: '#22592A' } },
      tooltip: { trigger: 'item', confine: true, formatter: p => { const s = shapes[p.value[0]];
        return `Plot ${esc(s.name)}<br>Farm ${esc(s.farm ?? '')} ${esc(s.team || '')}${s.track ? ' (' + esc(s.track) + ')' : ''}<br>${esc(yLab)}: ${p.value[1] === '-' ? 'no data' : esc(numeric ? Data.num1(p.value[1]) : p.value[1])}`; } },
      grid: { left: 40, right: 40, top: 50, bottom: 70 },
      xAxis: { type: 'value', min: x0, max: x1, show: false }, yAxis: { type: 'value', min: y0, max: y1, show: false },
      series: [{ type: 'custom', coordinateSystem: 'cartesian2d', data, encode: { x: -1, y: -1, tooltip: 1 }, clip: true,
        renderItem: (params, api) => {
          const s = shapes[api.value(0)]; const v = data[params.dataIndex].value[1];
          const fill = v === '-' ? '#E7E9E4' : api.visual('color');
          const kids = s.polys.map(poly => ({ type: 'polygon', shape: { points: poly.map(pt => api.coord(pt)) }, style: { fill, opacity: v === '-' && opts.imagery ? 0.35 : alpha, stroke: '#FFFFFF', lineWidth: 1.2 } }));
          if (/^\d{1,2}[A-L]$/.test(s.name || '')) { const c = api.coord([s.cx, s.cy]); kids.push({ type: 'text', x: c[0], y: c[1], style: { text: s.name, fill: '#1F2A22', fontSize: 11, fontWeight: 600, align: 'center', verticalAlign: 'middle', ...(opts.imagery ? { stroke: '#FFFFFF', lineWidth: 3 } : {}) }, silent: true }); }
          return { type: 'group', children: kids };
        } }] };
    if (numeric && vals.length) {
      o.visualMap = { type: 'continuous', dimension: 1, seriesIndex: 0, min: Math.min(...vals), max: Math.max(...vals), calculable: true, orient: 'horizontal', left: 'center', bottom: 8,
        text: ['High', 'Low'], formatter: v => Data.num1(v), inRange: { color: ramp } };
    } else if (vals.length) {
      const cats = [...new Set(vals)].sort(Data.sortVals);
      o.visualMap = { type: 'piecewise', dimension: 1, seriesIndex: 0, categories: cats, orient: 'horizontal', left: 'center', bottom: 8, inRange: { color: PAL.slice(0, Math.max(cats.length, 1)) } };
    }
    if (opts.imagery) {
      const tiles = tilesFor(x0 / k, x1 / k, y0, y1, opts.pxWidth);
      o.series.unshift({ type: 'custom', coordinateSystem: 'cartesian2d', silent: true, clip: true, data: [[0, 0]], z: 0, tooltip: { show: false },
        renderItem: (params, api) => ({ type: 'group', children: tiles.map(t => {
          const im = tileImage(TILE_URL(t.z, t.x, t.y), opts.onTile);
          if (!im.complete || im._bad) return null;
          const a0 = api.coord([t.w * k, t.nlat]), a1 = api.coord([t.e * k, t.slat]);
          return { type: 'image', style: { image: im, x: a0[0], y: a0[1], width: a1[0] - a0[0] + 0.5, height: a1[1] - a0[1] + 0.5 }, silent: true };
        }).filter(Boolean) }) });
      if (o.visualMap) o.visualMap.seriesIndex = 1;
      o.graphic = [{ type: 'text', right: 12, bottom: 12, style: { text: 'Imagery: Esri World Imagery (Esri, Maxar, Earthstar Geographics)', fill: '#59595B', fontSize: 10 } }];
      o.tooltip.formatter = (f => p => (p.seriesIndex === 0 ? '' : f(p)))(o.tooltip.formatter);
    }
    // keep the true shape: match the grid box to the field's width/height ratio
    const aspect = (x1 - x0) / (y1 - y0);
    o._aspect = aspect;
    const rows = [['Plot', 'Farm', 'Team', 'Track', yLab]].concat(shapes.filter(s => /^\d{1,2}[A-L]$/.test(s.name || '')).map(s => [s.name, s.farm, s.team, s.track, val(s.name)]));
    return { option: o, table: rows };
  }

  const r4 = v => (typeof v === 'number' ? Math.round(v * 10000) / 10000 : v);
  return { build, plotMap, PALETTE, PALETTES, RAMPS, setPalette, isTime };
})();
