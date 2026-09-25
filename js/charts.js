/* ECharts options from a chart state. No statistics beyond grouping (sum, mean, count, min, max, median) and box plot quartiles. */
'use strict';
const Charts = (() => {
  // colors taken from the 2025 CSU-TAPS report figures (green, navy, orange, olive) plus CSU gold
  const PALETTE = ['#22592A', '#23518F', '#CD711B', '#817922', '#C8C372', '#6CA818', '#59595B', '#8EA6C5', '#A33A3A', '#3E9C9C',
    '#1E4D2B', '#6F8DB6', '#E4900C', '#B8B483', '#6B4E8C', '#C25B8D', '#2C8C6C', '#9C6B30', '#12375C', '#7E2E2E'];
  const base = () => ({
    color: PALETTE, animation: false,
    textStyle: { fontFamily: 'Segoe UI, Roboto, Arial, sans-serif', color: '#1F2A22' },
    grid: { left: 70, right: 70, top: 96, bottom: 90, containLabel: true },
    tooltip: { trigger: 'axis', confine: true, valueFormatter: v => Data.num1(v) },
    legend: { type: 'scroll', top: 32, left: 10, right: 110 },
    toolbox: { right: 10, top: 34, feature: { dataZoom: { yAxisIndex: 'none', title: { zoom: 'Zoom', back: 'Undo zoom' } }, restore: { title: 'Reset' } } },
  });
  const isTime = c => c && (c.type === 'date' || c.type === 'datetime');
  const tval = (v, c) => c.type === 'datetime' ? v * 60000 : v;   // ECharts time axis takes ms or ISO date strings

  function axisName(ds, key) { return Data.label(Data.col(ds, key)); }

  function build(ds, idx, st) {
    const o = base();
    const xc = Data.col(ds, st.x);
    const ys = st.ys.filter(k => ds.data[k]);
    if (!xc || !ys.length) return null;
    const yName = ys.length === 1 ? axisName(ds, ys[0]) : (st.agg === 'count' ? 'Count' : 'Value');

    if (st.type === 'pie') return pie(ds, idx, st, o);

    if (st.agg === 'none') {
      // every row is a point
      const groups = st.color ? Data.uniques(ds, st.color, idx) : [null];
      const ca = st.color ? ds.data[st.color] : null;
      const series = [];
      for (const y of ys) {
        const ya = ds.data[y], xa = ds.data[st.x];
        for (const g of groups) {
          const pts = [];
          for (const i of idx) { if (ca && ca[i] !== g) continue; if (ya[i] === null || xa[i] === null) continue; pts.push([isTime(xc) ? tval(xa[i], xc) : xa[i], ya[i]]); }
          if (!pts.length) continue;
          if (isTime(xc) || xc.type === 'num') pts.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
          const name = [ys.length > 1 ? axisName(ds, y) : null, g !== null ? String(g) : null].filter(Boolean).join(' | ') || axisName(ds, y);
          const s = { name, data: pts, type: st.type === 'scatter' ? 'scatter' : 'line', symbolSize: 6 };
          if (s.type === 'line') Object.assign(s, { showSymbol: pts.length < 60, sampling: 'lttb', connectNulls: false, lineStyle: { width: 1.6 } });
          if (st.type === 'area') s.areaStyle = { opacity: 0.25 };
          if (st.cumulative) { let c = 0; s.data = pts.map(p => [p[0], (c += p[1])]); }
          series.push(s);
        }
      }
      o.xAxis = { type: isTime(xc) ? 'time' : (xc.type === 'num' ? 'value' : 'category'), name: axisName(ds, st.x), nameLocation: 'middle', nameGap: 30, scale: xc.type === 'num' };
      if (o.xAxis.type === 'category') o.xAxis.data = Data.uniques(ds, st.x, idx);
      o.yAxis = { type: 'value', name: yName, scale: true };
      o.series = series;
      if (st.type === 'scatter') o.tooltip = { trigger: 'item', confine: true, formatter: p => `${esc(p.seriesName)}<br>${esc(axisName(ds, st.x))}: ${esc(isTime(xc) ? new Date(p.value[0]).toISOString().slice(0, 10) : Data.num1(p.value[0]))}<br>${esc(yName)}: ${Data.num1(p.value[1])}` };
      o.dataZoom = [{ type: 'inside' }, { type: 'slider', bottom: 20 }];
      return { option: o, table: pointTable(series, axisName(ds, st.x), yName, xc) };
    }

    const agg = st.type === 'box' ? 'box' : st.agg;
    const g = Data.group(ds, idx, st.x, ys, agg === 'box' ? 'count' : agg, st.color);
    if (st.type === 'box') {
      const g2 = groupBins(ds, idx, st.x, ys[0], st.color);
      o.xAxis = { type: 'category', data: g2.xs.map(String), name: axisName(ds, st.x), nameLocation: 'middle', nameGap: 30 };
      o.yAxis = { type: 'value', name: axisName(ds, ys[0]), scale: true };
      o.series = g2.series.map(s => ({ name: s.name, type: 'boxplot', data: s.bins.map(b => Data.boxStats(b) || '-') }));
      o.tooltip = { trigger: 'item', confine: true, formatter: p => { const v = p.value.slice(-5); return `${esc(p.seriesName)} ${esc(p.name)}<br>Max ${Data.num1(v[4])}<br>Q3 ${Data.num1(v[3])}<br>Median ${Data.num1(v[2])}<br>Q1 ${Data.num1(v[1])}<br>Min ${Data.num1(v[0])}`; } };
      const rows = [['Group', axisName(ds, st.x), 'Min', 'Q1', 'Median', 'Q3', 'Max', 'n']];
      g2.series.forEach(s => s.bins.forEach((b, i) => { const q = Data.boxStats(b); if (q) rows.push([s.name, g2.xs[i], ...q.map(r4), b.length]); }));
      return { option: o, table: rows };
    }
    const xsLabels = g.xs.map(v => (xc.type === 'datetime' ? Data.fmt(v, xc) : v));
    const stacked = st.type === 'stacked' || st.type === 'hstacked';
    const horizontal = st.type === 'hbar' || st.type === 'hstacked';
    const lineLike = st.type === 'line' || st.type === 'area';
    o.series = g.series.map(s => {
      let data = s.data;
      if (st.cumulative) { let c = 0; data = data.map(v => (v === null ? c : (c += v))); }
      const t = lineLike ? 'line' : 'bar';
      const out = { name: s.name, type: t, data: isTime(xc) && lineLike ? data.map((v, i) => [tval(g.xs[i], xc), v]) : data, connectNulls: true };
      if (stacked) out.stack = 'all';
      if (st.type === 'area') out.areaStyle = { opacity: 0.25 };
      if (t === 'bar') out.barMaxWidth = 38;
      return out;
    });
    // bars grouped by color where each X has only one group (for example farm colored by track): center them instead of leaving gaps
    if (!stacked && !lineLike && o.series.length > 1 && g.xs.every((_, i) => o.series.filter(s => s.data[i] !== null && s.data[i] !== undefined).length <= 1)) o.series.forEach(s => (s.stack = 'one'));
    const catAxis = { type: 'category', data: xsLabels.map(String), name: axisName(ds, st.x), nameLocation: 'middle', nameGap: horizontal ? 60 : 32, axisLabel: { hideOverlap: true, rotate: !horizontal && xsLabels.length > 14 ? 45 : 0 } };
    const valAxis = { type: 'value', name: st.agg === 'count' ? 'Count' : yName };
    if (isTime(xc) && lineLike) { o.xAxis = { type: 'time', name: axisName(ds, st.x), nameLocation: 'middle', nameGap: 30 }; o.yAxis = valAxis; }
    else if (horizontal) { o.yAxis = catAxis; o.xAxis = valAxis; o.grid.left = 110; o.tooltip.axisPointer = { type: 'shadow' }; }
    else { o.xAxis = catAxis; o.yAxis = valAxis; o.tooltip.axisPointer = { type: lineLike ? 'line' : 'shadow' }; }
    if (xsLabels.length > 25 && !horizontal) o.dataZoom = [{ type: 'inside' }, { type: 'slider', bottom: 20 }];
    const rows = [[axisName(ds, st.x)].concat(o.series.map(s => s.name))];
    g.xs.forEach((v, i) => rows.push([xsLabels[i]].concat(o.series.map(s => { const d = s.data[i]; return r4(Array.isArray(d) ? d[1] : d); }))));
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
  function plotMap(ds, idx, st, geo, year) {
    const y = st.ys[0]; const yc = Data.col(ds, y);
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
    const data = shapes.map((s, i) => { const v = val(s.name); return { value: [i, v === null ? '-' : v], name: s.name }; });
    const vals = data.map(d => d.value[1]).filter(v => v !== '-');
    const o = { animation: false, color: PALETTE,
      title: { text: `${yc.label.toUpperCase()}${yc.unit ? ' (' + yc.unit + ')' : ''}, ${year}`, left: 'center', top: 4, textStyle: { fontSize: 14, color: '#22592A' } },
      tooltip: { trigger: 'item', confine: true, formatter: p => { const s = shapes[p.value[0]];
        return `Plot ${esc(s.name)}<br>Farm ${esc(s.farm ?? '')} ${esc(s.team || '')}${s.track ? ' (' + esc(s.track) + ')' : ''}<br>${esc(Data.label(yc))}: ${p.value[1] === '-' ? 'no data' : esc(numeric ? Data.num1(p.value[1]) : p.value[1])}`; } },
      grid: { left: 40, right: 40, top: 50, bottom: 70 },
      xAxis: { type: 'value', min: x0, max: x1, show: false }, yAxis: { type: 'value', min: y0, max: y1, show: false },
      series: [{ type: 'custom', coordinateSystem: 'cartesian2d', data, encode: { x: -1, y: -1, tooltip: 1 },
        renderItem: (params, api) => {
          const s = shapes[api.value(0)]; const v = data[params.dataIndex].value[1];
          const fill = v === '-' ? '#E7E9E4' : api.visual('color');
          const kids = s.polys.map(poly => ({ type: 'polygon', shape: { points: poly.map(pt => api.coord(pt)) }, style: { fill, stroke: '#FFFFFF', lineWidth: 1.2 } }));
          if (/^\d{1,2}[A-I]$/.test(s.name || '')) { const c = api.coord([s.cx, s.cy]); kids.push({ type: 'text', x: c[0], y: c[1], style: { text: s.name, fill: '#1F2A22', fontSize: 11, fontWeight: 600, align: 'center', verticalAlign: 'middle' }, silent: true }); }
          return { type: 'group', children: kids };
        } }] };
    if (numeric && vals.length) {
      o.visualMap = { type: 'continuous', dimension: 1, seriesIndex: 0, min: Math.min(...vals), max: Math.max(...vals), calculable: true, orient: 'horizontal', left: 'center', bottom: 8,
        text: ['High', 'Low'], formatter: v => Data.num1(v), inRange: { color: ['#B2182B', '#EF8A62', '#FDDB85', '#A6D96A', '#1A9641'] } };
    } else if (vals.length) {
      const cats = [...new Set(vals)].sort(Data.sortVals);
      o.visualMap = { type: 'piecewise', dimension: 1, seriesIndex: 0, categories: cats, orient: 'horizontal', left: 'center', bottom: 8, inRange: { color: PALETTE.slice(0, Math.max(cats.length, 1)) } };
    }
    // keep the true shape: match the grid box to the field's width/height ratio
    const aspect = (x1 - x0) / (y1 - y0);
    o._aspect = aspect;
    const rows = [['Plot', 'Farm', 'Team', 'Track', Data.label(yc)]].concat(shapes.filter(s => /^\d{1,2}[A-I]$/.test(s.name || '')).map(s => [s.name, s.farm, s.team, s.track, val(s.name)]));
    return { option: o, table: rows };
  }

  const r4 = v => (typeof v === 'number' ? Math.round(v * 10000) / 10000 : v);
  return { build, plotMap, PALETTE, isTime };
})();
