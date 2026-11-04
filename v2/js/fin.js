// Finanzas: carga y cálculos. Usa las MISMAS tablas y fórmulas que v1 (index.html,
// sección "FINANZAS"), para que v1 y v2 den los mismos saldos. Montos en centavos.
import { safeGet } from './db.js?v=202611032349';
import { localDate } from './util.js?v=202611032349';

export async function loadFinance() {
  const [accounts, categories, tx, budgets, goals, positions, valuations, cards, captures, tokens, cardMap] = await Promise.all([
    safeGet('accounts', '?order=sort_order.asc,name.asc'),
    safeGet('categories', '?order=name.asc'),
    safeGet('transactions', '?order=occurred_on.desc,created_at.desc'),
    safeGet('budgets', '?order=month.desc'),
    safeGet('money_goals', '?archived=eq.false&order=created_at.asc'),
    safeGet('investment_positions', '?order=created_at.asc'),
    safeGet('position_valuations', '?order=month.asc'),
    safeGet('card_settings', ''),
    safeGet('wallet_captures', '?order=received_at.desc&limit=200'),   // tabla nueva (v2/sql)
    safeGet('capture_tokens', '?revoked=eq.false&order=created_at.desc'),
    safeGet('capture_card_accounts', '')                               // tabla nueva (captura-tarjetas.sql)
  ]);
  const errors = Object.entries({ accounts, categories, transactions: tx, budgets })
    .filter(([, v]) => v === null).map(([k]) => k);
  return {
    accounts: accounts || [], categories: categories || [], tx: tx || [], budgets: budgets || [],
    goals: goals || [], positions: positions || [], valuations: valuations || [], cards: cards || [],
    captures, tokens, // null = la migración de captura aún no se corrió
    cardMap,          // null = falta 2026-11-03-captura-tarjetas.sql
    errors
  };
}

// ── Formato ──────────────────────────────────────────
const moneyFmt = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });
const moneyFmt0 = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 });
export const fmtMoney = c => moneyFmt.format((Number(c) || 0) / 100);
// Sin centavos para cifras grandes de tarjetas (como el mockup).
export const fmtMoney0 = c => moneyFmt0.format(Math.round((Number(c) || 0) / 100));
export const fmtSigned = c => (c < 0 ? '−' : '') + fmtMoney0(Math.abs(c));

// "1,234.5" → 123450; null si no es válido. Sin flotantes (igual que v1).
export function parseCents(s) {
  s = String(s || '').replace(/[\s$,]/g, '');
  if (!/^\d+(\.\d{0,2})?$/.test(s)) return null;
  const [i, f = ''] = s.split('.');
  return Number(i) * 100 + Number((f + '00').slice(0, 2));
}

// ── Fechas y periodos ────────────────────────────────
export function monthStartStr(offset = 0) {
  const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + offset);
  return localDate(d).slice(0, 8) + '01';
}
export function monthName(offset = 0) {
  const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + offset);
  return d.toLocaleDateString('es-MX', { month: 'long' });
}
// Periodo calendario actual: mes, trimestre o año. {from, to} con `to` exclusivo, y cuántos meses abarca.
export function periodRange(kind) {
  const now = new Date();
  if (kind === 'trimestre') {
    const q = Math.floor(now.getMonth() / 3) * 3;
    return { from: localDate(new Date(now.getFullYear(), q, 1)), to: localDate(new Date(now.getFullYear(), q + 3, 1)), months: 3, label: 'este trimestre' };
  }
  if (kind === 'anio') {
    return { from: `${now.getFullYear()}-01-01`, to: `${now.getFullYear() + 1}-01-01`, months: 12, label: `en ${now.getFullYear()}` };
  }
  return { from: monthStartStr(0), to: monthStartStr(1), months: 1, label: `en ${monthName(0)}` };
}
export const inRange = (t, r) => t.occurred_on >= r.from && t.occurred_on < r.to;

// ── Cuentas ──────────────────────────────────────────
export const isLoan = a => a && (a.kind === 'lent' || a.kind === 'borrowed');
export const activeAccounts = f => f.accounts.filter(a => !a.archived)
  .sort((a, b) => ((a.sort_order || 0) - (b.sort_order || 0)) || a.name.localeCompare(b.name, 'es'));
export const bankAccounts = f => activeAccounts(f).filter(a => !isLoan(a));
export const activeCats = (f, kind) => f.categories.filter(c => !c.archived && (!kind || c.kind === kind))
  .sort((a, b) => a.name.localeCompare(b.name, 'es'));
