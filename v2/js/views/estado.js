// Estado de cuenta con IA: subes el PDF, Claude extrae los movimientos y marca cuáles ya tenías;
// tú eliges cuáles registrar. Usa las mismas tablas (transactions) que el resto de Finanzas.
import { dbPost } from '../db.js?v=202611041208';
import { escapeHTML, localDate, showToast, openModal, closeModal } from '../util.js?v=202611041208';
import { ask, withBusy, aiLabel } from '../ia.js?v=202611041208';
import * as F from '../fin.js?v=202611041208';

const TYPE = { expense: 'Gasto', income: 'Ingreso', payment: 'Pago a tarjeta', transfer_out: 'Transferencia enviada', transfer_in: 'Transferencia recibida', fee: 'Comisión' };
const MATCH = { nuevo: 'Nuevo', ya_registrado: 'Ya lo tenías', posible_duplicado: '¿Duplicado?' };
const money = n => F.fmtMoney(Math.round(Number(n) * 100));

function readBase64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1] || '');
    r.onerror = () => rej(new Error('No pude leer el archivo'));
    r.readAsDataURL(file);
  });
}

export function openStatement(f, onDone) {
  const accs = F.bankAccounts(f).filter(a => a.kind !== 'investment');
  if (!accs.length) return showToast('Primero crea una cuenta', 'error');
  openModal('Estado de cuenta (PDF)', `
    <p class="small" style="margin:0">Claude lee el PDF, saca los movimientos y te dice cuáles ya tenías registrados. Tú eliges cuáles agregar.</p>
    <label class="flabel" for="stAcc">¿De qué cuenta es?</label>
    <select class="field" id="stAcc">${accs.map(a => `<option value="${escapeHTML(a.id)}">${escapeHTML(a.name)}${a.kind === 'credit' ? ' (crédito)' : ''}</option>`).join('')}</select>
    <label class="flabel" for="stFile">Archivo PDF</label>
    <input class="field" id="stFile" type="file" accept="application/pdf,.pdf" style="padding:10px;height:auto">
    <p class="small" style="margin:6px 0 0">Puede tardar hasta un minuto. El PDF solo se usa para esta lectura; no se guarda.</p>`,
    `<button type="button" class="btn-primary" id="stGo">${aiLabel('Analizar estado de cuenta')}</button>`);
  document.getElementById('stGo').onclick = async e => {
    const btn = e.currentTarget; // (después de un await, e.currentTarget ya es null)
    const file = document.getElementById('stFile').files[0];
    const accId = document.getElementById('stAcc').value;
    if (!file) return showToast('Elige el PDF', 'error');
    if (file.size > 10 * 1024 * 1024) return showToast('El PDF pesa más de 10 MB', 'error');
    const acc = f.accounts.find(a => a.id === accId);
    const since = (() => { const d = new Date(); d.setDate(d.getDate() - 100); return localDate(d); })();
    const existing = f.tx.filter(t => (t.account_id === accId || t.to_account_id === accId) && t.occurred_on >= since).slice(0, 400)
      .map(t => ({ fecha: t.occurred_on, monto: (Number(t.amount_cents) || 0) / 100, tipo: t.type, nota: t.note || '', categoria: F.catName(f, t.category_id) }));
    try {
      const pdf = await readBase64(file);
      const res = await withBusy(btn, 'Leyendo el PDF…', () => ask('estado', {
        pdf, account: `${acc.name} (${acc.kind === 'credit' ? 'tarjeta de crédito' : 'cuenta'})`,
        categories: F.activeCats(f, 'expense').map(c => c.name), incomeCategories: F.activeCats(f, 'income').map(c => c.name), existing
      }));
      showResults(f, acc, res, onDone);
    } catch (err) { showToast(err.message, 'error'); }
  };
}

