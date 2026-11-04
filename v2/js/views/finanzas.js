// Finanzas v2: mismas tablas que v1 (accounts, transactions, budgets, money_goals…).
// Escribe con actualización optimista + rollback + toast, como v1.
import { dbPost, dbPatch, SUPABASE_URL, SUPABASE_KEY } from '../db.js';
import { escapeHTML, localDate, showToast, icon, openModal, closeModal } from '../util.js';
import * as F from '../fin.js';

const PERIODS = { mes: 'Mes', trimestre: 'Trimestre', anio: 'Año' };
const ACC_KIND = { debit: 'Débito', credit: 'Crédito', savings: 'Ahorro', investment: 'Inversión', cash: 'Efectivo' };
const BRAND = [ // color del cuadrito de cada cuenta (mockup)
  [/plata/i, '#17181A'], [/\bnu\b|nubank/i, '#6B3FA0'], [/bbva/i, '#1D4F91'], [/gbm/i, '#2E6B4F']
];
const RPC_URL = `${SUPABASE_URL}/rest/v1/rpc/capture_wallet_tx`;

let state = { f: null, period: 'mes', showAll: false };
let rootEl = null;

function readPeriod() { try { return localStorage.getItem('v2FinPeriod') || 'mes'; } catch { return 'mes'; } }
function savePeriod(p) { try { localStorage.setItem('v2FinPeriod', p); } catch { /* sin storage */ } }

export async function show(el, isCurrent = () => true) {
  const f = await F.loadFinance();
  if (!isCurrent()) return; // ya cambiaste de sección
  rootEl = el;
  state.period = PERIODS[readPeriod()] ? readPeriod() : 'mes';
  state.showAll = false;
  state.f = f;
  paint();
}

// ── Piezas ───────────────────────────────────────────
function brandColor(a) {
  const s = `${a.name} ${a.institution || ''}`;
  return (BRAND.find(([re]) => re.test(s)) || [null, '#5E6066'])[1];
}

function accountSub(f, a) {
  if (a.kind === 'credit') {
    const c = f.cards.find(x => x.account_id === a.id);
    return c ? `Crédito · pagar el ${c.pay_day}` : 'Crédito';
  }
  if (F.accPositions(f, a.id).length) return 'Fondos · valor del último corte';
  return ACC_KIND[a.kind] || a.kind;
}

function accountCard(f, a) {
  const v = F.accountValue(f, a.id);
  return `<div class="card card-sm acc">
    <div class="acc-head"><span class="acc-mark" style="background:${brandColor(a)}" aria-hidden="true">${escapeHTML(a.name.charAt(0).toUpperCase())}</span><span class="acc-name">${escapeHTML(a.name)}</span></div>
    <div class="acc-val${v < 0 ? ' neg' : ''}">${F.fmtSigned(v)}</div>
    <div class="small">${escapeHTML(accountSub(f, a))}</div>
  </div>`;
}

function budgetRow(r) {
  const over = r.spent > r.budget;
  const pct = Math.min(100, Math.round(r.spent / r.budget * 100));
  return `<div class="bud">
    <div class="bud-line"><span>${escapeHTML(r.cat.name)}</span><span class="${over ? 'over' : 'muted'}">${F.fmtMoney0(r.spent)} / ${F.fmtMoney0(r.budget)}</span></div>
    <div class="track" role="progressbar" aria-label="${escapeHTML(r.cat.name)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><div class="${over ? 'over' : ''}" style="width:${pct}%"></div></div>
  </div>`;
}

function relTime(t, cap) {
  if (cap) {
    const d = new Date(cap.received_at);
    if (localDate(d) === localDate()) {
      const mins = Math.round((Date.now() - d) / 60000);
      return mins < 60 ? `hace ${Math.max(1, mins)} min` : d.toLocaleTimeString('es-MX', { hour: 'numeric', minute: '2-digit' });
    }
  }
  if (t.occurred_on === localDate()) return 'hoy';
  return new Date(t.occurred_on + 'T12:00:00').toLocaleDateString('es-MX', { day: 'numeric', month: 'short' }).replace('.', '');
}

