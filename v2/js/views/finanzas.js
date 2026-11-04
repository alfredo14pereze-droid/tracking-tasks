// Finanzas v2: mismas tablas que v1 (accounts, transactions, budgets, money_goals…).
// Escribe con actualización optimista + rollback + toast, como v1.
import { dbPost, dbPatch, dbUpsert, SUPABASE_URL, SUPABASE_KEY } from '../db.js?v=202611041305';
import { syncYields, yieldAccounts, monthYield } from '../rendimientos.js?v=202611041305';
import { escapeHTML, localDate, showToast, icon, openModal, closeModal } from '../util.js?v=202611041305';
import { FIN_TABS } from '../finclasica.js?v=202611041305';
import { openStatement } from './estado.js?v=202611041305';
import { ask, withBusy, aiLabel } from '../ia.js?v=202611041305';
import * as F from '../fin.js?v=202611041305';

const PERIODS = { mes: 'Mes', trimestre: 'Trimestre', anio: 'Año' };
const ACC_KIND = { debit: 'Débito', credit: 'Crédito', savings: 'Ahorro', investment: 'Inversión', cash: 'Efectivo' };
const BRAND = [ // color del cuadrito de cada cuenta (mockup)
  [/plata/i, '#17181A'], [/\bnu\b|nubank/i, '#6B3FA0'], [/bbva/i, '#1D4F91'], [/gbm/i, '#2E6B4F']
];
const RPC_URL = `${SUPABASE_URL}/rest/v1/rpc/capture_wallet_tx`;

let state = { f: null, period: 'mes', showAll: false, aiCats: {} };
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
  // Rendimientos del mes: se calculan después de pintar para no hacer esperar la pantalla.
  if (await syncYields(f) && isCurrent()) paint();
}

// ── Piezas ───────────────────────────────────────────
function brandColor(a) {
  const s = `${a.name} ${a.institution || ''}`;
  return (BRAND.find(([re]) => re.test(s)) || [null, '#5E6066'])[1];
}

const fmtDay = d => d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' }).replace('.', '');
const hasNewCols = f => f.accounts.some(a => 'annual_rate_pct' in a);

function accountSub(f, a) {
  if (a.kind === 'credit') {
    const s = F.cardStatus(f, a);
    if (!s) return 'Crédito';
    if (s.toPay > 0) return `${s.overdue ? 'Vencido: ' : ''}Pagar ${F.fmtMoney0(s.toPay)} antes del ${fmtDay(s.due)}`;
    return `Pago del mes cubierto ✓ · corte ${fmtDay(s.nextCut)}`;
  }
  if (F.accPositions(f, a.id).length) return 'Fondos · valor del último corte';
  const rate = Number(a.annual_rate_pct);
  if (rate > 0) {
    const y = f.tx.find(t => t.auto_key === `yield:${a.id}:${localDate().slice(0, 7)}`);
    return `${ACC_KIND[a.kind] || a.kind} · ${rate}% anual${y ? ` · +${F.fmtMoney(y.amount_cents)} este mes` : ''}`;
  }
  return ACC_KIND[a.kind] || a.kind;
}

function accountCard(f, a) {
  const v = F.accountValue(f, a.id);
  const credit = a.kind === 'credit';
  return `<div class="card card-sm acc">
    <div class="acc-head"><span class="acc-mark" style="background:${brandColor(a)}" aria-hidden="true">${escapeHTML(a.name.charAt(0).toUpperCase())}</span><span class="acc-name">${escapeHTML(a.name)}</span></div>
    <div class="acc-val${v < 0 ? ' neg' : ''}">${F.fmtSigned(v)}</div>
    ${F.ownedPct(a) < 100 ? `<div class="small" style="margin-top:-6px">${F.ownedPct(a) === 0 ? 'No es tuyo: lo cuidas' : `Tuyo ${F.ownedPct(a)}% · ${F.fmtMoney0(Math.round(v * F.ownedPct(a) / 100))}`}</div>` : ''}
    ${credit ? `<div class="small" style="margin-top:-6px">Deuda total${(() => { const st = F.cardStatus(f, a); return st ? ` · gastado desde el corte ${F.fmtMoney0(st.spent)}` : ''; })()}</div>` : ''}
    <div class="small"${credit && F.cardStatus(f, a)?.overdue ? ' style="color:var(--alert)"' : ''}>${escapeHTML(accountSub(f, a))}</div>
    ${credit ? `<button type="button" class="btn-ghost sm" style="align-self:flex-start" data-card-month="${escapeHTML(a.id)}">Pago del mes</button>` : F.accPositions(f, a.id).length ? '' : `<button type="button" class="btn-link" style="align-self:flex-start" data-acc-edit="${escapeHTML(a.id)}">Editar</button>`}
  </div>`;
}

