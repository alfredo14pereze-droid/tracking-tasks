// Rendimientos automáticos: un ingreso "Rendimiento · <mes>" por cuenta y mes, calculado día por día
// con la tasa anual de la cuenta (accounts.annual_rate_pct) desde accounts.yield_since.
// Dos formas de pago:
//  · Diario (Nu): se suma hasta ayer y el movimiento del mes se actualiza solo cada día.
//  · Día fijo (Plata, día 10): los intereses se acumulan del 10 al 9 y se abonan juntos el día 10
//    en un solo movimiento. Mientras tanto se muestran "por cobrar" y no entran al saldo.
// Si cambias el monto a mano (amount_cents ≠ auto_amount_cents), la app ya no lo vuelve a tocar.
import { dbPost, dbPatch } from './db.js?v=202611100956';
import { localDate } from './util.js?v=202611100956';
import * as F from './fin.js?v=202611100956';

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
export const yieldKey = (accId, ym) => `yield:${accId}:${ym}`;
const ymOf = d => d.slice(0, 7);
const lastDayOf = ym => { const [y, m] = ym.split('-').map(Number); return localDate(new Date(y, m, 0)); };
const nextYm = ym => { const [y, m] = ym.split('-').map(Number); return localDate(new Date(y, m, 1)).slice(0, 7); };
const addDay = s => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + 1); return localDate(d); };
const prevYm = ym => { const [y, m] = ym.split('-').map(Number); return localDate(new Date(y, m - 2, 1)).slice(0, 7); };
const dayIn = (ym, d) => `${ym}-${String(d).padStart(2, '0')}`;
const minusDay = s => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() - 1); return localDate(d); };

// Día del mes en que el banco abona los intereses (null = diario). Plata paga el 10.
export const payDay = acc => /plata/i.test(`${acc.institution || ''} ${acc.name || ''}`) ? 10 : null;

// Interés simple día por día entre from y to (incluidos), sobre el saldo de cada día.
function accrue(f, acc, from, to, skip = null) {
  const daily = Number(acc.annual_rate_pct) / 100 / 365;
  let sum = 0;
  for (let day = from; day <= to; day = addDay(day)) {
    const bal = F.balanceOn(f, acc.id, day, skip);
    if (bal > 0) sum += bal * daily;
  }
  return sum;
}

// Abono del día fijo del mes ym: cubre del día P del mes anterior al día P−1 de ym.
function payoutAmount(f, acc, ym, today) {
  const P = payDay(acc), since = acc.yield_since || today;
  const from = dayIn(prevYm(ym), P) > since ? dayIn(prevYm(ym), P) : since;
  return Math.round(accrue(f, acc, from, minusDay(dayIn(ym, P))));
}

// Lo que ya se generó y todavía no te pagan (solo cuentas con día fijo). { cents, payOn }.
export function pendingYield(f, acc, today = localDate()) {
  const P = payDay(acc);
  if (!P || !(Number(acc.annual_rate_pct) > 0)) return null;
  const ym = ymOf(today), payYm = today >= dayIn(ym, P) ? nextYm(ym) : ym;
  const since = acc.yield_since || today, start = dayIn(prevYm(payYm), P);
  const from = start > since ? start : since;
  return { cents: Math.round(accrue(f, acc, from, minusDay(today))), payOn: dayIn(payYm, P) };
}

// Cuentas que generan rendimiento: débito/ahorro/efectivo con tasa > 0 y sin fondos.
export const yieldAccounts = f => F.bankAccounts(f).filter(a =>
  ['debit', 'savings', 'cash'].includes(a.kind) && Number(a.annual_rate_pct) > 0 && !F.accPositions(f, a.id).length);

// Rendimiento estimado de un mes, en centavos. Interés diario sobre el saldo de cada día
// (incluye lo que ya va ganando ese mes) × tasa / 365.
export function monthYield(f, acc, ym, today = localDate()) {
  if (payDay(acc)) return today >= dayIn(ym, payDay(acc)) ? payoutAmount(f, acc, ym, today) : 0;
  const own = f.tx.find(t => t.auto_key === yieldKey(acc.id, ym));
  const since = acc.yield_since || today;
  const yesterday = (() => { const d = new Date(today + 'T12:00:00'); d.setDate(d.getDate() - 1); return localDate(d); })();
  let day = since > `${ym}-01` ? since : `${ym}-01`;
  const end = lastDayOf(ym) < yesterday ? lastDayOf(ym) : yesterday;
  const daily = Number(acc.annual_rate_pct) / 100 / 365;
  let acc_ = 0;
  for (; day <= end; day = addDay(day)) {
    const bal = F.balanceOn(f, acc.id, day, own) + acc_;
    if (bal > 0) acc_ += bal * daily;
  }
  return Math.round(acc_);
}

let running = false;
// Crea o actualiza los movimientos de rendimiento. Regresa true si cambió algo.
export async function syncYields(f) {
  if (running || !f.accounts.some(a => 'annual_rate_pct' in a)) return false; // falta el SQL
  running = true;
  let changed = false;
  try {
    const today = localDate(), curYm = ymOf(today);
    let cat = null;
    for (const acc of yieldAccounts(f)) {
      let ym = ymOf(acc.yield_since || today);
      for (let guard = 0; ym <= curYm && guard < 24; ym = nextYm(ym), guard++) {
        const key = yieldKey(acc.id, ym);
        const ex = f.tx.find(t => t.auto_key === key);
        if (ex && Number(ex.amount_cents) !== Number(ex.auto_amount_cents)) continue; // lo corregiste tú
        const P = payDay(acc);
        if (P && today < dayIn(ym, P)) continue; // aún no llega el día de pago
        const amount = monthYield(f, acc, ym, today);
        if (amount <= 0) continue;
        const occurred = P ? dayIn(ym, P) : ym === curYm ? today : lastDayOf(ym);
        if (ex) {
          if (Number(ex.amount_cents) === amount && ex.occurred_on === occurred) continue;
          const body = { amount_cents: amount, auto_amount_cents: amount, occurred_on: occurred };
          await dbPatch('transactions', body, `?id=eq.${ex.id}`);
          Object.assign(ex, body); changed = true;
        } else {
          if (!cat) cat = await ensureYieldCategory(f);
          const [row] = await dbPost('transactions', {
            type: 'income', amount_cents: amount, account_id: acc.id, to_account_id: null, category_id: cat.id,
            occurred_on: occurred, note: `Rendimiento · ${MONTHS[Number(ym.slice(5, 7)) - 1]}`,
            auto_key: key, auto_amount_cents: amount
          });
          f.tx.unshift(row); changed = true;
        }
      }
    }
  } catch (e) {
    console.warn('rendimientos', e); // p. ej. otra pestaña ya lo creó (índice único); se arregla al recargar
  } finally { running = false; }
  return changed;
}

async function ensureYieldCategory(f) {
  let c = f.categories.find(x => x.kind === 'income' && x.name.trim().toLowerCase() === 'rendimientos');
  if (c && c.archived) { await dbPatch('categories', { archived: false }, `?id=eq.${c.id}`); c.archived = false; }
  if (!c) { [c] = await dbPost('categories', { name: 'Rendimientos', kind: 'income' }); f.categories.push(c); }
  return c;
}