export const catName = (f, id) => f.categories.find(c => c.id === id)?.name || 'Sin categoría';
export const accName = (f, id) => f.accounts.find(a => a.id === id)?.name || '—';

// Saldo = inicial + ingresos − gastos − transf. salientes + transf. entrantes.
export function accBalance(f, id) {
  const a = f.accounts.find(x => x.id === id);
  let b = Number(a && a.opening_balance_cents) || 0;
  for (const t of f.tx) {
    const amt = Number(t.amount_cents) || 0;
    if (t.account_id === id) b += t.type === 'income' ? amt : -amt;
    if (t.type === 'transfer' && t.to_account_id === id) b += amt;
  }
  return b;
}
export function positionValue(f, p, offset = 0) {
  const ms = monthStartStr(offset);
  const v = f.valuations.filter(x => x.position_id === p.id && x.month <= ms).sort((a, b) => a.month < b.month ? 1 : -1)[0];
  return v ? Number(v.value_cents) : null;
}
export const accPositions = (f, id) => f.positions.filter(p => !p.archived && p.account_id === id);
// Cuentas con fondos valen la suma del último valor de sus fondos.
export function accountValue(f, id) {
  const ps = accPositions(f, id);
  return ps.length ? ps.reduce((s, p) => s + (positionValue(f, p) || 0), 0) : accBalance(f, id);
}
export function loanOwed(f, a) {
  let b = Number(a.opening_balance_cents) || 0;
  for (const t of f.tx) {
    const amt = Number(t.amount_cents) || 0;
    if (t.account_id === a.id) b += t.type === 'income' ? amt : -amt;
    if (t.type === 'transfer' && t.to_account_id === a.id) b += amt;
  }
  return a.kind === 'lent' ? b : -b;
}

// Patrimonio neto como la vista Patrimonio de v1: fondos (heredados + propios) + cuentas sin fondos + préstamos.
export function netWorth(f) {
  const funds = f.positions.filter(p => !p.archived);
  const fv = p => positionValue(f, p) || 0;
  const fprev = p => { const v = positionValue(f, p, -1); return v === null ? fv(p) : v; };
  let total = funds.reduce((s, p) => s + fv(p), 0);
  for (const a of bankAccounts(f)) if (!accPositions(f, a.id).length) total += accBalance(f, a.id);
  for (const l of activeAccounts(f).filter(isLoan)) {
    const o = loanOwed(f, l);
    if (o > 0) total += l.kind === 'lent' ? o : -o;
  }
  const { inc, exp } = totals(f, periodRange('mes'));
  const change = inc - exp + funds.reduce((s, p) => s + fv(p) - fprev(p), 0);
  const invested = funds.reduce((s, p) => s + fv(p), 0)
    + bankAccounts(f).filter(a => a.kind === 'investment' && !accPositions(f, a.id).length).reduce((s, a) => s + accBalance(f, a.id), 0);
  return { total, change, invested };
}

