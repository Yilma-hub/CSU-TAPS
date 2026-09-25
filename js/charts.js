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
    tooltip: { trigger: 'axis', confine: true },
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
      if (st.type === 'scatter') o.tooltip = { trigger: 'item', confine: true };
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
      o.tooltip = { trigger: 'item', confine: true };
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
        label: { formatter: '{b}\n{d}%' }, title: g };
    });
    o.title = groups.length > 1 ? groups.map((g, k) => ({ text: String(g), left: `${100 / n * k + 100 / n / 2}%`, top: '14%', textAlign: 'center', textStyle: { fontSize: 14, color: '#1E4D2B' } })) : undefined;
    o.tooltip = { trigger: 'item', formatter: '{a} {b}: {c} ({d}%)' };
    delete o.toolbox; delete o.grid;
    return { option: o, table: rows };
  }

  function pointTable(series, xn, yn, xc) {
    const rows = [['Series', xn, yn]];
    for (const s of series) for (const p of s.data.slice(0, 20000)) rows.push([s.name, isTime(xc) ? new Date(p[0]).toISOString().slice(0, xc.type === 'date' ? 10 : 16).replace('T', ' ') : p[0], r4(p[1])]);
    return rows;
  }
  const r4 = v => (typeof v === 'number' ? Math.round(v * 10000) / 10000 : v);
  return { build, PALETTE, isTime };
})();