function txRow(f, t, caps) {
  const amt = Number(t.amount_cents) || 0;
  const cap = caps.get(t.id);
  let title, sub, sign = '', cls = '', ic;
  if (t.type === 'transfer') {
    title = t.is_allocation ? 'Reparto de ahorro' : (t.note || 'Transferencia');
    sub = `${F.accName(f, t.account_id)} → ${F.accName(f, t.to_account_id)}`;
    ic = '<path d="M4 8h14l-3-3M20 16H6l3 3"/>';
  } else {
    title = t.note || F.catName(f, t.category_id);
    sub = [cap ? 'Apple Pay' : '', t.note ? F.catName(f, t.category_id) : '', F.accName(f, t.account_id)].filter(Boolean).join(' · ');
    sign = t.type === 'income' ? '+' : '−';
    cls = t.type === 'income' ? ' pos' : '';
    ic = t.type === 'income' ? '<path d="M17 7L7 17M15 17H7V9"/>' : '<path d="M7 17L17 7M9 7h8v8"/>';
  }
  return `<div class="tx">
    <span class="tx-ic${t.type === 'income' ? ' in' : ''}" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ic}</svg></span>
    <div class="tx-main"><div class="tx-title">${escapeHTML(title)}</div><div class="task-meta">${escapeHTML(sub + ' · ' + relTime(t, cap))}</div></div>
    <div class="tx-amt${cls}">${sign}${F.fmtMoney(amt)}</div>
  </div>`;
}

function goalRow(f, g) {
  const target = Number(g.target_cents) || 0;
  const cur = F.goalCurrent(f, g);
  const pct = target ? Math.min(100, Math.round(cur / target * 100)) : null;
  return `<div class="goal">
    <div class="ring" style="--p:${pct ?? 0}" role="img" aria-label="${pct === null ? 'Sin meta' : pct + '% de la meta'}"><span>${pct === null ? '—' : pct + '%'}</span></div>
    <div style="min-width:0;display:flex;flex-direction:column;gap:4px">
      <span class="label">Meta de ahorro</span>
      <span style="font-size:16px;font-weight:600;overflow-wrap:anywhere">${escapeHTML(g.name)}</span>
      <span class="small">${F.fmtMoney0(cur)}${target ? ` de ${F.fmtMoney0(target)}` : ''}</span>
    </div>
  </div>`;
}

function reviewRow(f, c) {
  const t = c.transaction_id ? f.tx.find(x => x.id === c.transaction_id) : null;
  const cats = F.activeCats(f, 'expense').map(x => `<option value="${escapeHTML(x.id)}">${escapeHTML(x.name)}</option>`).join('');
  const accs = F.bankAccounts(f).map(x => `<option value="${escapeHTML(x.id)}">${escapeHTML(x.name)}</option>`).join('');
  return `<div class="review" data-cap="${escapeHTML(c.id)}">
    <div class="tx-main">
      <div class="tx-title">${escapeHTML(c.merchant || 'Apple Pay')} · ${F.fmtMoney(c.amount_cents)}</div>
      <div class="task-meta">${escapeHTML([c.card_name, t ? 'falta categoría' : 'no encontré la cuenta'].filter(Boolean).join(' · '))}</div>
    </div>
    <div class="review-ctl">
      ${t ? '' : `<label class="sr-only" for="ra-${escapeHTML(c.id)}">Cuenta</label><select class="field sel" id="ra-${escapeHTML(c.id)}" data-r-acc><option value="">Cuenta…</option>${accs}</select>`}
      <label class="sr-only" for="rc-${escapeHTML(c.id)}">Categoría</label>
      <select class="field sel" id="rc-${escapeHTML(c.id)}" data-r-cat><option value="">Categoría…</option>${cats}</select>
      <button type="button" class="btn-primary sm" data-r-save>Guardar</button>
      ${t ? '' : '<button type="button" class="btn-ghost sm" data-r-ignore>Ignorar</button>'}
    </div>
  </div>`;
}