// ── Movimientos y presupuesto ────────────────────────
export function totals(f, r) {
  let inc = 0, exp = 0;
  for (const t of f.tx) {
    if (!inRange(t, r)) continue;
    if (t.type === 'income') inc += Number(t.amount_cents) || 0;
    else if (t.type === 'expense') exp += Number(t.amount_cents) || 0;
  }
  return { inc, exp };
}
export function spentOn(f, day) {
  return f.tx.filter(t => t.type === 'expense' && t.occurred_on === day).reduce((s, t) => s + (Number(t.amount_cents) || 0), 0);
}
const isSavingsAcc = (f, id) => { const a = f.accounts.find(x => x.id === id); return !!a && (a.kind === 'savings' || a.kind === 'investment'); };
// Ahorro = transferencias hacia ahorro/inversión desde otras cuentas − las que salen (sin repartos).
export function savedIn(f, r) {
  let s = 0;
  for (const t of f.tx) {
    if (t.type !== 'transfer' || t.is_allocation || !inRange(t, r)) continue;
    const from = isSavingsAcc(f, t.account_id), to = isSavingsAcc(f, t.to_account_id);
    if (to && !from) s += Number(t.amount_cents) || 0;
    else if (from && !to) s -= Number(t.amount_cents) || 0;
  }
  return s;
}
// Presupuesto vigente: el del mes actual o el último anterior (se repite). null = sin presupuesto.
export function currentBudget(f, catId) {
  const ms = monthStartStr(0);
  const b = f.budgets.filter(x => x.category_id === catId && x.month <= ms).sort((a, c) => a.month < c.month ? 1 : -1)[0];
  return b && Number(b.amount_cents) > 0 ? b : null;
}
// Categorías de gasto con presupuesto: gastado en el periodo vs. presupuesto × meses del periodo.
export function budgetRows(f, r) {
  return activeCats(f, 'expense').map(c => {
    const b = currentBudget(f, c.id);
    if (!b) return null;
    const spent = f.tx.filter(t => t.type === 'expense' && t.category_id === c.id && inRange(t, r))
      .reduce((s, t) => s + (Number(t.amount_cents) || 0), 0);
    return { cat: c, budget: Number(b.amount_cents) * r.months, spent };
  }).filter(Boolean).sort((a, b) => b.spent / b.budget - a.spent / a.budget);
}
export function monthBudgetTotal(f) {
  return activeCats(f, 'expense').reduce((s, c) => s + (Number(currentBudget(f, c.id)?.amount_cents) || 0), 0);
}
// Gasto de los últimos n meses (para la gráfica de escritorio).
export function monthlySpend(f, n = 6) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const r = { from: monthStartStr(-i), to: monthStartStr(-i + 1) };
    out.push({ label: monthName(-i).slice(0, 3), value: totals(f, r).exp, current: i === 0 });
  }
  return out;
}

// ── Metas (igual que goalCurrent de v1) ──────────────
export function goalCurrent(f, g) {
  if (!g.account_id) return Number(g.saved_cents) || 0;
  const acc = f.accounts.find(a => a.id === g.account_id);
  const pool = Math.max(0, acc && acc.kind === 'investment' && accPositions(f, acc.id).length ? accBalance(f, acc.id) : accountValue(f, g.account_id));
  const k = x => x.due_date || '9999-12-31';
  const sib = f.goals.filter(x => x.account_id === g.account_id)
    .sort((a, b) => k(a) < k(b) ? -1 : k(a) > k(b) ? 1 : String(a.created_at).localeCompare(String(b.created_at)));
  if (sib.length < 2) return pool;
  let left = pool;
  for (const x of sib) { const take = Math.min(left, Number(x.target_cents) || 0); if (x.id === g.id) return take; left -= take; }
  return 0;
}

// ── Tarjetas de crédito ──────────────────────────────
// Siguiente fecha de pago (hoy o después) para un día del mes.
export function nextPayDate(day) {
  const now = new Date(); now.setHours(0, 0, 0, 0);
  for (let i = 0; i < 2; i++) {
    const y = now.getFullYear(), m = now.getMonth() + i;
    const len = new Date(y, m + 1, 0).getDate();
    const d = new Date(y, m, Math.min(day, len));
    if (d >= now) return d;
  }
  return null;
}
// Próximo pago de tarjeta: la de crédito con deuda y fecha de pago más cercana.
export function nextCardPayment(f) {
  return bankAccounts(f).filter(a => a.kind === 'credit').map(a => {
    const c = f.cards.find(x => x.account_id === a.id);
    const debt = -accBalance(f, a.id);
    return c && debt > 0 ? { account: a, date: nextPayDate(c.pay_day), debt } : null;
  }).filter(x => x && x.date).sort((a, b) => a.date - b.date)[0] || null;
}

// ── Capturas de Apple Pay ────────────────────────────
export function captureByTx(f) {
  const m = new Map();
  for (const c of f.captures || []) if (c.transaction_id) m.set(c.transaction_id, c);
  return m;
}
// Cuenta que ya elegiste antes para esta tarjeta (sin distinguir mayúsculas).
export function rememberedAccount(f, cardName) {
  if (!f.cardMap || !cardName) return null;
  const m = f.cardMap.find(x => x.card_name.toLowerCase() === cardName.toLowerCase());
  return m && f.accounts.some(a => a.id === m.account_id && !a.archived) ? m.account_id : null;
}
// Por revisar: capturas sin cuenta, o gastos capturados que siguen sin categoría.
export function capturesToReview(f) {
  if (!f.captures) return [];
  return f.captures.filter(c => {
    if (c.status === 'pending') return true;
    if (c.status !== 'linked') return false;
    const t = f.tx.find(x => x.id === c.transaction_id);
    return t && !t.category_id;
  });
}