function incomesCard(f) {
  const list = f.incomes;
  return `<section class="card" aria-labelledby="incT" style="gap:4px">
    <div class="card-head" style="padding-bottom:8px"><h2 id="incT">Ingresos</h2><button type="button" class="btn-link" data-sources>${list.length ? 'Editar' : 'Configurar'}</button></div>
    ${list.length ? list.map(src => {
      const st = F.incomeStatus(f, src), done = st.received > 0;
      const when = src.frequency === 'semanal' && src.pay_weekday !== null && src.pay_weekday !== undefined ? `cada ${F.WEEKDAYS[src.pay_weekday]}`
        : src.frequency === 'semanal' ? 'cada semana' : src.frequency === 'quincenal' ? 'cada quincena' : src.frequency === 'irregular' ? 'cuando llegue' : 'cada mes';
      return `<div class="tx">
        <span class="tx-ic in" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 7L7 17M15 17H7V9"/></svg></span>
        <div class="tx-main"><div class="tx-title">${escapeHTML(src.name)} · ${F.fmtMoney0(src.amount_cents)}</div>
          <div class="task-meta">${escapeHTML(when)} · ${done ? `✓ recibido ${escapeHTML(st.period.label)} (${F.fmtMoney0(st.received)})` : `pendiente ${escapeHTML(st.period.label)}`}</div></div>
        <button type="button" class="${done ? 'btn-ghost' : 'btn-primary'} sm" data-inc="${escapeHTML(src.id)}">${done ? 'Otro pago' : 'Ya lo recibí'}</button>
      </div>`;
    }).join('') : '<p class="small" style="margin:0">Agrega tus ingresos (Salper, mensualidad…) y aquí tendrás un botón para registrarlos cuando lleguen.</p>'}
  </section>`;
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
  const sug = state.aiCats[c.id];
  const cats = F.activeCats(f, 'expense').map(x => `<option value="${escapeHTML(x.id)}"${x.id === sug ? ' selected' : ''}>${escapeHTML(x.name)}</option>`).join('');
  const pre = t ? null : F.rememberedAccount(f, c.card_name);
  const accs = F.bankAccounts(f).map(x => `<option value="${escapeHTML(x.id)}"${x.id === pre ? ' selected' : ''}>${escapeHTML(x.name)}</option>`).join('');
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
    <p class="small" style="margin:0">${tok ? `Atajo conectado${used ? ` · último pago recibido ${escapeHTML(used)}` : ' · aún no llega ningún pago'}`.replace(/\.?$/, '.') : 'Un Atajo de iOS manda cada pago con Apple Pay directo aquí.'}</p>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button type="button" class="btn-dark" data-connect>${tok ? 'Nuevo token' : 'Conectar Atajo'}</button>
      ${tok ? '<button type="button" class="btn-ghost sm" data-revoke>Desconectar</button>' : ''}
    </div>
    ${tok && f.attempts ? attemptsHTML(f.attempts) : ''}
  </section>`;
}

// Bitácora: lo que mandó el iPhone cada vez que corrió el Atajo (sirve para ver por qué un pago no llegó).
const ATTEMPT = { registrado: 'Registrado', por_revisar: 'Por revisar', duplicado: 'Repetido (ignorado)',
  'error: monto inválido': 'No se registró: el monto llegó vacío o raro', 'error: monto fuera de rango': 'No se registró: monto fuera de rango' };
function attemptsHTML(list) {
  const when = d => new Date(d).toLocaleString('es-MX', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  return `<details class="atajo-log">
    <summary class="small">Últimas veces que llegó el Atajo (${list.length})</summary>
    ${list.length ? `<ul>${list.map(a => {
      const bad = String(a.result).startsWith('error');
      return `<li><span class="task-meta">${escapeHTML(when(a.at))} · <b${bad ? ' style="color:var(--alert)"' : ''}>${escapeHTML(ATTEMPT[a.result] || a.result)}</b></span>
        <span class="small">Tarjeta: ${escapeHTML(a.card_raw || '(vacío)')} · Monto: ${escapeHTML(a.amount_raw || '(vacío)')} · Comercio: ${escapeHTML(a.merchant_raw || '(vacío)')}</span></li>`;
    }).join('')}</ul>` : '<p class="small" style="margin:6px 0 0">Todavía no llega ninguno desde que se activó la bitácora. Si pagas y no aparece nada aquí, el iPhone no corrió el Atajo.</p>'}
  </details>`;
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

    <nav class="views" aria-label="Secciones de finanzas">
      <a class="vchip" aria-current="page" href="#finanzas" style="background:var(--dark);border-color:var(--dark);color:#fff;display:inline-flex;align-items:center;text-decoration:none">Resumen</a>
      ${Object.entries(FIN_TABS).map(([k, v]) => `<a class="vchip" href="#finanzas/${k}" style="display:inline-flex;align-items:center;text-decoration:none">${escapeHTML(v)}</a>`).join('')}
    </nav>

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
          <div style="display:flex;gap:8px;flex-wrap:wrap;padding-bottom:6px">
            <button type="button" class="btn-ghost sm ai-btn" data-ai-cats>${aiLabel('Sugerir categorías')}</button>
            ${Object.keys(state.aiCats).length ? '<button type="button" class="btn-primary sm" data-r-saveall>Guardar todas</button>' : ''}
          </div>
          ${review.slice(0, 10).map(c => reviewRow(f, c)).join('')}
        </section>` : ''}

        ${incomesCard(f)}

        <section aria-labelledby="accT" style="display:flex;flex-direction:column;gap:10px">
          <div class="card-head"><h2 id="accT" style="font-size:16px;font-weight:600">Cuentas</h2>
            <div style="display:flex;gap:14px;flex-wrap:wrap"><button type="button" class="btn-link" data-rates>Rendimientos</button><button type="button" class="btn-link" data-real>Saldos reales</button><button type="button" class="btn-link" data-newacc>+ Cuenta</button><button type="button" class="btn-link" data-newcard>+ Tarjeta</button></div></div>
          <div class="grid-2">${accounts.length ? accounts.map(a => accountCard(f, a)).join('') : '<div class="small">Sin cuentas.</div>'}</div>
        </section>

        ${goals.length ? `<section class="card" aria-label="Metas de ahorro" style="gap:16px">${goals.map(g => goalRow(f, g)).join('')}</section>` : ''}
      </div>

      <div class="fin-col">
        <section class="card" aria-labelledby="budT" style="gap:14px">
          <div class="card-head"><h2 id="budT">Presupuesto por categoría</h2><a href="#finanzas/budget">Editar</a></div>
          ${budgets.length ? budgets.map(budgetRow).join('') : '<div class="small">Aún no hay presupuestos. <a href="#finanzas/budget">Configúralos aquí</a>.</div>'}
        </section>

        <section class="card" aria-labelledby="movT" style="gap:4px">
          <div class="card-head" style="padding-bottom:8px">
            <h2 id="movT">${state.showAll ? `Movimientos ${escapeHTML(r.label)}` : 'Movimientos'}</h2>
            <button type="button" class="btn-link" data-toggle-all>${state.showAll ? 'Ver menos' : 'Ver todos'}</button>
          </div>
          ${txs.length ? txs.map(t => txRow(f, t, caps)).join('') : '<div class="empty">Sin movimientos.</div>'}
          ${state.showAll && inPeriod.length > 100 ? `<div class="empty">Mostrando 100 de ${inPeriod.length}.</div>` : ''}
        </section>

        <section class="card" aria-labelledby="stT" style="gap:10px">
          <div class="card-head"><h2 id="stT">Estado de cuenta</h2></div>
          <p class="small" style="margin:0">Sube el PDF de tu banco o tarjeta: Claude saca los movimientos, marca cuáles ya tenías y registras los nuevos.</p>
          <div style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" class="btn-dark ai-btn" data-statement>${aiLabel('Analizar PDF')}</button>
            <button type="button" class="btn-ghost" data-paste>Pegar movimientos</button></div>
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
  rootEl.querySelector('[data-real]')?.addEventListener('click', openRealBalances);
  rootEl.querySelector('[data-rates]')?.addEventListener('click', openRates);
  rootEl.querySelectorAll('[data-card-month]').forEach(b => b.onclick = () => openCardMonth(b.dataset.cardMonth));
  rootEl.querySelectorAll('[data-inc]').forEach(b => b.onclick = () => openIncome(b.dataset.inc));
  rootEl.querySelector('[data-sources]')?.addEventListener('click', openSources);
  rootEl.querySelector('[data-newcard]')?.addEventListener('click', openNewCard);
  rootEl.querySelector('[data-newacc]')?.addEventListener('click', () => openAccount());
  rootEl.querySelectorAll('[data-acc-edit]').forEach(b => b.onclick = () => openAccount(b.dataset.accEdit));
  rootEl.querySelector('[data-connect]')?.addEventListener('click', connectShortcut);
  rootEl.querySelector('[data-revoke]')?.addEventListener('click', revokeShortcut);
  rootEl.querySelector('[data-statement]')?.addEventListener('click', () => openStatement(state.f, paint));
  rootEl.querySelector('[data-paste]')?.addEventListener('click', openPaste);
  rootEl.querySelector('[data-ai-cats]')?.addEventListener('click', suggestCats);
  rootEl.querySelector('[data-r-saveall]')?.addEventListener('click', async e => {
    const rows = [...rootEl.querySelectorAll('[data-cap]')];
    e.currentTarget.disabled = true;
    for (const row of rows) {
      const needAcc = row.querySelector('[data-r-acc]');
      if (!row.querySelector('[data-r-cat]').value || (needAcc && !needAcc.value)) continue; // las incompletas se quedan
      await saveReview(row);
    }
    state.aiCats = {}; paint();
  });
  rootEl.querySelectorAll('[data-cap]').forEach(row => {
    row.querySelector('[data-r-save]').onclick = () => saveReview(row);
    row.querySelector('[data-r-ignore]')?.addEventListener('click', () => ignoreCapture(row.dataset.cap));
  });
}