function shortcutCard(f) {
  if (f.tokens === null) {
    return `<section class="card" aria-labelledby="atajoT">
      <div class="card-head"><h2 id="atajoT">Apple Pay → Finanzas</h2></div>
      <p class="small" style="margin:0">Para capturar pagos desde el iPhone, primero corre <code>v2/sql/2026-11-03-captura-wallet.sql</code> en el SQL Editor de Supabase.</p>
    </section>`;
  }
  const tok = f.tokens[0];
  const used = tok?.last_used_at ? new Date(tok.last_used_at).toLocaleString('es-MX', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : null;
  return `<section class="card" aria-labelledby="atajoT">
    <div class="card-head"><h2 id="atajoT">Apple Pay → Finanzas</h2>${tok ? '<span class="chip chip-soft">Conectado</span>' : ''}</div>
    <p class="small" style="margin:0">${tok ? `Atajo conectado${used ? ` · último pago recibido ${escapeHTML(used)}` : ' · aún no llega ningún pago'}.` : 'Un Atajo de iOS manda cada pago con Apple Pay directo aquí.'}</p>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button type="button" class="btn-dark" data-connect>${tok ? 'Nuevo token' : 'Conectar Atajo'}</button>
      ${tok ? '<button type="button" class="btn-ghost sm" data-revoke>Desconectar</button>' : ''}
    </div>
  </section>`;
}

// ── Pintar ───────────────────────────────────────────
function paint() {
  const f = state.f;
  const r = F.periodRange(state.period);
  const nw = F.netWorth(f);
  const base = nw.total - nw.change;
  const pctChange = base > 0 ? (nw.change / base * 100) : null;
  const saved = F.savedIn(f, r);
  const accounts = F.bankAccounts(f);
  const budgets = F.budgetRows(f, r);
  const caps = F.captureByTx(f);
  const inPeriod = f.tx.filter(t => F.inRange(t, r));
  const txs = state.showAll ? inPeriod.slice(0, 100) : f.tx.slice(0, 5);
  const review = F.capturesToReview(f);
  const goals = f.goals.slice(0, 3);

  rootEl.innerHTML = `<div class="page">
    <header class="head" style="align-items:center">
      <h1 class="hello" style="margin:0">Finanzas</h1>
      <button type="button" class="btn-dark" data-add>${icon('plus', 2.4)}Gasto</button>
    </header>

    ${f.errors.length ? `<div class="error-box">No se pudo cargar: ${escapeHTML(f.errors.join(', '))}.</div>` : ''}

    <div class="seg" role="group" aria-label="Periodo">
      ${Object.entries(PERIODS).map(([k, v]) => `<button type="button" data-period="${k}" aria-pressed="${k === state.period}">${v}</button>`).join('')}
    </div>

    <div class="fin-grid">
      <div class="fin-col">
        <section class="hero" aria-label="Patrimonio total">
          <div class="card-head">
            <span class="label">Patrimonio total</span>
            ${pctChange !== null && Math.abs(pctChange) >= 0.05 ? `<span class="hero-pill">${pctChange >= 0 ? '↑' : '↓'} ${Math.abs(pctChange).toFixed(1)}% este mes</span>` : ''}
          </div>
          <div class="hero-num" style="font-size:44px">${F.fmtSigned(nw.total)}</div>
          <div class="hero-split">
            <div><span>Ahorrado ${escapeHTML(r.label)}</span><strong>${F.fmtSigned(saved)}</strong></div>
            <div><span>Invertido</span><strong>${F.fmtMoney0(nw.invested)}</strong></div>
          </div>
        </section>

        ${review.length ? `<section class="card" aria-labelledby="revT" style="gap:4px">
          <div class="card-head" style="padding-bottom:8px"><h2 id="revT">Apple Pay por revisar</h2><span class="chip chip-alert">${review.length}</span></div>
          ${review.slice(0, 10).map(c => reviewRow(f, c)).join('')}
        </section>` : ''}

        <section aria-labelledby="accT" style="display:flex;flex-direction:column;gap:10px">
          <h2 id="accT" style="font-size:16px;font-weight:600">Cuentas</h2>
          <div class="grid-2">${accounts.length ? accounts.map(a => accountCard(f, a)).join('') : '<div class="small">Sin cuentas.</div>'}</div>
        </section>

        ${goals.length ? `<section class="card" aria-label="Metas de ahorro" style="gap:16px">${goals.map(g => goalRow(f, g)).join('')}</section>` : ''}
      </div>

      <div class="fin-col">
        <section class="card" aria-labelledby="budT" style="gap:14px">
          <div class="card-head"><h2 id="budT">Presupuesto por categoría</h2><a href="../">Editar</a></div>
          ${budgets.length ? budgets.map(budgetRow).join('') : '<div class="small">Aún no hay presupuestos. Se configuran en la versión actual.</div>'}
        </section>

        <section class="card" aria-labelledby="movT" style="gap:4px">
          <div class="card-head" style="padding-bottom:8px">
            <h2 id="movT">${state.showAll ? `Movimientos ${escapeHTML(r.label)}` : 'Movimientos'}</h2>
            <button type="button" class="btn-link" data-toggle-all>${state.showAll ? 'Ver menos' : 'Ver todos'}</button>
          </div>
          ${txs.length ? txs.map(t => txRow(f, t, caps)).join('') : '<div class="empty">Sin movimientos.</div>'}
          ${state.showAll && inPeriod.length > 100 ? `<div class="empty">Mostrando 100 de ${inPeriod.length}.</div>` : ''}
        </section>

        ${shortcutCard(f)}
      </div>
    </div>
  </div>`;
  bind();
}

function bind() {
  rootEl.querySelectorAll('[data-period]').forEach(b => b.onclick = () => {
    state.period = b.dataset.period; savePeriod(state.period); paint();
  });
  rootEl.querySelector('[data-toggle-all]').onclick = () => { state.showAll = !state.showAll; paint(); };
  rootEl.querySelector('[data-add]').onclick = openExpense;
  rootEl.querySelector('[data-connect]')?.addEventListener('click', connectShortcut);
  rootEl.querySelector('[data-revoke]')?.addEventListener('click', revokeShortcut);
  rootEl.querySelectorAll('[data-cap]').forEach(row => {
    row.querySelector('[data-r-save]').onclick = () => saveReview(row);
    row.querySelector('[data-r-ignore]')?.addEventListener('click', () => ignoreCapture(row.dataset.cap));
  });
}

// ── Capturar gasto ───────────────────────────────────
function openExpense() {
  const f = state.f;
  const accs = F.bankAccounts(f).filter(a => a.kind !== 'investment');
  if (!accs.length) return showToast('Primero crea una cuenta en la versión actual', 'error');
  const opt = (list) => list.map(x => `<option value="${escapeHTML(x.id)}">${escapeHTML(x.name)}</option>`).join('');
  openModal('Nuevo gasto', `
    <label class="flabel" for="gAmt">Monto</label>
    <input class="field" id="gAmt" inputmode="decimal" autocomplete="off" placeholder="$0.00">
    <label class="flabel" for="gCat">Categoría</label>
    <select class="field" id="gCat"><option value="">Sin categoría</option>${opt(F.activeCats(f, 'expense'))}</select>
    <label class="flabel" for="gAcc">Cuenta</label>
    <select class="field" id="gAcc">${opt(accs)}</select>
    <label class="flabel" for="gDate">Fecha</label>
    <input class="field" id="gDate" type="date" value="${localDate()}">
    <label class="flabel" for="gNote">Nota (opcional)</label>
    <input class="field" id="gNote" maxlength="120" autocomplete="off" placeholder="Oxxo, café…">
  `, `<button type="button" class="btn-primary" id="gSave">Guardar gasto</button>`);
  setTimeout(() => document.getElementById('gAmt').focus(), 50);
  document.getElementById('gSave').onclick = saveExpense;
}

async function saveExpense() {
  const amount = F.parseCents(document.getElementById('gAmt').value);
  const date = document.getElementById('gDate').value;
  if (!amount) return showToast('Escribe un monto válido', 'error');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return showToast('Elige la fecha', 'error');
  const tx = {
    type: 'expense', amount_cents: amount, occurred_on: date,
    account_id: document.getElementById('gAcc').value,
    category_id: document.getElementById('gCat').value || null,
    note: document.getElementById('gNote').value.trim() || null
  };
  // Optimista: se ve al instante; si falla, se quita.
  const temp = { ...tx, id: 'tmp-' + Date.now(), created_at: new Date().toISOString() };
  state.f.tx.unshift(temp); sortTx();
  closeModal(); paint();
  try {
    const [row] = await dbPost('transactions', tx);
    Object.assign(temp, row);
    paint(); showToast('Gasto guardado');
  } catch (e) {
    state.f.tx = state.f.tx.filter(t => t !== temp); paint();
    showToast('No se pudo guardar el gasto', 'error');
  }
}

function sortTx() {
  state.f.tx.sort((a, b) => a.occurred_on < b.occurred_on ? 1 : a.occurred_on > b.occurred_on ? -1 : String(b.created_at || '').localeCompare(String(a.created_at || '')));
}

// ── Revisar capturas de Apple Pay ────────────────────
async function saveReview(row) {
  const f = state.f;
  const c = f.captures.find(x => x.id === row.dataset.cap);
  const cat = row.querySelector('[data-r-cat]').value || null;
  const accSel = row.querySelector('[data-r-acc]');
  if (c.transaction_id) {
    if (!cat) return showToast('Elige la categoría', 'error');
    const t = f.tx.find(x => x.id === c.transaction_id);
    const prev = t.category_id;
    t.category_id = cat; paint();
    try { await dbPatch('transactions', { category_id: cat }, `?id=eq.${encodeURIComponent(t.id)}`); showToast('Listo'); }
    catch { t.category_id = prev; paint(); showToast('No se pudo guardar', 'error'); }
    return;
  }
  const acc = accSel.value;
  if (!acc) return showToast('Elige la cuenta', 'error');
  const day = localDate(new Date(c.received_at));
  const tx = { type: 'expense', amount_cents: c.amount_cents, occurred_on: day, account_id: acc, category_id: cat, note: c.merchant || 'Apple Pay' };
  const temp = { ...tx, id: 'tmp-' + Date.now(), created_at: c.received_at };
  const prev = { status: c.status, account_id: c.account_id, transaction_id: c.transaction_id };
  f.tx.unshift(temp); sortTx();
  Object.assign(c, { status: 'linked', account_id: acc, transaction_id: temp.id });
  paint();
  let created;
  try {
    [created] = await dbPost('transactions', tx);
  } catch {
    f.tx = f.tx.filter(t => t !== temp); Object.assign(c, prev);
    paint(); return showToast('No se pudo registrar', 'error');
  }
  Object.assign(temp, created);
  c.transaction_id = created.id;
  try {
    await dbPatch('wallet_captures', { status: 'linked', account_id: acc, transaction_id: created.id }, `?id=eq.${c.id}`);
    showToast('Gasto registrado');
  } catch {
    // El gasto sí quedó; solo falló marcar la captura. No lo borro para no perder el registro.
    showToast('Gasto registrado, pero la captura sigue pendiente: márcala como ignorada', 'error');
  }
  paint();
}

async function ignoreCapture(id) {
  const c = state.f.captures.find(x => x.id === id);
  const prev = c.status;
  c.status = 'ignored'; paint();
  try { await dbPatch('wallet_captures', { status: 'ignored' }, `?id=eq.${id}`); }
  catch { c.status = prev; paint(); showToast('No se pudo ignorar', 'error'); }
}

// ── Conectar el Atajo ────────────────────────────────
function randomToken() {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function sha256Hex(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map(x => x.toString(16).padStart(2, '0')).join('');
}

async function connectShortcut() {
  const f = state.f;
  const token = randomToken();
  let row;
  try {
    // Un token a la vez: el anterior se desactiva.
    for (const t of f.tokens) await dbPatch('capture_tokens', { revoked: true }, `?id=eq.${t.id}`);
    [row] = await dbPost('capture_tokens', { token_hash: await sha256Hex(token), label: 'Atajo iPhone' });
  } catch {
    return showToast('No se pudo crear el token', 'error');
  }
  f.tokens = [row];
  paint();
  const copyField = (id, label, value) => `
    <label class="flabel" for="${id}">${label}</label>
    <div class="copy"><input class="field" id="${id}" readonly value="${escapeHTML(value)}"><button type="button" class="btn-ghost sm" data-copy="${id}">Copiar</button></div>`;
  openModal('Conectar el Atajo', `
    <p class="small" style="margin:0">Copia el token ahora: por seguridad solo se muestra esta vez. Si lo pierdes, genera otro.</p>
    ${copyField('scToken', 'Token', token)}
    ${copyField('scUrl', 'URL', RPC_URL)}
    ${copyField('scKey', 'Encabezado apikey', SUPABASE_KEY)}
    <ol class="steps">
      <li>En el iPhone abre <b>Atajos › Automatización › Nueva automatización › Transacción</b>. Elige tus tarjetas y marca <b>Ejecutar inmediatamente</b>.</li>
      <li>Agrega la acción <b>Obtener contenido de URL</b> con la URL de arriba. Método <b>POST</b>.</li>
      <li>Encabezados: <code>apikey</code> = la clave de arriba y <code>Content-Type</code> = <code>application/json</code>.</li>
      <li>Cuerpo <b>JSON</b> con 4 campos de texto: <code>p_token</code> = el token, <code>p_amount</code> = <i>Importe</i>, <code>p_merchant</code> = <i>Comerciante</i>, <code>p_card</code> = <i>Tarjeta o pase</i>.</li>
      <li>Paga algo con Apple Pay y abre Finanzas: el gasto sale en Movimientos (o en "por revisar" si no reconozco la tarjeta).</li>
    </ol>
  `, `<button type="button" class="btn-primary" data-close>Listo</button>`);
  document.querySelectorAll('[data-copy]').forEach(b => b.onclick = async () => {
    const inp = document.getElementById(b.dataset.copy);
    try { await navigator.clipboard.writeText(inp.value); showToast('Copiado'); }
    catch { inp.select(); document.execCommand('copy'); showToast('Copiado'); }
  });
}

async function revokeShortcut() {
  const f = state.f;
  const prev = f.tokens;
  f.tokens = []; paint();
  try {
    for (const t of prev) await dbPatch('capture_tokens', { revoked: true }, `?id=eq.${t.id}`);
    showToast('Atajo desconectado');
  } catch {
    f.tokens = prev; paint(); showToast('No se pudo desconectar', 'error');
  }
}
