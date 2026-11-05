// Finanzas: carga y cálculos. Usa las MISMAS tablas y fórmulas que v1 (index.html,
// sección "FINANZAS"), para que v1 y v2 den los mismos saldos. Montos en centavos.
import { safeGet } from './db.js?v=202611051626';
import { localDate } from './util.js?v=202611051626';

export async function loadFinance() {
  const [accounts, categories, tx, budgets, goals, positions, valuations, cards, captures, tokens, cardMap, attempts, incomes, assumptions, contribs] = await Promise.all([
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
    safeGet('capture_card_accounts', ''),                              // tabla nueva (captura-tarjetas.sql)
    safeGet('capture_attempts', '?order=at.desc&limit=8'),             // bitácora del Atajo (captura-bitacora.sql)
    safeGet('income_sources', '?active=eq.true&order=created_at.asc'),
    safeGet('assumptions', ''),
    safeGet('goal_contributions', '?order=created_at.desc')            // aportaciones-metas.sql
  ]);
  const errors = Object.entries({ accounts, categories, transactions: tx, budgets })
    .filter(([, v]) => v === null).map(([k]) => k);
  return {
    accounts: accounts || [], categories: categories || [], tx: tx || [], budgets: budgets || [],
    goals: goals || [], positions: positions || [], valuations: valuations || [], cards: cards || [],
    captures, tokens, // null = la migración de captura aún no se corrió
    cardMap,          // null = falta 2026-11-03-captura-tarjetas.sql
    attempts,         // null = falta 2026-11-04-captura-bitacora.sql
    incomes: incomes || [], assumptions: assumptions || [],
    contribs,         // null = falta 2026-11-04-aportaciones-metas.sql
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
// Saldo al cierre de un día (YYYY-MM-DD). skip = movimiento que no se cuenta.
export function balanceOn(f, id, day, skip = null) {
  const a = f.accounts.find(x => x.id === id);
  let b = Number(a && a.opening_balance_cents) || 0;
  for (const t of f.tx) {
    if (t === skip || t.occurred_on > day) continue;
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
  for (const a of bankAccounts(f)) if (!accPositions(f, a.id).length) total += Math.round(accBalance(f, a.id) * ownedPct(a) / 100);
  for (const l of activeAccounts(f).filter(isLoan)) {
    const o = loanOwed(f, l);
    if (o > 0) total += l.kind === 'lent' ? o : -o;
  }
  const { inc, exp } = totals(f, periodRange('mes'));
  const change = inc - exp + funds.reduce((s, p) => s + fv(p) - fprev(p), 0);
  const invested = funds.reduce((s, p) => s + fv(p), 0)
    + bankAccounts(f).filter(a => a.kind === 'investment' && !accPositions(f, a.id).length).reduce((s, a) => s + Math.round(accBalance(f, a.id) * ownedPct(a) / 100), 0);
  return { total, change, invested };
}

// ── Movimientos y presupuesto ────────────────────────
// Parte que es tuya de una cuenta (B-Project 50, Carro 0). Las que no son 100% tuyas no cuentan en ingresos/gastos.
export const ownedPct = a => (a && a.owned_pct !== undefined && a.owned_pct !== null ? Number(a.owned_pct) : 100);
const isShared = (f, id) => ownedPct(f.accounts.find(a => a.id === id)) < 100;
export function totals(f, r) {
  let inc = 0, exp = 0;
  for (const t of f.tx) {
    if (!inRange(t, r) || isShared(f, t.account_id)) continue;
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
// Día "day" del mes (y, m), ajustado a meses cortos.
const dayIn = (y, m, day) => new Date(y, m, Math.min(day, new Date(y, m + 1, 0).getDate()));
// Último corte: el día de corte más reciente que ya pasó (hoy cuenta como corte).
export function lastCutDate(cutDay, today = new Date()) {
  const t = new Date(today); t.setHours(0, 0, 0, 0);
  let d = dayIn(t.getFullYear(), t.getMonth(), cutDay);
  if (d > t) d = dayIn(t.getFullYear(), t.getMonth() - 1, cutDay);
  return d;
}
// Fecha límite de pago de ese corte: el primer día de pago después del corte.
export function dueDateAfter(cut, payDay) {
  let d = dayIn(cut.getFullYear(), cut.getMonth(), payDay);
  if (d <= cut) d = dayIn(cut.getFullYear(), cut.getMonth() + 1, payDay);
  return d;
}
// Estado de una tarjeta de crédito:
//   debt      = deuda total hoy (incluye compras después del corte)
//   statement = pago para no generar intereses de este corte (lo que dijo el banco, o lo calculado al corte)
//   paid      = pagos hechos después del corte · toPay = lo que falta para la fecha límite
export function cardStatus(f, a) {
  const c = f.cards.find(x => x.account_id === a.id);
  if (!c) return null;
  const cut = lastCutDate(c.cut_day), cutStr = localDate(cut);
  const due = dueDateAfter(cut, c.pay_day);
  const fromBank = c.statement_cut_on === cutStr && c.statement_due_cents !== null && c.statement_due_cents !== undefined;
  const statement = fromBank ? Number(c.statement_due_cents) : Math.max(0, -balanceOn(f, a.id, cutStr));
  let paid = 0;
  for (const t of f.tx) {
    if (t.occurred_on <= cutStr) continue;
    const amt = Number(t.amount_cents) || 0;
    if (t.type === 'transfer' && t.to_account_id === a.id) paid += amt;
    else if (t.type === 'income' && t.account_id === a.id) paid += amt;
  }
  const spent = f.tx.filter(t => t.type === 'expense' && t.account_id === a.id && t.occurred_on > cutStr)
    .reduce((x, t) => x + (Number(t.amount_cents) || 0), 0);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return {
    card: c, cut, cutStr, due, fromBank, statement, paid, spent,
    toPay: Math.max(0, statement - paid), debt: Math.max(0, -accBalance(f, a.id)),
    overdue: today > due && statement - paid > 0,
    nextCut: dayIn(cut.getFullYear(), cut.getMonth() + 1, c.cut_day)
  };
}
// Próximo pago de tarjeta: la de crédito con pago pendiente y fecha límite más cercana.
export function nextCardPayment(f) {
  return bankAccounts(f).filter(a => a.kind === 'credit').map(a => {
    const s = cardStatus(f, a);
    return s && s.toPay > 0 ? { account: a, date: s.due, debt: s.toPay, total: s.debt } : null;
  }).filter(Boolean).sort((a, b) => a.date - b.date)[0] || null;
}

// ── Ingresos esperados (mismas reglas que "Este mes") ─
// Desde cuándo se piden: el 1 del mes o la fecha de tus saldos reales (assumptions.start_date), lo que sea después.
export function startDate(f) {
  const a = f.assumptions.find(x => x.key === 'start_date');
  if (!a || a.value === null || a.value === undefined) return null;
  const s = String(Math.round(Number(a.value)));
  return new Date(Number(s.slice(0, 4)), Number(s.slice(4, 6)) - 1, Number(s.slice(6, 8)));
}
function countFrom(f) {
  const first = new Date(); first.setHours(0, 0, 0, 0); first.setDate(1);
  const st = startDate(f);
  return st && st > first ? st : first;
}
// Pagos de una fuente con fecha en [from, until). null = no sé qué día llega.
function paydaysFrom(src, from, until) {
  const a = Number(src.amount_cents) || 0;
  if (src.frequency === 'semanal') {
    if (src.pay_weekday === null || src.pay_weekday === undefined || src.pay_weekday === '') return null;
    let n = 0; const d = new Date(from);
    while (d < until) { if (d.getDay() === Number(src.pay_weekday)) n++; d.setDate(d.getDate() + 1); }
    return n * a;
  }
  if ((src.frequency === 'mensual' || src.frequency === 'quincenal') && src.pay_day) {
    const y = from.getFullYear(), m = from.getMonth(), len = new Date(y, m + 1, 0).getDate();
    const days = src.frequency === 'mensual' ? [src.pay_day] : [src.pay_day, src.pay_day + 15];
    return days.filter(dd => dd <= len).map(dd => new Date(y, m, dd)).filter(dt => dt >= from && dt < until).length * a;
  }
  return null;
}
function expectedThisMonth(f, src) {
  const from = countFrom(f), end = new Date(from.getFullYear(), from.getMonth() + 1, 1);
  const n = paydaysFrom(src, from, end);
  if (n !== null) return n;
  const a = Number(src.amount_cents) || 0;
  return src.frequency === 'semanal' ? a * 4 : src.frequency === 'quincenal' ? a * 2 : a;
}
// Recibido = ingresos de esa categoría registrados desde countFrom (lo de antes ya estaba en el saldo).
export function expectedIncomes(f) {
  const from = localDate(countFrom(f)), to = monthStartStr(1);
  return f.incomes.filter(x => x.category_id).map(src => {
    const received = f.tx.filter(t => t.type === 'income' && t.category_id === src.category_id && t.occurred_on >= from && t.occurred_on < to)
      .reduce((s, t) => s + (Number(t.amount_cents) || 0), 0);
    const expected = expectedThisMonth(f, src);
    return { src, expected, received, left: Math.max(0, expected - received) };
  }).filter(x => x.expected > 0);
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

// ── Ingresos: periodo de cada fuente (semana lun–dom o mes) y lo recibido en él ──
export const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
export function incomePeriod(src) {
  const now = new Date(); now.setHours(0, 0, 0, 0);
  if (src.frequency === 'semanal') {
    const mon = new Date(now); mon.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    const next = new Date(mon); next.setDate(mon.getDate() + 7);
    return { from: localDate(mon), to: localDate(next), label: 'esta semana' };
  }
  return { from: monthStartStr(0), to: monthStartStr(1), label: `en ${monthName(0)}` };
}
export function incomeStatus(f, src) {
  const r = incomePeriod(src);
  const got = f.tx.filter(t => t.type === 'income' && src.category_id && t.category_id === src.category_id && t.occurred_on >= r.from && t.occurred_on < r.to);
  return { period: r, received: got.reduce((x, t) => x + (Number(t.amount_cents) || 0), 0), last: got[0] || null };
}
// Fechas de pago de una fuente en el mes actual, cada una marcada si ya la registraste.
// Los pagos registrados del mes se asignan en orden a las fechas (desde la fecha de tus saldos reales).
export function incomeSchedule(f, src) {
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const y = now.getFullYear(), m = now.getMonth(), len = new Date(y, m + 1, 0).getDate();
  let days = [];
  if (src.frequency === 'semanal' && src.pay_weekday !== null && src.pay_weekday !== undefined) {
    for (let d = 1; d <= len; d++) if (new Date(y, m, d).getDay() === Number(src.pay_weekday)) days.push(new Date(y, m, d));
  } else if ((src.frequency === 'mensual' || src.frequency === 'quincenal') && src.pay_day) {
    days = (src.frequency === 'mensual' ? [src.pay_day] : [src.pay_day, src.pay_day + 15]).filter(d => d <= len).map(d => new Date(y, m, d));
  }
  if (!days.length) return null;
  const st = startDate(f);
  const from = localDate(st && st > new Date(y, m, 1) ? st : new Date(y, m, 1));
  const got = src.category_id ? f.tx.filter(t => t.type === 'income' && t.category_id === src.category_id && t.occurred_on >= from && t.occurred_on < monthStartStr(1)).length : 0;
  let left = got;
  return days.map(d => {
    const before = localDate(d) < from; // ya estaba en tus saldos
    const done = !before && left > 0; if (done) left--;
    return { date: d, before, done, late: !before && !done && d < now };
  });
}
// Desglose del patrimonio: qué suma, qué resta y qué NO cuenta (dinero que cuidas o de otros).
export function netWorthParts(f) {
  const funds = f.positions.filter(p => !p.archived).reduce((x, p) => x + (positionValue(f, p) || 0), 0);
  let cuentas = 0, tarjetas = 0; const fuera = [];
  for (const a of bankAccounts(f)) {
    if (accPositions(f, a.id).length) continue;
    const b = accBalance(f, a.id), pct = ownedPct(a), mine = Math.round(b * pct / 100);
    if (a.kind === 'credit') tarjetas += mine; else cuentas += mine;
    if (pct < 100 && b) fuera.push({ name: pct === 0 ? a.name : `${a.name} (parte que no es tuya)`, v: b - mine });
  }
  let teDeben = 0, debes = 0;
  for (const l of activeAccounts(f).filter(isLoan)) { const o = loanOwed(f, l); if (o > 0) { if (l.kind === 'lent') teDeben += o; else debes += o; } }
  return { cuentas, funds, teDeben, tarjetas, debes, fuera };
}
// ── Metas con aportación mensual ─────────────────────
export const goalMonthly = g => Number(g.monthly_contribution_cents) || 0;
export function contributedThisMonth(f, g) {
  const ms = monthStartStr(0);
  return (f.contribs || []).filter(c => c.goal_id === g.id && c.month === ms).reduce((x, c) => x + (Number(c.amount_cents) || 0), 0);
}
// Meses que faltan para la fecha de la meta (null si no tiene fecha).
export function monthsLeft(g) {
  if (!g.due_date) return null;
  const d = new Date(g.due_date + 'T12:00:00'), n = new Date();
  return Math.max(0, (d.getFullYear() - n.getFullYear()) * 12 + d.getMonth() - n.getMonth());
}
// ── Inversiones: seguimiento por fondo y avisos (informativo, sin recomendaciones) ──
export function fundStats(f) {
  const funds = f.positions.filter(p => !p.archived);
  const total = funds.reduce((x, p) => x + (positionValue(f, p) || 0), 0);
  const cur = monthStartStr(0);
  return funds.map(p => {
    const hist = f.valuations.filter(v => v.position_id === p.id).sort((a, b) => a.month < b.month ? -1 : 1)
      .map(v => ({ month: v.month, value: Number(v.value_cents) || 0 }));
    const last = hist.at(-1), prev = hist.at(-2), back3 = hist.length > 3 ? hist.at(-4) : null;
    const cost = Number(p.cost_basis_cents) || 0, value = last ? last.value : 0;
    const pct = (a, b) => b ? (a - b) / b * 100 : null;
    let downs = 0; for (let i = hist.length - 1; i > 0 && hist[i].value < hist[i - 1].value; i--) downs++;
    return {
      p, hist, value, cost, share: total ? value / total * 100 : 0,
      m1: prev ? pct(value, prev.value) : null, m3: back3 ? pct(value, back3.value) : null,
      gain: value - cost, gainPct: pct(value, cost), downs, stale: !last || last.month < cur, lastMonth: last ? last.month : null
    };
  }).sort((a, b) => b.value - a.value);
}
// Avisos: caída fuerte en el mes, varios meses a la baja, mucha concentración, valores sin actualizar.
export function fundAlerts(rows) {
  const out = [];
  for (const r of rows) {
    const n = r.p.fund_name;
    if (r.m1 !== null && r.m1 <= -3) out.push({ level: 'aviso', text: `${n} bajó ${Math.abs(r.m1).toFixed(1)}% este mes.` });
    if (r.downs >= 3) out.push({ level: 'aviso', text: `${n} lleva ${r.downs} meses seguidos a la baja.` });
    if (r.cost && r.gainPct !== null && r.gainPct < 0) out.push({ level: 'aviso', text: `${n} vale menos de lo que se aportó (${r.gainPct.toFixed(1)}%).` });
    if (r.share >= 50) out.push({ level: 'info', text: `${n} es el ${r.share.toFixed(0)}% de tu portafolio.` });
  }
  if (rows.some(r => r.stale)) out.push({ level: 'info', text: 'Faltan los valores de este mes: toca "Actualizar valores".' });
  return out;
}