// ── Sugerir categorías con IA (pagos de Apple Pay por revisar) ──
async function suggestCats(e) {
  const f = state.f;
  const review = F.capturesToReview(f).slice(0, 10);
  const payments = review.map(c => ({ id: c.id, merchant: c.merchant || 'Apple Pay', amount: (Number(c.amount_cents) || 0) / 100, card: c.card_name || '' }));
  const categories = F.activeCats(f, 'expense').map(c => ({ id: c.id, name: c.name }));
  const seen = new Set(), examples = [];
  for (const t of f.tx) {
    if (t.type !== 'expense' || !t.category_id || !t.note) continue;
    const k = t.note.toLowerCase(); if (seen.has(k)) continue; seen.add(k);
    examples.push({ merchant: t.note, category: F.catName(f, t.category_id) }); if (examples.length >= 60) break;
  }
  try {
    const res = await withBusy(e.currentTarget, 'Pensando…', () => ask('categorias', { payments, categories, examples }));
    const valid = new Set(categories.map(c => c.id));
    state.aiCats = {};
    for (const r of res.results || []) if (valid.has(r.category_id)) state.aiCats[r.id] = r.category_id;
    paint();
    showToast(Object.keys(state.aiCats).length ? 'Listo: revisa las categorías y toca Guardar (o Guardar todas)' : 'No pude sugerir categorías', Object.keys(state.aiCats).length ? 'info' : 'error');
  } catch (err) { showToast(err.message, 'error'); }
}

// ── Capturar gasto ───────────────────────────────────
function openExpense() {
  const f = state.f;
  const accs = F.bankAccounts(f).filter(a => a.kind !== 'investment');
  if (!accs.length) return (location.hash = '#finanzas/accounts', showToast('Primero crea una cuenta', 'error'));
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
  try { const last = localStorage.getItem('v2LastAcc'); if (last && accs.some(a => a.id === last)) document.getElementById('gAcc').value = last; } catch { /* sin storage */ }
  setTimeout(() => document.getElementById('gAmt').focus(), 50);
  document.getElementById('gSave').onclick = saveExpense;
}

async function saveExpense() {
  const amount = F.parseCents(document.getElementById('gAmt').value);
  const date = document.getElementById('gDate').value;
  if (!amount) return showToast('Escribe un monto válido', 'error');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return showToast('Elige la fecha', 'error');
  try { localStorage.setItem('v2LastAcc', document.getElementById('gAcc').value); } catch { /* sin storage */ }
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
  } catch {
    // El gasto sí quedó; solo falló marcar la captura. No lo borro para no perder el registro.
    paint();
    return showToast('Gasto registrado, pero la captura sigue pendiente: márcala como ignorada', 'error');
  }
  const learned = await rememberCard(c.card_name, acc);
  paint();
  showToast(learned ? `Listo. Los próximos pagos con ${c.card_name} irán solos a ${F.accName(f, acc)}` : 'Gasto registrado');
}

