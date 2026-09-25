/* Sign-in and decryption. Every data file is AES-256-GCM encrypted with one data key.
   The data key is stored once per user, encrypted with a key derived from that user's password (PBKDF2-SHA-256).
   Nothing readable is on the server: without a valid email and password the files cannot be opened. */
'use strict';
const Crypt = (() => {
  const enc = new TextEncoder();
  const b64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const tob64 = u => btoa(String.fromCharCode(...new Uint8Array(u)));
  const hex = buf => Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('');
  let dataKey = null, keysCfg = null, version = '';

  async function loadKeys() {
    if (keysCfg) return keysCfg;
    const r = await fetch('data/keys.json', { cache: 'no-store' });
    if (!r.ok) throw new Error('Could not load the sign-in file.');
    keysCfg = await r.json();
    version = keysCfg.version || '';
    return keysCfg;
  }

  async function emailId(email, pepper) {
    const d = await crypto.subtle.digest('SHA-256', enc.encode(pepper + '|' + email.trim().toLowerCase()));
    return hex(d);
  }

  async function signIn(email, password) {
    const cfg = await loadKeys();
    const id = await emailId(email, cfg.pepper);
    const u = cfg.users[id];
    // same work whether or not the email exists, so a wrong email and a wrong password look the same
    const salt = u ? b64(u.salt) : crypto.getRandomValues(new Uint8Array(16));
    const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
    const kek = await crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: cfg.kdf.iterations },
      base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
    if (!u) throw new Error('Email or password is not correct.');
    let raw;
    try {
      raw = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(u.iv), additionalData: enc.encode(id) }, kek, b64(u.key));
    } catch (e) { throw new Error('Email or password is not correct.'); }
    dataKey = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, true, ['decrypt']);
    try { sessionStorage.setItem('taps_k', tob64(raw)); sessionStorage.setItem('taps_e', email.trim().toLowerCase()); } catch (e) { /* private mode: stay signed in for this page only */ }
    return email.trim().toLowerCase();
  }

  async function resume() {
    try {
      const k = sessionStorage.getItem('taps_k');
      if (!k) return null;
      await loadKeys();
      dataKey = await crypto.subtle.importKey('raw', b64(k), { name: 'AES-GCM' }, true, ['decrypt']);
      // check the stored key still opens the data (it changes when access is revoked)
      await fetchJSON('manifest');
      return sessionStorage.getItem('taps_e') || '';
    } catch (e) { signOut(); return null; }
  }

  function signOut() {
    dataKey = null;
    try { sessionStorage.removeItem('taps_k'); sessionStorage.removeItem('taps_e'); } catch (e) { }
  }

  async function gunzip(bytes) {
    const ds = new DecompressionStream('gzip');
    const stream = new Blob([bytes]).stream().pipeThrough(ds);
    return await new Response(stream).text();
  }

  async function fetchJSON(id, onProgress) {
    if (!dataKey) throw new Error('Not signed in.');
    const r = await fetch(`data/${id}.bin?v=${encodeURIComponent(version)}`);
    if (!r.ok) throw new Error(`Could not load ${id}.`);
    const buf = new Uint8Array(await r.arrayBuffer());
    if (onProgress) onProgress('Decrypting');
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: buf.slice(0, 12), additionalData: enc.encode(id) }, dataKey, buf.slice(12));
    if (onProgress) onProgress('Unpacking');
    return JSON.parse(await gunzip(new Uint8Array(plain)));
  }

  return { signIn, resume, signOut, fetchJSON };
})();