function showResults(f, acc, res, onDone) {
  const txs = res.transactions || [];
  const catByName = name => F.activeCats(f).find(c => c.name.toLowerCase() === String(name || '').toLowerCase())?.id || '';
  const importable = t => ['expense', 'income', 'fee'].includes(t.type);
  const optionsFor = t => {
    const kind = t.type === 'income' ? 'income' : 'expense';
    const pre = catByName(t.category);
    return `<option value="">Sin categoría</option>${F.activeCats(f, kind).map(c => `<option value="${escapeHTML(c.id)}"${c.id === pre ? ' selected' : ''}>${escapeHTML(c.name)}</option>`).join('')}`;
  };
  const s = res.summary || {};
  openModal(`Estado de cuenta · ${acc.name}`, `
    <div class="stats3" style="border-top:none;padding-top:0">
      <div><span>Periodo</span><strong style="font-size:14px">${escapeHTML(res.period || '—')}</strong></div>
      <div><span>Gastos</span><strong>${money(s.total_expenses || 0)}</strong></div>
      <div><span>Ingresos</span><strong>${money(s.total_income || 0)}</strong></div>
    </div>
    ${(s.notes || []).length ? `<ul class="ai-assump">${s.notes.map(n => `<li>${escapeHTML(n)}</li>`).join('')}</ul>` : ''}
    <div class="card-head" style="margin-top:8px"><span class="flabel" style="margin:0">${txs.length} movimientos</span>
      <button type="button" class="btn-link" id="stAll">Seleccionar nuevos</button></div>
    <div class="st-list">${txs.map((t, i) => `<div class="st-row ${t.match}">
      <label class="st-check"><input type="checkbox" data-st="${i}"${importable(t) && t.match === 'nuevo' ? ' checked' : ''}${importable(t) ? '' : ' disabled'} aria-label="Registrar ${escapeHTML(t.description)}"></label>
      <div class="st-main"><span class="st-desc">${escapeHTML(t.description)}</span>
        <span class="task-meta">${escapeHTML(t.date)} · ${TYPE[t.type] || t.type} · <b class="st-match">${MATCH[t.match] || ''}</b>${t.matched_note ? ' · ' + escapeHTML(t.matched_note) : ''}</span>
        ${importable(t) ? `<label class="sr-only" for="stc${i}">Categoría</label><select class="field st-cat" id="stc${i}" data-stcat="${i}">${optionsFor(t)}</select>` : `<span class="small">${t.type === 'payment' ? 'Los pagos a tarjeta se registran como transferencia desde tu cuenta.' : 'Las transferencias entre tus cuentas regístralas en Movimientos.'}</span>`}
      </div>
      <span class="st-amt${t.type === 'income' ? ' pos' : ''}">${t.type === 'income' ? '+' : '−'}${money(t.amount)}</span>
    </div>`).join('') || '<div class="small">No encontré movimientos en el PDF.</div>'}</div>`,
    `<button type="button" class="btn-primary" id="stSave">Registrar seleccionados</button>`);
  const count = () => { const n = document.querySelectorAll('#modal [data-st]:checked').length; document.getElementById('stSave').textContent = n ? `Registrar ${n} seleccionado${n === 1 ? '' : 's'}` : 'Registrar seleccionados'; };
  document.querySelectorAll('#modal [data-st]').forEach(c => c.onchange = count); count();
  document.getElementById('stAll').onclick = () => { document.querySelectorAll('#modal [data-st]').forEach(c => { if (!c.disabled) c.checked = txs[Number(c.dataset.st)].match === 'nuevo'; }); count(); };
  document.getElementById('stSave').onclick = async e => {
    const picked = [...document.querySelectorAll('#modal [data-st]:checked')].map(c => Number(c.dataset.st));
    if (!picked.length) return showToast('No seleccionaste movimientos', 'error');
    const rows = picked.map(i => {
      const t = txs[i];
      return { type: t.type === 'income' ? 'income' : 'expense', amount_cents: Math.round(Number(t.amount) * 100), account_id: acc.id,
        to_account_id: null, category_id: document.querySelector(`#modal [data-stcat="${i}"]`)?.value || null, occurred_on: t.date, note: String(t.description).slice(0, 120) };
    }).filter(r => r.amount_cents > 0);
    try {
      const created = await withBusy(e.currentTarget, 'Guardando…', () => dbPost('transactions', rows));
      f.tx.push(...created);
      closeModal(); showToast(`${created.length} movimiento${created.length === 1 ? '' : 's'} registrado${created.length === 1 ? '' : 's'}`);
      onDone();
    } catch { showToast('No se pudieron registrar', 'error'); }
  };
}