// Guarda "esta tarjeta va a esta cuenta" para que el Atajo la registre sola la próxima vez.
// Devuelve true si se aprendió algo nuevo. Si la tabla aún no existe, no hace nada.
async function rememberCard(cardName, accountId) {
  const f = state.f;
  if (!cardName || !f.cardMap) return false;
  if (F.rememberedAccount(f, cardName) === accountId) return false;
  try {
    const [row] = await dbUpsert('capture_card_accounts', { card_name: cardName, account_id: accountId }, 'user_id,card_name');
    f.cardMap = f.cardMap.filter(x => x.card_name.toLowerCase() !== cardName.toLowerCase()).concat(row);
    return true;
  } catch { return false; } // no es grave: solo no se recuerda
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

// ── Saldos reales de hoy ─────────────────────────────
// Escribes lo que dice cada banco hoy; la app ajusta el saldo inicial (no borra movimientos) para que cuadre.
// También guarda hoy como fecha de inicio: los ingresos de antes ya no se piden (ya estaban en el saldo).
const centsInput = c => (Math.abs(c) / 100).toFixed(2);
function openRealBalances() {
  const f = state.f;
  const accs = F.bankAccounts(f).filter(a => !F.accPositions(f, a.id).length);
  if (!accs.length) return showToast('No hay cuentas', 'error');
  openModal('Saldos reales de hoy', `
    <p class="small" style="margin:0">Escribe lo que te dice <b>hoy</b> la app de cada banco. Ajusto el saldo inicial para que cuadre; tus movimientos no se borran. Los ingresos de antes de hoy ya no se vuelven a pedir.</p>
    ${accs.map(a => {
      const credit = a.kind === 'credit', s0 = credit ? F.cardStatus(f, a) : null, s = s0 && 'statement_cut_on' in s0.card ? s0 : null;
      return `<label class="flabel" for="rb-${escapeHTML(a.id)}">${escapeHTML(a.name)}${credit ? ' · deuda total (lo que debes hoy)' : ''}</label>
        <input class="field" id="rb-${escapeHTML(a.id)}" data-rb="${escapeHTML(a.id)}" inputmode="decimal" autocomplete="off" value="${centsInput(F.accBalance(f, a.id))}">
        ${s ? `<label class="flabel" for="rs-${escapeHTML(a.id)}">${escapeHTML(a.name)} · pago para no generar intereses (corte del ${escapeHTML(fmtDay(s.cut))})</label>
          <input class="field" id="rs-${escapeHTML(a.id)}" data-rs="${escapeHTML(a.id)}" inputmode="decimal" autocomplete="off" placeholder="Lo que dice tu estado de cuenta" value="${s.fromBank ? centsInput(s.card.statement_due_cents) : ''}">
          <p class="small" style="margin:4px 0 0">Si ya hiciste un pago después del corte, escribe el monto original del estado de cuenta: el pago ya registrado se descuenta solo.</p>` : ''}`;
    }).join('')}
  `, `<button type="button" class="btn-primary" id="rbSave">Guardar saldos</button>`);
  document.getElementById('rbSave').onclick = async e => {
    const btn = e.currentTarget;
    const plan = [];
    for (const inp of document.querySelectorAll('#modal [data-rb]')) {
      const a = f.accounts.find(x => x.id === inp.dataset.rb);
      const v = inp.value.trim() === '' ? null : F.parseCents(inp.value.replace(/[$,\s-]/g, '') || '0');
      if (v === null) return showToast(`Revisa el saldo de ${a.name}`, 'error');
      const target = a.kind === 'credit' ? -v : v;
      const diff = target - F.accBalance(f, a.id);
      if (diff) plan.push({ a, opening: (Number(a.opening_balance_cents) || 0) + diff });
    }
    const stm = [];
    for (const inp of document.querySelectorAll('#modal [data-rs]')) {
      if (!inp.value.trim()) continue;
      const v = F.parseCents(inp.value.replace(/[$,\s]/g, ''));
      const a = f.accounts.find(x => x.id === inp.dataset.rs);
      if (v === null) return showToast(`Revisa el pago de ${a.name}`, 'error');
      stm.push({ s: F.cardStatus(f, a), v });
    }
    btn.disabled = true; btn.textContent = 'Guardando…';
    try {
      for (const { a, opening } of plan) { await dbPatch('accounts', { opening_balance_cents: opening }, `?id=eq.${a.id}`); a.opening_balance_cents = opening; }
      for (const { s, v } of stm) {
        const body = { statement_cut_on: s.cutStr, statement_due_cents: v, updated_at: new Date().toISOString() };
        await dbPatch('card_settings', body, `?id=eq.${s.card.id}`); Object.assign(s.card, body);
      }
      const today = Number(localDate().replace(/-/g, ''));
      const [row] = await dbUpsert('assumptions', { key: 'start_date', value: today, updated_at: new Date().toISOString() }, 'user_id,key');
      f.assumptions = f.assumptions.filter(x => x.key !== 'start_date').concat(row ? [row] : [{ key: 'start_date', value: today }]);
      closeModal(); showToast('Saldos actualizados: desde hoy todo es real'); paint();
    } catch {
      btn.disabled = false; btn.textContent = 'Guardar saldos';
      showToast('No se pudo guardar todo. Revisa y vuelve a intentar.', 'error'); paint();
    }
  };
}

// ── Tasas de rendimiento ─────────────────────────────
function openRates() {
  const f = state.f;
  if (!hasNewCols(f)) return showToast('Primero corre v2/sql/2026-11-04-finanzas-reales.sql en Supabase', 'error');
  const accs = F.bankAccounts(f).filter(a => ['debit', 'savings', 'cash'].includes(a.kind) && !F.accPositions(f, a.id).length);
  const ym = localDate().slice(0, 7);
  openModal('Rendimientos', `
    <p class="small" style="margin:0">Pon la tasa anual que te da cada cuenta (la ves en la app del banco). Cada mes se registra un ingreso "Rendimiento" que se actualiza solo día a día. Si el banco te da otra cifra, cambia el monto de ese movimiento y ya no lo toco.</p>
    ${accs.map(a => `<label class="flabel" for="rt-${escapeHTML(a.id)}">${escapeHTML(a.name)} · % anual</label>
      <input class="field" id="rt-${escapeHTML(a.id)}" data-rt="${escapeHTML(a.id)}" inputmode="decimal" autocomplete="off" placeholder="Sin rendimiento" value="${Number(a.annual_rate_pct) > 0 ? Number(a.annual_rate_pct) : ''}">
      ${Number(a.annual_rate_pct) > 0 ? `<p class="small" style="margin:4px 0 0">Este mes vas en ${F.fmtMoney(monthYield(f, a, ym))} (desde ${escapeHTML(fmtDay(new Date((a.yield_since || localDate()) + 'T12:00:00')))}).</p>` : ''}`).join('')}
  `, `<button type="button" class="btn-primary" id="rtSave">Guardar tasas</button>`);
  document.getElementById('rtSave').onclick = async e => {
    const btn = e.currentTarget;
    const changes = [];
    for (const inp of document.querySelectorAll('#modal [data-rt]')) {
      const a = f.accounts.find(x => x.id === inp.dataset.rt);
      const raw = inp.value.trim().replace('%', '').replace(',', '.');
      const rate = raw === '' ? null : Number(raw);
      if (rate !== null && !(rate >= 0 && rate <= 100)) return showToast(`Revisa la tasa de ${a.name}`, 'error');
      const prev = Number(a.annual_rate_pct) > 0 ? Number(a.annual_rate_pct) : null;
      if ((rate || null) === prev) continue;
      const body = { annual_rate_pct: rate || null };
      if (rate > 0 && !prev) body.yield_since = localDate(); // empieza a contar hoy
      changes.push({ a, body });
    }
    if (!changes.length) return closeModal();
    btn.disabled = true; btn.textContent = 'Guardando…';
    try {
      for (const { a, body } of changes) { await dbPatch('accounts', body, `?id=eq.${a.id}`); Object.assign(a, body); }
      closeModal(); showToast('Tasas guardadas'); paint();
      if (await syncYields(f)) paint();
    } catch { btn.disabled = false; btn.textContent = 'Guardar tasas'; showToast('No se pudieron guardar', 'error'); }
  };
}

// ── Pago del mes de una tarjeta ──────────────────────
function openCardMonth(accId) {
  const f = state.f;
  const a = f.accounts.find(x => x.id === accId);
  const s = F.cardStatus(f, a);
  if (!s) return (location.hash = '#finanzas/accounts', showToast('Primero pon el día de corte y de pago de la tarjeta en Cuentas', 'info'));
  const from = F.bankAccounts(f).filter(x => ['debit', 'savings', 'cash'].includes(x.kind));
  const canSave = 'statement_cut_on' in s.card;
  openModal(`${a.name} · pago del mes`, `
    <div class="stats3" style="border-top:none;padding-top:0">
      <div><span>Deuda total</span><strong>${F.fmtMoney0(s.debt)}</strong></div>
      <div><span>Corte</span><strong style="font-size:15px">${escapeHTML(fmtDay(s.cut))}</strong></div>
      <div><span>Fecha límite</span><strong style="font-size:15px">${escapeHTML(fmtDay(s.due))}</strong></div>
    </div>
    <div class="bud-line"><span>Pago para no generar intereses</span><strong>${F.fmtMoney(s.statement)}</strong></div>
    <div class="small" style="margin-top:-6px">${s.fromBank ? 'Según tu estado de cuenta.' : 'Calculado con lo que debías al corte. Si tu banco dice otra cifra, escríbela abajo.'}</div>
    <div class="bud-line"><span>Pagado desde el corte</span><span>${F.fmtMoney(s.paid)}</span></div>
    <div class="bud-line"><span><b>Te falta pagar</b></span><strong${s.overdue ? ' style="color:var(--alert)"' : ''}>${F.fmtMoney(s.toPay)}</strong></div>
    <p class="small" style="margin:0">Lo que compres después del corte (${escapeHTML(fmtDay(s.cut))}) se suma a la deuda total, pero se paga hasta el siguiente corte (${escapeHTML(fmtDay(s.nextCut))}).</p>
    ${canSave ? `<label class="flabel" for="cmStm">¿Qué dice tu estado de cuenta? (pago para no generar intereses)</label>
      <div style="display:flex;gap:8px;align-items:center"><input class="field" style="flex:1;min-width:0" id="cmStm" inputmode="decimal" autocomplete="off" placeholder="Ej. 10000" value="${s.fromBank ? centsInput(s.card.statement_due_cents) : ''}"><button type="button" class="btn-ghost sm" id="cmStmSave">Guardar</button></div>` : ''}
    <h3 style="font-size:15px;margin:10px 0 0">Registrar un pago</h3>
    <div class="row2"><div><label class="flabel" for="cmAmt">Monto</label><input class="field" id="cmAmt" inputmode="decimal" autocomplete="off" value="${s.toPay ? centsInput(s.toPay) : ''}"></div>
      <div><label class="flabel" for="cmDate">Fecha</label><input class="field" id="cmDate" type="date" value="${localDate()}"></div></div>
    <label class="flabel" for="cmFrom">Desde</label>
    <select class="field" id="cmFrom">${from.map(x => `<option value="${escapeHTML(x.id)}">${escapeHTML(x.name)}</option>`).join('')}</select>
  `, `<button type="button" class="btn-primary" id="cmPay">Registrar pago</button>`);
  document.getElementById('cmStmSave')?.addEventListener('click', async () => {
    const v = F.parseCents(document.getElementById('cmStm').value.replace(/[$,\s]/g, ''));
    if (v === null) return showToast('Escribe el monto del estado de cuenta', 'error');
    const body = { statement_cut_on: s.cutStr, statement_due_cents: v, updated_at: new Date().toISOString() };
    try { await dbPatch('card_settings', body, `?id=eq.${s.card.id}`); Object.assign(s.card, body); showToast('Guardado'); paint(); openCardMonth(accId); }
    catch { showToast('No se pudo guardar', 'error'); }
  });
  document.getElementById('cmPay').onclick = async e => {
    const btn = e.currentTarget;
    const amount = F.parseCents(document.getElementById('cmAmt').value.replace(/[$,\s]/g, ''));
    const date = document.getElementById('cmDate').value;
    if (!amount) return showToast('Escribe el monto del pago', 'error');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return showToast('Elige la fecha', 'error');
    btn.disabled = true;
    try {
      const [row] = await dbPost('transactions', { type: 'transfer', amount_cents: amount, account_id: document.getElementById('cmFrom').value, to_account_id: a.id, category_id: null, occurred_on: date, note: `Pago ${a.name}` });
      f.tx.unshift(row); sortTx();
      closeModal(); showToast('Pago registrado'); paint();
    } catch { btn.disabled = false; showToast('No se pudo registrar el pago', 'error'); }
  };
}

// ── Ya lo recibí ─────────────────────────────────────
const lastIncAcc = id => { try { return localStorage.getItem('v2IncAcc:' + id); } catch { return null; } };
function openIncome(srcId) {
  const f = state.f;
  const src = f.incomes.find(x => x.id === srcId);
  if (!src) return;
  const st = F.incomeStatus(f, src);
  const accs = F.bankAccounts(f).filter(a => ['debit', 'savings', 'cash'].includes(a.kind));
  const pre = [lastIncAcc(src.id), src.account_id].find(id => id && accs.some(a => a.id === id));
  openModal(`Recibí ${src.name}`, `
    ${st.last ? `<p class="small" style="margin:0;color:var(--alert)">Ojo: ya registraste ${escapeHTML(F.fmtMoney(st.received))} de ${escapeHTML(src.name)} ${escapeHTML(st.period.label)} (el ${escapeHTML(fmtDay(new Date(st.last.occurred_on + 'T12:00:00')))}). Regístralo solo si es otro pago.</p>` : ''}
    <label class="flabel" for="riAmt">Monto</label>
    <input class="field" id="riAmt" inputmode="decimal" autocomplete="off" value="${centsInput(src.amount_cents)}">
    <label class="flabel" for="riAcc">¿A dónde llegó?</label>
    <select class="field" id="riAcc">${accs.map(a => `<option value="${escapeHTML(a.id)}"${a.id === pre ? ' selected' : ''}>${escapeHTML(a.name)}</option>`).join('')}</select>
    <label class="flabel" for="riDate">Fecha</label>
    <input class="field" id="riDate" type="date" value="${localDate()}">
  `, `<button type="button" class="btn-primary" id="riSave">Registrar ingreso</button>`);
  document.getElementById('riSave').onclick = async e => {
    const btn = e.currentTarget;
    const amount = F.parseCents(document.getElementById('riAmt').value.replace(/[$,\s]/g, ''));
    const date = document.getElementById('riDate').value;
    const acc = document.getElementById('riAcc').value;
    if (!amount) return showToast('Escribe el monto', 'error');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return showToast('Elige la fecha', 'error');
    btn.disabled = true;
    try {
      if (!src.category_id) { // fuentes viejas sin categoría: se le crea una con su nombre
        const c = await ensureIncomeCategory(f, src.name);
        await dbPatch('income_sources', { category_id: c.id }, `?id=eq.${src.id}`); src.category_id = c.id;
      }
      const [row] = await dbPost('transactions', { type: 'income', amount_cents: amount, account_id: acc, to_account_id: null, category_id: src.category_id, occurred_on: date, note: src.name });
      f.tx.unshift(row); sortTx();
      try { localStorage.setItem('v2IncAcc:' + src.id, acc); } catch { /* sin storage */ }
      closeModal(); showToast(`${src.name} registrado en ${F.accName(f, acc)}`); paint();
    } catch { btn.disabled = false; showToast('No se pudo registrar', 'error'); }
  };
}
async function ensureIncomeCategory(f, name) {
  let c = f.categories.find(x => x.kind === 'income' && x.name.trim().toLowerCase() === name.trim().toLowerCase());
  if (c && c.archived) { await dbPatch('categories', { archived: false }, `?id=eq.${c.id}`); c.archived = false; }
  if (!c) { [c] = await dbPost('categories', { name: name.trim(), kind: 'income' }); f.categories.push(c); }
  return c;
}

// ── Mis ingresos (fuentes) ───────────────────────────
const FREQ = { semanal: 'Cada semana', quincenal: 'Cada quincena', mensual: 'Cada mes', irregular: 'Cuando llegue' };
function sourceRow(x, i) {
  const wd = F.WEEKDAYS.map((d, k) => `<option value="${k}"${Number(x.pay_weekday) === k && x.pay_weekday !== null && x.pay_weekday !== undefined ? ' selected' : ''}>${d.charAt(0).toUpperCase() + d.slice(1)}</option>`).join('');
  return `<fieldset class="src-row" data-src="${i}" style="border:1px solid var(--line);border-radius:14px;padding:12px;margin:10px 0 0;display:flex;flex-direction:column;gap:6px;min-width:0">
    <div class="row2"><div><label class="flabel" for="sn${i}" style="margin-top:0">Nombre</label><input class="field" id="sn${i}" data-sn value="${escapeHTML(x.name || '')}" maxlength="60"></div>
      <div><label class="flabel" for="sa${i}" style="margin-top:0">Monto</label><input class="field" id="sa${i}" data-sa inputmode="decimal" value="${x.amount_cents ? centsInput(x.amount_cents) : ''}"></div></div>
    <div class="row2"><div><label class="flabel" for="sf${i}">Frecuencia</label><select class="field" id="sf${i}" data-sf>${Object.entries(FREQ).map(([k, v]) => `<option value="${k}"${x.frequency === k ? ' selected' : ''}>${v}</option>`).join('')}</select></div>
      <div><label class="flabel" for="sw${i}">Día</label><select class="field" id="sw${i}" data-sw><option value="">Varía</option>${wd}</select></div></div>
    <label class="small" style="display:flex;gap:8px;align-items:center"><input type="checkbox" data-sdel> Quitar este ingreso</label>
  </fieldset>`;
}
function openSources() {
  const f = state.f;
  const rows = f.incomes.map(x => ({ ...x }));
  const has = re => rows.some(x => re.test(x.name));
  if (!has(/salper/i)) rows.push({ name: 'Salper', amount_cents: 450000, frequency: 'semanal', pay_weekday: 5 });
  if (!has(/mensual|papá|papa/i)) rows.push({ name: 'Mensualidad', amount_cents: 600000, frequency: 'mensual', pay_weekday: null });
  openModal('Mis ingresos', `
    <p class="small" style="margin:0">Así se ven en Finanzas, cada uno con su botón "Ya lo recibí". Quita los que ya no apliquen.</p>
    <div id="srcList">${rows.map(sourceRow).join('')}</div>
    <button type="button" class="btn-link" id="srcAdd" style="align-self:flex-start;margin-top:8px">+ Otro ingreso</button>
  `, `<button type="button" class="btn-primary" id="srcSave">Guardar</button>`);
  const syncDay = fs => { const sel = fs.querySelector('[data-sw]'); sel.closest('div').style.display = fs.querySelector('[data-sf]').value === 'semanal' ? '' : 'none'; };
  const wire = () => document.querySelectorAll('#modal [data-src]').forEach(fs => { fs.querySelector('[data-sf]').onchange = () => syncDay(fs); syncDay(fs); });
  wire();
  document.getElementById('srcAdd').onclick = () => {
    rows.push({ name: '', amount_cents: 0, frequency: 'mensual' });
    document.getElementById('srcList').insertAdjacentHTML('beforeend', sourceRow(rows[rows.length - 1], rows.length - 1)); wire();
  };
  document.getElementById('srcSave').onclick = async e => {
    const btn = e.currentTarget;
    const work = [];
    for (const fs of document.querySelectorAll('#modal [data-src]')) {
      const x = rows[Number(fs.dataset.src)];
      const del = fs.querySelector('[data-sdel]').checked;
      const name = fs.querySelector('[data-sn]').value.trim();
      if (del) { if (x.id) work.push({ x, del }); continue; }
      if (!name && !x.id) continue;
      const amount = F.parseCents(fs.querySelector('[data-sa]').value.replace(/[$,\s]/g, ''));
      if (!name || !amount) return showToast('Cada ingreso necesita nombre y monto', 'error');
      const frequency = fs.querySelector('[data-sf]').value, wd = fs.querySelector('[data-sw]').value;
      work.push({ x, body: { name, amount_cents: amount, frequency, pay_weekday: frequency === 'semanal' && wd !== '' ? Number(wd) : null } });
    }
    btn.disabled = true; btn.textContent = 'Guardando…';
    try {
      for (const w of work) {
        if (w.del) { await dbPatch('income_sources', { active: false }, `?id=eq.${w.x.id}`); f.incomes = f.incomes.filter(s => s.id !== w.x.id); continue; }
        if (w.x.id) {
          await dbPatch('income_sources', w.body, `?id=eq.${w.x.id}`);
          Object.assign(f.incomes.find(s => s.id === w.x.id), w.body);
        } else {
          const c = await ensureIncomeCategory(f, w.body.name);
          const [row] = await dbPost('income_sources', { ...w.body, category_id: c.id, active: true, counts_for_budget: true });
          f.incomes.push(row);
        }
      }
      closeModal(); showToast('Ingresos guardados'); paint();
    } catch { btn.disabled = false; btn.textContent = 'Guardar'; showToast('No se pudieron guardar', 'error'); paint(); }
  };
}

// ── Nueva tarjeta de crédito ─────────────────────────
function openNewCard() {
  const f = state.f;
  const hasPlataCredit = F.bankAccounts(f).some(a => a.kind === 'credit' && /plata/i.test(a.name));
  const cardNames = [...new Set((f.captures || []).map(c => c.card_name).filter(Boolean))];
  openModal('Nueva tarjeta de crédito', `
    <label class="flabel" for="ncName" style="margin-top:0">Nombre</label>
    <input class="field" id="ncName" maxlength="40" value="${hasPlataCredit ? '' : 'Plata crédito'}" placeholder="Ej. Plata crédito">
    <label class="flabel" for="ncDebt">Deuda de hoy (lo que debes en total)</label>
    <input class="field" id="ncDebt" inputmode="decimal" autocomplete="off" placeholder="0.00">
    <div class="row2"><div><label class="flabel" for="ncCut">Día de corte</label><input class="field" id="ncCut" inputmode="numeric" maxlength="2" placeholder="1–31"></div>
      <div><label class="flabel" for="ncPay">Día límite de pago</label><input class="field" id="ncPay" inputmode="numeric" maxlength="2" placeholder="1–31"></div></div>
    <label class="flabel" for="ncLim">Límite de crédito (opcional)</label>
    <input class="field" id="ncLim" inputmode="decimal" autocomplete="off" placeholder="0.00">
    ${cardNames.length ? `<div class="flabel">Pagos de Apple Pay que van a esta tarjeta</div>
      ${cardNames.map((n, i) => `<label class="small" style="display:flex;gap:8px;align-items:center;margin-top:4px"><input type="checkbox" data-nccard="${i}"${/plata/i.test(n) && !hasPlataCredit ? ' checked' : ''}> ${escapeHTML(n)}</label>`).join('')}
      <label class="small" style="display:flex;gap:8px;align-items:flex-start;margin-top:10px"><input type="checkbox" id="ncMove" checked> Mover aquí los gastos de Apple Pay de esas tarjetas que ya se registraron en otra cuenta</label>` : ''}
  `, `<button type="button" class="btn-primary" id="ncSave">Agregar tarjeta</button>`);
  document.getElementById('ncSave').onclick = async e => {
    const btn = e.currentTarget;
    const name = document.getElementById('ncName').value.trim();
    const debt = document.getElementById('ncDebt').value.trim() ? F.parseCents(document.getElementById('ncDebt').value.replace(/[$,\s]/g, '')) : 0;
    const cut = Number(document.getElementById('ncCut').value), pay = Number(document.getElementById('ncPay').value);
    const lim = document.getElementById('ncLim').value.trim() ? F.parseCents(document.getElementById('ncLim').value.replace(/[$,\s]/g, '')) : 0;
    if (!name) return showToast('Ponle nombre a la tarjeta', 'error');
    if (f.accounts.some(a => !a.archived && a.name.trim().toLowerCase() === name.toLowerCase())) return showToast('Ya tienes una cuenta con ese nombre', 'error');
    if (debt === null) return showToast('Revisa la deuda', 'error');
    if (!(cut >= 1 && cut <= 31) || !(pay >= 1 && pay <= 31)) return showToast('Revisa los días de corte y de pago', 'error');
    if (lim === null) return showToast('Revisa el límite', 'error');
    const picked = [...document.querySelectorAll('#modal [data-nccard]:checked')].map(c => cardNames[Number(c.dataset.nccard)]);
    const move = document.getElementById('ncMove')?.checked;
    const caps = move ? (f.captures || []).filter(c => picked.includes(c.card_name) && c.transaction_id) : [];
    const txs = caps.map(c => f.tx.find(t => t.id === c.transaction_id)).filter(t => t && t.type === 'expense');
    const moved = txs.reduce((x, t) => x + (Number(t.amount_cents) || 0), 0);
    btn.disabled = true; btn.textContent = 'Guardando…';
    try {
      // Saldo inicial para que, con los gastos movidos, la deuda de hoy sea la que escribiste.
      const [acc] = await dbPost('accounts', { name, kind: 'credit', institution: name.split(/\s+/)[0], opening_balance_cents: -debt + moved, sort_order: 3 });
      f.accounts.push(acc);
      const [card] = await dbPost('card_settings', { account_id: acc.id, cut_day: cut, pay_day: pay, credit_limit_cents: lim || 0 });
      f.cards.push(card);
      for (const n of picked) {
        const [m] = await dbUpsert('capture_card_accounts', { card_name: n, account_id: acc.id }, 'user_id,card_name');
        if (f.cardMap) { f.cardMap = f.cardMap.filter(x => x.card_name !== n); if (m) f.cardMap.push(m); }
      }
      for (const t of txs) { await dbPatch('transactions', { account_id: acc.id }, `?id=eq.${t.id}`); t.account_id = acc.id; }
      for (const c of caps) { await dbPatch('wallet_captures', { account_id: acc.id }, `?id=eq.${c.id}`); c.account_id = acc.id; }
      closeModal(); paint();
      showToast(txs.length ? `Tarjeta agregada y ${txs.length} gasto${txs.length === 1 ? '' : 's'} movido${txs.length === 1 ? '' : 's'}. Revisa Saldos reales.` : 'Tarjeta agregada');
    } catch { btn.disabled = false; btn.textContent = 'Agregar tarjeta'; showToast('No se pudo agregar la tarjeta', 'error'); paint(); }
  };
}

// ── Pegar movimientos ────────────────────────────────
// Una línea por gasto: fecha ; descripción ; monto ; categoría
// Si la categoría es "Préstamo: Nombre", no es gasto tuyo: se registra como préstamo (te debe) desde esa cuenta.
// Por defecto el saldo de hoy de la cuenta no cambia (son gastos que ya están en tu saldo real).
function parsePaste(text) {
  const out = [], bad = [];
  text.split(/\r?\n/).map(l => l.trim()).filter(Boolean).forEach((line, i) => {
    const p = line.split(/\s*[;|\t]\s*/);
    const date = p[0], desc = (p[1] || '').trim(), amount = F.parseCents(String(p[2] || '').replace(/[$,\s]/g, '')), cat = (p[3] || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !desc || !amount) { bad.push(i + 1); return; }
    const loan = cat.match(/^pr[eé]stamo\s*:\s*(.+)$/i);
    out.push({ date, desc: desc.slice(0, 120), amount, cat: loan ? '' : cat, loan: loan ? loan[1].trim() : '' });
  });
  return { rows: out, bad };
}
function openPaste() {
  const f = state.f;
  const accs = F.bankAccounts(f).filter(a => a.kind !== 'investment');
  const pre = accs.find(a => a.kind === 'credit' && /bbva/i.test(a.name)) || accs[0];
  openModal('Pegar movimientos', `
    <p class="small" style="margin:0">Una línea por gasto: <code>fecha ; descripción ; monto ; categoría</code>. Para algo que pagaste por otra persona usa la categoría <code>Préstamo: Nombre</code>.</p>
    <label class="flabel" for="pAcc">Cuenta o tarjeta</label>
    <select class="field" id="pAcc">${accs.map(a => `<option value="${escapeHTML(a.id)}"${a === pre ? ' selected' : ''}>${escapeHTML(a.name)}</option>`).join('')}</select>
    <label class="flabel" for="pText">Movimientos</label>
    <textarea class="field" id="pText" rows="7" style="height:auto;font-size:14px" placeholder="2026-10-31; H&M; 1988; Ropa"></textarea>
    <label class="small" style="display:flex;gap:8px;align-items:flex-start;margin-top:8px"><input type="checkbox" id="pKeep" checked> Ya están en el saldo de hoy de la cuenta (no cambiar su saldo)</label>
    <div id="pPrev"></div>
  `, `<button type="button" class="btn-primary" id="pGo">Revisar</button>`);
  let parsed = null;
  const go = document.getElementById('pGo');
  document.getElementById('pText').oninput = () => { parsed = null; go.textContent = 'Revisar'; document.getElementById('pPrev').innerHTML = ''; };
  go.onclick = async () => {
    const accId = document.getElementById('pAcc').value;
    if (!parsed) {
      parsed = parsePaste(document.getElementById('pText').value);
      if (!parsed.rows.length) { parsed = null; return showToast('No encontré líneas válidas', 'error'); }
      const dup = r => f.tx.some(t => t.account_id === accId && t.occurred_on === r.date && Number(t.amount_cents) === r.amount && (t.type === 'expense' || t.type === 'transfer'));
      parsed.rows.forEach(r => { r.dup = dup(r); });
      const byCat = {};
      parsed.rows.filter(r => !r.dup).forEach(r => { const k = r.loan ? `Préstamo: ${r.loan}` : (r.cat || 'Sin categoría'); byCat[k] = (byCat[k] || 0) + r.amount; });
      const fresh = parsed.rows.filter(r => !r.dup);
      document.getElementById('pPrev').innerHTML = `
        <div class="flabel">${fresh.length} por registrar · ${F.fmtMoney(fresh.reduce((x, r) => x + r.amount, 0))}</div>
        ${Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<div class="bud-line"><span>${escapeHTML(k)}</span><span>${F.fmtMoney(v)}</span></div>`).join('')}
        ${parsed.rows.some(r => r.dup) ? `<p class="small" style="margin:6px 0 0">${parsed.rows.filter(r => r.dup).length} ya estaban registrados (misma fecha y monto) y se saltan.</p>` : ''}
        ${parsed.bad.length ? `<p class="small" style="margin:6px 0 0;color:var(--alert)">No entendí las líneas ${parsed.bad.join(', ')}.</p>` : ''}`;
      go.textContent = fresh.length ? `Registrar ${fresh.length}` : 'Nada nuevo';
      return;
    }
    const rows = parsed.rows.filter(r => !r.dup);
    if (!rows.length) return closeModal();
    const acc = f.accounts.find(a => a.id === accId);
    go.disabled = true; go.textContent = 'Guardando…';
    try {
      const cats = {}, loans = {};
      for (const r of rows) {
        if (r.loan && !loans[r.loan]) {
          let l = f.accounts.find(a => a.kind === 'lent' && !a.archived && a.name.trim().toLowerCase() === r.loan.toLowerCase());
          if (!l) { [l] = await dbPost('accounts', { name: r.loan, kind: 'lent', opening_balance_cents: 0, sort_order: 100 }); f.accounts.push(l); }
          loans[r.loan] = l;
        } else if (r.cat && !cats[r.cat]) {
          let c = f.categories.find(x => x.kind === 'expense' && x.name.trim().toLowerCase() === r.cat.toLowerCase());
          if (c && c.archived) { await dbPatch('categories', { archived: false }, `?id=eq.${c.id}`); c.archived = false; }
          if (!c) { [c] = await dbPost('categories', { name: r.cat, kind: 'expense' }); f.categories.push(c); }
          cats[r.cat] = c;
        }
      }
      const body = rows.map(r => r.loan
        ? { type: 'transfer', amount_cents: r.amount, account_id: accId, to_account_id: loans[r.loan].id, category_id: null, occurred_on: r.date, note: r.desc }
        : { type: 'expense', amount_cents: r.amount, account_id: accId, to_account_id: null, category_id: r.cat ? cats[r.cat].id : null, occurred_on: r.date, note: r.desc });
      const created = await dbPost('transactions', body);
      f.tx.push(...created); sortTx();
      if (document.getElementById('pKeep').checked) { // el saldo de hoy no cambia: ya incluía estos gastos
        const total = rows.reduce((x, r) => x + r.amount, 0);
        const opening = (Number(acc.opening_balance_cents) || 0) + total;
        await dbPatch('accounts', { opening_balance_cents: opening }, `?id=eq.${acc.id}`); acc.opening_balance_cents = opening;
      }
      closeModal(); showToast(`${created.length} movimiento${created.length === 1 ? '' : 's'} registrado${created.length === 1 ? '' : 's'}`); paint();
    } catch { go.disabled = false; go.textContent = `Registrar ${rows.length}`; showToast('No se pudieron registrar', 'error'); paint(); }
  };
}

// ── Cuenta (nueva o editar): nombre, tipo, saldo de hoy, % tuyo y tasa ──
const KINDS = { debit: 'Débito', savings: 'Ahorro', investment: 'Inversión', cash: 'Efectivo' };
function openAccount(id) {
  const f = state.f;
  const a = id ? f.accounts.find(x => x.id === id) : null;
  const hasPct = f.accounts.some(x => 'owned_pct' in x);
  const bal = a ? F.accBalance(f, a.id) : 0;
  openModal(a ? `Editar ${a.name}` : 'Nueva cuenta', `
    <div class="row2"><div><label class="flabel" for="naName" style="margin-top:0">Nombre</label><input class="field" id="naName" maxlength="40" value="${escapeHTML(a ? a.name : '')}" placeholder="Ej. Plata Ahorros"></div>
      <div><label class="flabel" for="naInst" style="margin-top:0">Banco</label><input class="field" id="naInst" maxlength="40" value="${escapeHTML(a ? a.institution || '' : '')}" placeholder="Ej. Plata"></div></div>
    <div class="row2"><div><label class="flabel" for="naKind">Tipo</label><select class="field" id="naKind">${Object.entries(KINDS).map(([k, v]) => `<option value="${k}"${a && a.kind === k ? ' selected' : ''}>${v}</option>`).join('')}</select></div>
      <div><label class="flabel" for="naBal">Saldo de hoy</label><input class="field" id="naBal" inputmode="decimal" autocomplete="off" value="${centsInput(bal)}"></div></div>
    <div class="row2"><div><label class="flabel" for="naRate">Rendimiento % anual</label><input class="field" id="naRate" inputmode="decimal" autocomplete="off" placeholder="Sin rendimiento" value="${a && Number(a.annual_rate_pct) > 0 ? Number(a.annual_rate_pct) : ''}"></div>
      ${hasPct ? `<div><label class="flabel" for="naPct">¿Cuánto es tuyo? %</label><input class="field" id="naPct" inputmode="decimal" autocomplete="off" value="${a ? F.ownedPct(a) : 100}"></div>` : '<div></div>'}</div>
    ${hasPct ? '<p class="small" style="margin:4px 0 0">100 = todo tuyo · 50 = la mitad (p. ej. B-Project) · 0 = lo cuidas para alguien más (no cuenta en tu dinero ni en tus gastos).</p>' : ''}
    ${a ? '<label class="small" style="display:flex;gap:8px;align-items:center;margin-top:10px"><input type="checkbox" id="naArch"> Esta cuenta no existe: quitarla (sus movimientos se conservan)</label>' : ''}
  `, `<button type="button" class="btn-primary" id="naSave">${a ? 'Guardar' : 'Agregar cuenta'}</button>`);
  document.getElementById('naSave').onclick = async e => {
    const btn = e.currentTarget;
    const name = document.getElementById('naName').value.trim();
    const kind = document.getElementById('naKind').value;
    const cents = F.parseCents(document.getElementById('naBal').value.replace(/[$,\s]/g, '') || '0');
    const rateRaw = document.getElementById('naRate').value.trim().replace('%', '').replace(',', '.');
    const rate = rateRaw === '' ? null : Number(rateRaw);
    const pct = hasPct ? Number(document.getElementById('naPct').value.replace('%', '').trim() || '100') : null;
    const archive = document.getElementById('naArch')?.checked;
    if (!name) return showToast('Ponle nombre a la cuenta', 'error');
    if (f.accounts.some(x => x !== a && !x.archived && x.name.trim().toLowerCase() === name.toLowerCase())) return showToast('Ya tienes una cuenta con ese nombre', 'error');
    if (cents === null) return showToast('Revisa el saldo', 'error');
    if (rate !== null && !(rate >= 0 && rate <= 100)) return showToast('Revisa el rendimiento', 'error');
    if (hasPct && !(pct >= 0 && pct <= 100)) return showToast('El % tuyo va de 0 a 100', 'error');
    const body = { name, institution: document.getElementById('naInst').value.trim() || null, kind };
    if (hasNewCols(f)) {
      body.annual_rate_pct = rate || null;
      if (rate > 0 && !(a && Number(a.annual_rate_pct) > 0)) body.yield_since = localDate();
    }
    if (hasPct) body.owned_pct = pct;
    if (archive) body.archived = true;
    btn.disabled = true; btn.textContent = 'Guardando…';
    try {
      if (a) {
        body.opening_balance_cents = (Number(a.opening_balance_cents) || 0) + (cents - bal); // el saldo de hoy queda como lo escribiste
        await dbPatch('accounts', body, `?id=eq.${a.id}`); Object.assign(a, body);
      } else {
        const [row] = await dbPost('accounts', { ...body, opening_balance_cents: cents, sort_order: 10 });
        f.accounts.push(row);
      }
      closeModal(); showToast(archive ? 'Cuenta quitada' : a ? 'Cuenta guardada' : 'Cuenta agregada'); paint();
      if (await syncYields(f)) paint();
    } catch { btn.disabled = false; btn.textContent = a ? 'Guardar' : 'Agregar cuenta'; showToast('No se pudo guardar la cuenta', 'error'); }
  };
}
