/* Datasets: loading, filtering, grouping for charts, and downloads. */
'use strict';
const Data = (() => {
  const cache = {};
  let manifest = null;

  async function getManifest() {
    if (!manifest) manifest = await Crypt.fetchJSON('manifest');
    return manifest;
  }
  async function load(id, onProgress) {
    if (!cache[id]) cache[id] = Crypt.fetchJSON(id, onProgress).then(expand).catch(e => { delete cache[id]; throw e; });
    return cache[id];
  }
  function expand(ds) {
    // repeated text columns arrive dictionary-encoded: {$d: [values], $c: [codes]}
    if (ds && ds.data) for (const k of Object.keys(ds.data)) { const v = ds.data[k]; if (v && v.$d) ds.data[k] = v.$c.map(c => v.$d[c]); }
    return ds;
  }
  function col(ds, key) { return ds.columns.find(c => c.key === key); }
  function label(c) { return c ? (c.unit ? `${c.label} (${c.unit})` : c.label) : ''; }

  function num1(v) {   // display rule: whole numbers as they are, everything else x.x
    if (typeof v !== 'number' || !isFinite(v)) return v === null || v === undefined ? '' : String(v);
    return Number.isInteger(v) ? String(v) : v.toFixed(1);
  }
  function tsToDate(m) { return new Date(m * 60000); }
  function fmt(v, c) {
    if (v === null || v === undefined) return '';
    if (c && c.type === 'datetime') { const d = tsToDate(v); return d.toISOString().slice(0, 16).replace('T', ' '); }
    if (typeof v === 'number') return num1(v);
    return String(v);
  }

  function uniques(ds, key, idx) {
    const a = ds.data[key]; const s = new Set();
    if (idx) for (const i of idx) { if (a[i] !== null && a[i] !== undefined) s.add(a[i]); }
    else for (const v of a) if (v !== null && v !== undefined) s.add(v);
    return [...s].sort(sortVals);
  }
  function sortVals(a, b) {
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    const pa = plotKey(a), pb = plotKey(b);
    if (pa && pb) return pa[0] - pb[0] || pa[1].localeCompare(pb[1]);
    return String(a).localeCompare(String(b), undefined, { numeric: true });
  }
  function plotKey(v) { const m = /^(\d{1,2})([A-L])$/.exec(String(v)); return m ? [+m[1], m[2]] : null; }

  /* filters: {key: Set(values)}; range: {key, from, to} for date or datetime columns */
  function filter(ds, filters, range) {
    const n = ds.n; const keys = Object.keys(filters).filter(k => filters[k] && ds.data[k]);
    const out = [];
    let rc = null, lo = null, hi = null;
    if (range && range.key && ds.data[range.key] && (range.from || range.to)) {
      rc = col(ds, range.key);
      if (rc.type === 'datetime') { lo = range.from ? Date.parse(range.from + 'T00:00:00Z') / 60000 : -Infinity; hi = range.to ? Date.parse(range.to + 'T23:59:59Z') / 60000 : Infinity; }
      else { lo = range.from || ''; hi = range.to || '9999'; }
    }
    for (let i = 0; i < n; i++) {
      let ok = true;
      for (const k of keys) { if (!filters[k].has(ds.data[k][i])) { ok = false; break; } }
      if (ok && rc) { const v = ds.data[range.key][i]; if (v === null || v < lo || v > hi) ok = false; }
      if (ok) out.push(i);
    }
    return out;
  }

  const AGG = {
    sum: a => a.reduce((s, v) => s + v, 0),
    mean: a => a.length ? a.reduce((s, v) => s + v, 0) / a.length : null,
    min: a => a.length ? Math.min(...a) : null,
    max: a => a.length ? Math.max(...a) : null,
    count: a => a.length,
    median: a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; },
  };

  /* Group rows for a chart. ys: list of numeric keys. Returns {xs, series:[{name, data:[..]}], raw: [...]} */
  function group(ds, idx, x, ys, agg, color) {
    const xa = ds.data[x], ca = color ? ds.data[color] : null;
    const xs = uniques(ds, x, idx);
    const series = [];
    const groups = color ? uniques(ds, color, idx) : [null];
    const pos = new Map(xs.map((v, i) => [v, i]));
    for (const y of ys) {
      const ya = ds.data[y];
      for (const g of groups) {
        const bins = xs.map(() => []);
        for (const i of idx) {
          if (ca && ca[i] !== g) continue;
          const v = ya[i]; if (v === null || v === undefined || typeof v !== 'number') { if (agg === 'count' && xa[i] !== null) bins[pos.get(xa[i])].push(1); continue; }
          const p = pos.get(xa[i]); if (p === undefined) continue;
          bins[p].push(v);
        }
        const data = bins.map(b => b.length ? AGG[agg](b) : null);
        if (data.every(v => v === null)) continue;
        const name = [ys.length > 1 ? label(col(ds, y)) : null, g !== null ? String(g) : null].filter(Boolean).join(' | ') || label(col(ds, y));
        series.push({ name, data, y, g, bins: agg === 'box' ? bins : undefined });
      }
    }
    return { xs, series };
  }

  function boxStats(a) {
    if (!a.length) return null;
    const s = [...a].sort((x, y) => x - y);
    const q = p => { const i = (s.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i); return s[lo] + (s[hi] - s[lo]) * (i - lo); };
    return [s[0], q(0.25), q(0.5), q(0.75), s[s.length - 1]];
  }

  function csvEscape(v) { const s = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
  function rowsFor(ds, idx, keys) {
    const cols = keys.map(k => col(ds, k));
    return [cols.map(label)].concat(idx.map(i => cols.map(c => {
      const v = ds.data[c.key][i];
      return c.type === 'datetime' && v !== null ? fmt(v, c) : v;
    })));
  }
  function download(name, blob) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function toCSV(rows) { return '﻿' + rows.map(r => r.map(csvEscape).join(',')).join('\r\n'); }
  function downloadCSV(name, rows) { download(name, new Blob([toCSV(rows)], { type: 'text/csv;charset=utf-8' })); }

  let xlsxReady = null;
  function loadXLSX() {
    if (!xlsxReady) xlsxReady = new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'vendor/xlsx.mini.min.js'; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
    return xlsxReady;
  }
  async function downloadXLSX(name, sheets) {
    await loadXLSX();
    const wb = XLSX.utils.book_new();
    wb.Props = { Author: 'Wub Yilma', Title: 'CSU-TAPS data' };
    for (const [sn, rows] of sheets) {
      const ws = XLSX.utils.aoa_to_sheet(rows);
      // full values kept; numbers with decimals shown as x.x
      for (const [ref, cell] of Object.entries(ws)) if (ref[0] !== '!' && cell.t === 'n' && !Number.isInteger(cell.v)) cell.z = '0.0';
      if (rows[0]) ws['!cols'] = rows[0].map(h => ({ wch: Math.min(Math.max(String(h ?? '').length + 2, 10), 40) }));
      XLSX.utils.book_append_sheet(wb, ws, sn.slice(0, 31));
    }
    XLSX.writeFile(wb, name, { compression: true });
  }

  return { getManifest, load, col, label, fmt, num1, uniques, filter, group, boxStats, rowsFor, downloadCSV, downloadXLSX, tsToDate, sortVals, AGG };
})();
