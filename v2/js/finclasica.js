// GENERADO por build_finclasica.py desde clasica/index.html (sección FINANZAS). No editar a mano:
// cambia la clásica o el script y vuelve a generar. Es la misma lógica de la clásica (saldos, tarjetas,
// préstamos, fondos, recurrentes, revisión mensual, asistente) con un adaptador mínimo para la app nueva.
import { dbGet, dbPost, dbPatch, dbDelete } from './db.js?v=202611041029';
import { escapeHTML, localDate, showToast as toast } from './util.js?v=202611041029';

// ── Adaptador ──
let currentSection = 'finance', finView = 'home', currentView = 'today';
let mountEl = null;
const escapeAttr = s => escapeHTML(s || '').replace(/"/g, '&quot;');
function formatDate(s) { const d = new Date(s + 'T12:00:00'); return d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' }); }
const showToast = (msg, type) => toast(String(msg).replace(/<[^>]*>/g, ''), type === 'error' ? 'error' : 'info');
function renderContent() { if (mountEl && document.body.contains(mountEl)) renderFinance(mountEl); }
function setView() { location.hash = '#tareas'; }
function closeSidebar() {}
// Modales de finanzas (mismo markup que la clásica), dentro de .fc para sus estilos.
(() => {
  if (document.getElementById('finModal')) return;
  const wrap = document.createElement('div');
  wrap.className = 'fc fc-modals';
  wrap.innerHTML = `<div class="modal-overlay" id="finWizard">
  <div class="modal" style="max-width:580px">
    <div class="modal-header">
      <div style="min-width:0"><div class="wiz-steps" id="finWizStep"></div><h3 class="modal-title" id="finWizTitle"></h3></div>
      <button class="modal-close" type="button" id="finWizClose" aria-label="Cerrar (tu avance se guarda)" title="Cerrar (tu avance se guarda)">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
    <div class="modal-body" id="finWizBody"></div>
    <div class="modal-footer" id="finWizFooter"></div>
  </div>
</div>
<div class="modal-overlay" id="finModal">
  <div class="modal" style="max-width:460px">
    <div class="modal-header">
      <h3 class="modal-title" id="finModalTitle"></h3>
      <button class="modal-close" type="button" id="finModalClose" aria-label="Cerrar">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
    <div class="modal-body" id="finModalBody"></div>
    <div class="modal-footer" id="finModalFooter"></div>
  </div>
</div>
<button type="button" class="fin-fab" id="finFab" aria-label="Agregar movimiento">+</button>`;
  document.body.appendChild(wrap);
})();

// ── FINANZAS ─────────────────────────────────────────────────
// Montos en centavos (bigint). Saldo = inicial + ingresos − gastos − transf. salientes + transf. entrantes.
const fin = {accounts:[], categories:[], tx:[], budgets:[], goals:[], snapshots:[], positions:[], valuations:[], incomes:[], recurring:[], cards:[], assumptions:[], loaded:false, errors:[]};
let finFilterAcc = '', finFilterCat = '', finMonthOffset = 0, finShowArchived = false, finShowClosedLoans = false, finShowClosedAcc = false;
const FIN_TABS = {home:'Este mes', movs:'Movimientos', accounts:'Cuentas', patrimonio:'Patrimonio', recurrentes:'Recurrentes', loans:'Préstamos', budget:'Presupuesto', goals:'Metas', revision:'Revisión'};
const ACC_KIND = {debit:'Débito', credit:'Crédito', savings:'Ahorro', investment:'Inversión', cash:'Efectivo', lent:'Te deben', borrowed:'Debes'};
const TX_TYPES = {expense:'Gasto', income:'Ingreso', transfer:'Transferencia'};
const moneyFmt = new Intl.NumberFormat('es-MX',{style:'currency',currency:'MXN'});

function fmtMoney(c){ return moneyFmt.format((Number(c)||0)/100); }
// "1,234.5" → 123450. Devuelve null si no es un monto válido. Sin flotantes.
function parseCents(s){
  s = String(s||'').replace(/[\s$,]/g,'');
  if(!/^\d+(\.\d{0,2})?$/.test(s)) return null;
  const [i, f=''] = s.split('.');
  return Number(i)*100 + Number((f+'00').slice(0,2));
}
function centsToInput(c){ c = Math.abs(Number(c)||0); return Math.floor(c/100)+'.'+String(c%100).padStart(2,'0'); }
function monthStartStr(offset=0){ const d=new Date(); d.setDate(1); d.setMonth(d.getMonth()+offset); return localDate(d).slice(0,8)+'01'; }
function txInMonth(t, offset=0){ return t.occurred_on >= monthStartStr(offset) && t.occurred_on < monthStartStr(offset+1); }
function monthLabel(offset=0){
  const d=new Date(); d.setDate(1); d.setMonth(d.getMonth()+offset);
  const s=d.toLocaleDateString('es-MX',{month:'long',year:'numeric'});
  return s.charAt(0).toUpperCase()+s.slice(1);
}
function finDate(s){ const d=new Date(s+'T12:00:00'); return d.toLocaleDateString('es-MX',{day:'numeric',month:'short',year:'numeric'}); }
function accBalance(id){
  const a = fin.accounts.find(x=>x.id===id);
  let b = Number(a && a.opening_balance_cents)||0;
  for(const t of fin.tx){
    const amt = Number(t.amount_cents)||0;
    if(t.account_id===id) b += t.type==='income' ? amt : -amt; // gasto o transferencia saliente
    if(t.type==='transfer' && t.to_account_id===id) b += amt;
  }
  return b;
}
// Ahorro del mes = lo que entra a cuentas de ahorro/inversión desde otras cuentas − lo que sale de ellas.
// Movimientos entre NU y GBM no cuentan; rendimientos tampoco (no son aportación tuya).
function isSavingsAcc(id){ const a=fin.accounts.find(x=>x.id===id); return !!a && (a.kind==='savings' || a.kind==='investment'); }
function savedInMonth(offset=0){
  let s = 0;
  for(const t of fin.tx){
    if(t.type!=='transfer' || t.is_allocation || !txInMonth(t,offset)) continue;
    const from = isSavingsAcc(t.account_id), to = isSavingsAcc(t.to_account_id);
    if(to && !from) s += Number(t.amount_cents)||0;
    else if(from && !to) s -= Number(t.amount_cents)||0;
  }
  return s;
}
function receivedInMonth(catId, offset=0){ return fin.tx.filter(t=>t.type==='income' && t.category_id===catId && txInMonth(t,offset)).reduce((s,t)=>s+(Number(t.amount_cents)||0),0); }
function expectedIncomes(){
  const srcs = fin.incomes.filter(x=>x.active);
  if(srcs.length) return srcs.filter(x=>x.category_id).map(x=>({cat:{id:x.category_id, name:x.name}, source:x, expected:sourceMonthly(x,true), received:receivedInMonth(x.category_id)}));
  return activeCats('income').map(c=>{ const b=currentBudget(c.id); return b ? {cat:c, expected:Number(b.amount_cents)||0, received:receivedInMonth(c.id)} : null; }).filter(Boolean);
}
function savingsGoal(){ return activeCats('savings').reduce((s,c)=>{ const b=currentBudget(c.id); return s + (b ? Number(b.amount_cents)||0 : 0); }, 0); }
function savingsClass(pct){ return pct>=100 ? 'ok' : pct>=80 ? 'warn' : 'over'; }
function monthTotals(offset=0){
  let inc=0, exp=0;
  for(const t of fin.tx){
    if(!txInMonth(t,offset)) continue;
    if(t.type==='income') inc += Number(t.amount_cents)||0;
    else if(t.type==='expense') exp += Number(t.amount_cents)||0;
  }
  return {inc, exp};
}
function catName(id){ const c=fin.categories.find(x=>x.id===id); return c ? c.name : 'Sin categoría'; }
function accName(id){ const a=fin.accounts.find(x=>x.id===id); return a ? a.name : '—'; }
function isLoan(a){ return a && (a.kind==='lent' || a.kind==='borrowed'); }
function bankAccounts(){ return activeAccounts().filter(a=>!isLoan(a)); }
function accLabel(a){ return isLoan(a) ? `${a.name} (préstamo)` : a.name; }
function activeAccounts(){ return fin.accounts.filter(a=>!a.archived).sort((a,b)=>((a.sort_order||0)-(b.sort_order||0)) || a.name.localeCompare(b.name,'es')); }
function activeCats(kind){ return fin.categories.filter(c=>!c.archived && (!kind || c.kind===kind)).sort((a,b)=>a.name.localeCompare(b.name,'es')); }
function sortTx(){ fin.tx.sort((a,b)=> a.occurred_on<b.occurred_on ? 1 : a.occurred_on>b.occurred_on ? -1 : String(b.created_at||'').localeCompare(String(a.created_at||''))); }
// Presupuesto vigente: el del mes actual o, si no hay, el último que pusiste antes (se repite cada mes). 0 = sin presupuesto.
function currentBudget(catId){
  const ms = monthStartStr(0);
  const b = fin.budgets.filter(x=>x.category_id===catId && x.month<=ms).sort((a,c)=>a.month<c.month?1:-1)[0];
  return b && Number(b.amount_cents)>0 ? b : null;
}
function optionList(items, selected, labelFn){ return items.map(x=>`<option value="${escapeAttr(x.id)}" ${x.id===selected?'selected':''}>${escapeHTML(labelFn?labelFn(x):x.name)}</option>`).join(''); }

async function loadFinance(){
  const errs = [];
  const get = async (key, table, q)=>{ try{ fin[key] = await dbGet(table, q) || []; }catch(e){ errs.push(table); } };
  await Promise.all([
    get('accounts','accounts','?order=sort_order.asc,name.asc'),
    get('categories','categories','?order=name.asc'),
    get('tx','transactions','?order=occurred_on.desc,created_at.desc'),
    get('budgets','budgets','?order=month.desc'),
    get('goals','money_goals','?archived=eq.false&order=created_at.asc'),
    get('snapshots','balance_snapshots','?order=month.asc'),
    get('positions','investment_positions','?order=created_at.asc'),
    get('valuations','position_valuations','?order=month.asc'),
    get('incomes','income_sources','?order=created_at.asc'),
    get('recurring','recurring_items','?order=created_at.asc'),
    get('cards','card_settings',''),
    get('assumptions','assumptions',''),
  ]);
  fin.errors = errs; fin.loaded = true;
}

function syncSectionUI(){
  document.body.classList.toggle('section-finance', currentSection==='finance');
  document.querySelectorAll('[data-section]').forEach(b=>b.classList.toggle('active', b.dataset.section===currentSection));
  if(currentSection!=='finance') document.getElementById('finFab').classList.remove('show');
}
async function setSection(s){
  if(s===currentSection) return;
  window.scrollTo(0,0);
  if(s==='tasks'){ setView(currentView); return; } // setView regresa a Tareas en la vista que estaba abierta
  currentSection = 'finance'; syncSectionUI();
  if(window.innerWidth<768) closeSidebar();
  renderContent();
  await loadFinance();
  if(currentSection==='finance'){ renderContent(); maybeOpenWizard(); }
}
// (v2) selector Tareas/Finanzas de la clásica: no aplica
document.getElementById('finFab').addEventListener('click', ()=>openTxModal());

function renderFinance(el){
  document.getElementById('viewTitle').textContent = finView==='home' ? 'Finanzas' : FIN_TABS[finView];
  const tabs = `<div class="fin-tabs">${Object.entries(FIN_TABS).map(([k,v])=>`<button type="button" class="filter-chip ${k===finView?'active':''}" data-fin-view="${k}">${v}</button>`).join('')}<button type="button" class="filter-chip" id="finSetupBtn" title="Asistente de configuración">⚙ Configurar</button></div>`;
  let body;
  if(!fin.loaded) body = `<div class="loading"><div class="spinner"></div><p>Cargando finanzas...</p></div>`;
  else{
    const warn = fin.errors.length ? `<div class="fin-warn">No se pudo cargar: ${escapeHTML(fin.errors.join(', '))}. Revisa tu conexión y vuelve a abrir Finanzas. Tus tareas no se ven afectadas.</div>` : '';
    body = warn + ({home:finHomeHTML, movs:finMovsHTML, accounts:finAccountsHTML, patrimonio:finPatrimonioHTML, recurrentes:finRecurrentesHTML, revision:finRevisionHTML, loans:finLoansHTML, budget:finBudgetHTML, goals:finGoalsHTML}[finView])();
  }
  el.innerHTML = tabs + body;
  el.querySelectorAll('[data-fin-view]').forEach(b=>b.onclick=()=>{ finView=b.dataset.finView; renderContent(); });
  el.querySelector('#finSetupBtn').onclick = ()=>openWizard();
  document.getElementById('finFab').classList.toggle('show', fin.loaded && (finView==='home' || finView==='movs'));
  if(fin.loaded) bindFinance(el);
}

function txRowHTML(t){
  const amt = Number(t.amount_cents)||0;
  let title, sub, sign = '';
  if(t.type==='transfer'){ title=t.is_allocation?'Reparto de ahorro':'Transferencia'; sub=`${escapeHTML(accName(t.account_id))} → ${escapeHTML(accName(t.to_account_id))}`; }
  else{ title=escapeHTML(catName(t.category_id)); sub=escapeHTML(accName(t.account_id)); sign = t.type==='income' ? '+' : '−'; }
  return `<div class="fin-tx" data-tx="${escapeAttr(t.id)}">
    <div class="fin-tx-main">
      <div class="fin-tx-title">${title}</div>
      <div class="fin-tx-sub">${sub} · ${escapeHTML(formatDate(t.occurred_on))}</div>
      ${t.note ? `<div class="fin-tx-note">${escapeHTML(t.note)}</div>` : ''}
    </div>
    <div class="fin-tx-amt ${escapeAttr(t.type)}">${sign}${fmtMoney(amt)}</div>
  </div>`;
}

// a) Hoy
function finHomeHTML(){
  const {inc, exp} = monthTotals(0);
  const left = inc - exp;
  const last = fin.tx.slice(0,5);
  const three = !!savingsCardHTML();
  const incomes = expectedIncomes();
  const pendingIncome = incomes.reduce((s,x)=>s+Math.max(0, x.expected-x.received),0);
  const incomeHTML = incomes.length ? `<div class="task-group-label fin-section-label"><span>Ingresos del mes</span></div>
    <div class="fin-list">${incomes.map(x=>{
      const rem = x.expected - x.received;
      return `<div class="fin-tx" style="cursor:default">
        <div class="fin-tx-main"><div class="fin-tx-title">${escapeHTML(x.cat.name)}</div>
          <div class="fin-tx-sub">${rem>0 ? (x.received>0 ? `Recibido ${fmtMoney(x.received)} · faltan ${fmtMoney(rem)}` : `Esperado ${fmtMoney(x.expected)}`) : `✓ Recibido ${fmtMoney(x.received)}`}</div></div>
        ${rem>0 ? `<button type="button" class="btn btn-primary fin-small-btn" data-income-receive="${escapeAttr(x.cat.id)}">Ya lo recibí</button>` : '<span class="fin-tx-amt income">✓</span>'}
      </div>`;
    }).join('')}</div>` : '';
  return `${alertsHTML()}<div class="fin-cards${three?' three':''}">
      <div class="fin-card fin-card-hero">
        <div class="fin-label">Te queda este mes</div>
        <div class="fin-big ${left<0?'neg':'pos'}">${fmtMoney(left)}</div>
        <div class="fin-sub">Ingresos ${fmtMoney(inc)} − gastos ${fmtMoney(exp)}</div>
        ${pendingIncome>0 ? `<div class="fin-sub">Por recibir: ${fmtMoney(pendingIncome)}</div>` : ''}
      </div>
      <div class="fin-card">
        <div class="fin-label">Gastos del mes</div>
        <div class="fin-big">${fmtMoney(exp)}</div>
        <div class="fin-sub">${escapeHTML(monthLabel(0))}</div>
      </div>
      ${savingsCardHTML()}
    </div>
    ${homeExtraHTML()}
    ${incomeHTML}
    <div class="task-group-label fin-section-label"><span>Últimos movimientos</span>${fin.tx.length>5?'<button type="button" class="btn btn-ghost fin-small-btn" data-fin-goto="movs">Ver todos</button>':''}</div>
    <div class="fin-list">${last.length ? last.map(txRowHTML).join('') : '<div class="empty"><p>Aún no hay movimientos. Usa el botón + para agregar el primero.</p></div>'}</div>`;
}

function savingsCardHTML(){
  const goal = savingsGoal(), saved = savedInMonth(0);
  if(!goal && !saved) return '';
  const pct = goal>0 ? saved*100/goal : 0;
  return `<div class="fin-card">
    <div class="fin-label">Ahorrado este mes</div>
    <div class="fin-big ${goal>0&&pct>=100?'pos':''}">${fmtMoney(saved)}</div>
    ${goal>0 ? `<div class="fin-bar"><div class="${savingsClass(pct)}" style="width:${Math.max(0,Math.min(100,pct)).toFixed(1)}%"></div></div>
      <div class="fin-sub">${pct>=100?'¡Meta cumplida! ':''}Meta ${fmtMoney(goal)} (${Math.round(pct)}%)</div>` : '<div class="fin-sub">Sin meta de ahorro</div>'}
  </div>`;
}

// b) Movimientos
function finMovsHTML(){
  let list = fin.tx.filter(t=>txInMonth(t, finMonthOffset));
  if(finFilterAcc) list = list.filter(t=>t.account_id===finFilterAcc || t.to_account_id===finFilterAcc);
  if(finFilterCat) list = list.filter(t=>t.category_id===finFilterCat);
  const {inc, exp} = monthTotals(finMonthOffset);
  const cats = fin.categories.filter(c=>!c.archived || c.id===finFilterCat).sort((a,b)=>a.name.localeCompare(b.name,'es'));
  return `<div class="fin-month-nav">
      <button type="button" class="btn btn-ghost" data-fin-month="-1" aria-label="Mes anterior">‹</button>
      <span>${escapeHTML(monthLabel(finMonthOffset))}</span>
      <button type="button" class="btn btn-ghost" data-fin-month="1" aria-label="Mes siguiente" ${finMonthOffset>=0?'disabled':''}>›</button>
    </div>
    <div class="fin-month-sum" style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap"><span>Ingresos ${fmtMoney(inc)} · Gastos ${fmtMoney(exp)}</span><button type="button" class="btn btn-ghost fin-small-btn" id="finExportMovs">Exportar CSV</button></div>
    <div class="fin-filters">
      <select class="form-input form-select fin-field" id="finFilterAcc" aria-label="Filtrar por cuenta"><option value="">Cuentas</option>${optionList(fin.accounts, finFilterAcc)}</select>
      <select class="form-input form-select fin-field" id="finFilterCat" aria-label="Filtrar por categoría"><option value="">Categorías</option>${optionList(cats, finFilterCat)}</select>
    </div>
    <div class="fin-list">${list.length ? list.map(txRowHTML).join('') : '<div class="empty"><p>Sin movimientos con estos filtros.</p></div>'}</div>`;
}

// c) Cuentas
function finAccountsHTML(){
  const accs = bankAccounts();
  if(!accs.length) return '<div class="empty"><p>No hay cuentas.</p></div>';
  const loans = activeAccounts().filter(isLoan);
  let owedToMe = 0, iOwe = 0;
  loans.forEach(l=>{ const st=loanStats(l); if(l.kind==='lent') owedToMe+=st.owed; else iOwe+=st.owed; });
  const loanLine = loans.length ? `<div class="fin-month-sum">Préstamos: te deben ${fmtMoney(owedToMe)} · debes ${fmtMoney(iOwe)} <button type="button" class="btn btn-ghost fin-small-btn" data-fin-goto-loans>Ver</button></div>` : '';
  return loanLine + `<div class="fin-acc-grid">${accs.map(a=>{
    const bal = accountValue(a.id);
    const isCredit = a.kind==='credit';
    let main;
    if(isCredit){
      const debt = -bal;
      main = debt>0
        ? `<div class="fin-big neg">${fmtMoney(debt)}</div><span class="fin-debt-tag">Deuda</span>`
        : `<div class="fin-big">${fmtMoney(-debt)}</div><div class="fin-sub">${debt<0?'Saldo a favor':'Sin deuda'}</div>`;
    } else main = `<div class="fin-big ${bal<0?'neg':''}">${fmtMoney(bal)}</div>`;
    const opening = Number(a.opening_balance_cents)||0;
    let hist = '';
    if(a.kind==='investment'){
      const rows = snapshotRows(a.id);
      const last = rows[rows.length-1];
      const total = rows.reduce((s,r)=>s+(r.gain===null?0:r.gain),0);
      hist = `${last ? `<div class="fin-sub">Último corte (${escapeHTML(monthName(last.month))}): ${fmtMoney(last.balance_cents)} · rendimiento acumulado <span style="color:${total<0?'var(--red)':'var(--green)'}">${fmtMoney(total)}</span></div>` : ''}
        <button type="button" class="btn btn-ghost fin-small-btn" data-acc-history="${escapeAttr(a.id)}">Historial mensual${rows.length?` (${rows.length})`:''}</button>`;
    }
    return `<div class="fin-card fin-acc">
      <div class="fin-acc-head"><div class="fin-acc-name">${escapeHTML(a.name)}</div><span style="display:flex;align-items:center;gap:2px;flex-shrink:0"><span class="fin-kind">${escapeHTML(ACC_KIND[a.kind]||a.kind)}</span><button type="button" class="fin-icon-btn" data-acc-edit="${escapeAttr(a.id)}" title="Editar cuenta" aria-label="Editar cuenta"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/></svg></button></span></div>
      ${a.institution ? `<div class="fin-sub">${escapeHTML(a.institution)}</div>` : ''}
      ${main}
      ${a.kind==='credit' ? cardInfoHTML(a) : ''}
      <div class="fin-acc-actions">
        <button type="button" class="btn btn-ghost fin-small-btn" data-fin-opening="${escapeAttr(a.id)}">${isCredit?'Deuda inicial':'Saldo inicial'}: ${fmtMoney(isCredit?-opening:opening)}</button>
        ${hist}
        ${a.kind==='credit' && cardFor(a.id) ? `<button type="button" class="btn btn-ghost fin-small-btn" data-card-edit="${escapeAttr(a.id)}">Límite y fechas</button>` : ''}
      </div>
    </div>`;
  }).join('')}</div>${closedAccountsHTML()}
    <div style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" class="btn btn-ghost fin-add-btn" id="finNewAcc">+ Nueva cuenta</button><button type="button" class="btn btn-ghost fin-add-btn" data-fin-allocate>Repartir ahorros</button></div>`;
}
function closedAccountsHTML(){
  const closed = fin.accounts.filter(a=>a.archived && !isLoan(a));
  if(!closed.length) return '';
  return `<div class="task-group-label fin-section-label"><span>Archivadas (${closed.length})</span><button type="button" class="btn btn-ghost fin-small-btn" id="finToggleClosedAcc">${finShowClosedAcc?'Ocultar':'Ver'}</button></div>
    ${finShowClosedAcc ? `<div class="fin-list">${closed.map(a=>`<div class="fin-budget-row"><div class="fin-budget-top"><div class="fin-budget-name">${escapeHTML(a.name)} <span class="fin-kind">${escapeHTML(ACC_KIND[a.kind]||a.kind)}</span></div><span class="fin-budget-txt" style="margin:0">${fmtMoney(accBalance(a.id))}</span><button type="button" class="fin-icon-btn" data-acc-restore="${escapeAttr(a.id)}">Restaurar</button></div></div>`).join('')}</div>` : ''}`;
}
const NEW_ACC_KINDS = ['savings','debit','investment','cash','credit'];
function openAccountModal(id){
  const a = id ? fin.accounts.find(x=>x.id===id) : null;
  if(id && !a) return;
  const kindOpts = NEW_ACC_KINDS.map(k=>`<option value="${k}" ${(a?a.kind:'savings')===k?'selected':''}>${ACC_KIND[k]}</option>`).join('');
  const hasTx = a && fin.tx.some(t=>t.account_id===a.id || t.to_account_id===a.id);
  const body = `
    <div class="form-group"><label class="form-label" for="accName">Nombre</label>
      <input class="form-input" id="accName" maxlength="40" autocomplete="off" style="font-size:16px" placeholder="Ej. Viaje" value="${escapeAttr(a?a.name:'')}"></div>
    <div class="form-row">
      <div class="form-group"><label class="form-label" for="accKind">Tipo</label>
        <select class="form-input form-select fin-field" id="accKind" ${hasTx?'disabled':''}>${kindOpts}</select></div>
      <div class="form-group"><label class="form-label" for="accInst">Banco (opcional)</label>
        <input class="form-input" id="accInst" maxlength="40" autocomplete="off" style="font-size:16px" placeholder="Ej. NU" value="${escapeAttr(a&&a.institution||'')}"></div>
    </div>
    ${a ? (hasTx ? '<div class="fin-hint">El tipo no se puede cambiar porque la cuenta ya tiene movimientos.</div>' : '') : `
    <div class="form-group" style="margin-bottom:0"><label class="form-label" for="accOpen">Saldo actual (opcional)</label>
      <input class="form-input fin-money" id="accOpen" inputmode="decimal" autocomplete="off" placeholder="0.00">
      <div class="fin-hint">Si es una cuenta nueva sin dinero, déjalo vacío y aparta dinero con una transferencia desde Plata.</div></div>`}`;
  const footer = `${a?'<button type="button" class="btn btn-ghost fin-modal-del" id="accArchive">Archivar</button>':''}<button type="button" class="btn btn-primary" id="accSave">Guardar</button>`;
  openFinModal(a ? 'Editar cuenta' : 'Nueva cuenta', body, footer);
  if(!a) setTimeout(()=>document.getElementById('accName').focus(), 50);
  document.getElementById('accSave').onclick = async ()=>{
    const name = finVal('accName');
    if(!name){ showToast('Escribe un nombre','error'); return; }
    const kind = finVal('accKind');
    const payload = {name, institution: finVal('accInst') || null};
    if(!hasTx) payload.kind = kind;
    try{
      if(a){ await dbPatch('accounts', payload, `?id=eq.${a.id}`); Object.assign(a, payload); }
      else{
        const raw = finVal('accOpen');
        const c = raw==='' ? 0 : parseCents(raw);
        if(c===null){ showToast('Revisa el saldo','error'); return; }
        payload.opening_balance_cents = kind==='credit' ? -c : c;
        payload.sort_order = 50;
        const [row] = await dbPost('accounts', payload); fin.accounts.push(row);
      }
      closeFinModal(); renderContent(); showToast('Cuenta guardada','success');
    }catch(e){ showToast('No se pudo guardar: '+finErr(e),'error'); }
  };
  if(a) document.getElementById('accArchive').onclick = ()=>{
    const bal = accBalance(a.id);
    if(bal!==0 && !confirm(`"${a.name}" todavía tiene ${fmtMoney(bal)}. ¿Archivarla de todos modos? Su saldo deja de verse en Cuentas.`)) return;
    closeFinModal(); setAccountArchived(a.id, true);
  };
}
async function setAccountArchived(id, archived){
  const a = fin.accounts.find(x=>x.id===id); if(!a) return;
  try{ await dbPatch('accounts', {archived}, `?id=eq.${id}`); a.archived = archived; renderContent(); showToast(archived?`"${a.name}" archivada`:`"${a.name}" restaurada`,'success'); }
  catch(e){ showToast('No se pudo actualizar: '+finErr(e),'error'); }
}

// Historial mensual (inversiones): rendimiento = valor − valor anterior − depósitos netos del mes
function monthName(m){ const d=new Date(m.slice(0,7)+'-15T12:00:00'); const s=d.toLocaleDateString('es-MX',{month:'short',year:'numeric'}); return s.charAt(0).toUpperCase()+s.slice(1); }
function snapshotRows(accId){
  const rows = fin.snapshots.filter(x=>x.account_id===accId).sort((a,b)=>a.month<b.month?-1:1);
  return rows.map((r,i)=>{
    const prev = rows[i-1];
    const gain = prev ? Number(r.balance_cents) - Number(prev.balance_cents) - (Number(r.net_deposits_cents)||0) : null;
    return {...r, gain};
  });
}
function parseSignedCents(s){ s=String(s||'').trim(); const neg=s.startsWith('-'); const c=parseCents(neg?s.slice(1):s); return c===null?null:(neg?-c:c); }
function openHistoryModal(accId, editId){
  const a = fin.accounts.find(x=>x.id===accId); if(!a) return;
  const rows = snapshotRows(accId);
  const ed = editId ? rows.find(r=>r.id===editId) : null;
  const table = rows.length ? `<div class="fin-list" style="margin-top:16px">${rows.slice().reverse().map(r=>`
      <div class="fin-tx" data-snap="${escapeAttr(r.id)}">
        <div class="fin-tx-main"><div class="fin-tx-title">${escapeHTML(monthName(r.month))}</div>
          <div class="fin-tx-sub">Depósitos netos ${fmtMoney(r.net_deposits_cents)}</div></div>
        <div style="text-align:right;flex-shrink:0"><div class="fin-tx-amt">${fmtMoney(r.balance_cents)}</div>
          <div class="fin-tx-sub" style="color:${r.gain===null?'var(--text3)':r.gain<0?'var(--red)':'var(--green)'}">${r.gain===null?'—':(r.gain<0?'':'+')+fmtMoney(r.gain)}</div></div>
      </div>`).join('')}</div>` : '<div class="fin-hint" style="margin-top:12px">Aún no hay meses capturados.</div>';
  const body = `
    <div class="form-row">
      <div class="form-group"><label class="form-label" for="snapMonth">Mes</label>
        <input type="month" class="form-input fin-money" id="snapMonth" value="${escapeAttr(ed?ed.month.slice(0,7):monthStartStr(-1).slice(0,7))}"></div>
      <div class="form-group"><label class="form-label" for="snapValue">Valor al cierre</label>
        <input class="form-input fin-money" id="snapValue" inputmode="decimal" autocomplete="off" placeholder="0.00" value="${ed?centsToInput(ed.balance_cents):''}"></div>
    </div>
    <div class="form-group" style="margin-bottom:0"><label class="form-label" for="snapDeposits">Depósitos netos del mes (retiros en negativo)</label>
      <input class="form-input fin-money" id="snapDeposits" inputmode="text" autocomplete="off" placeholder="0.00" value="${ed&&Number(ed.net_deposits_cents)?(Number(ed.net_deposits_cents)<0?'-':'')+centsToInput(ed.net_deposits_cents):''}">
      <div class="fin-hint">Rendimiento del mes = valor − valor del mes anterior − depósitos netos.</div></div>
    ${table}`;
  const footer = `${ed?'<button type="button" class="btn btn-ghost fin-modal-del" id="snapDelete">Eliminar mes</button>':''}<button type="button" class="btn btn-primary" id="snapSave">${ed?'Guardar cambios':'Agregar mes'}</button>`;
  openFinModal(`Historial · ${a.name}`, body, footer);
  document.querySelectorAll('[data-snap]').forEach(r=>r.onclick=()=>openHistoryModal(accId, r.dataset.snap));
  document.getElementById('snapSave').onclick = async ()=>{
    const m = finVal('snapMonth');
    const value = parseCents(finVal('snapValue'));
    const depRaw = finVal('snapDeposits');
    const dep = depRaw==='' ? 0 : parseSignedCents(depRaw);
    if(!/^\d{4}-\d{2}$/.test(m)){ showToast('Elige el mes','error'); return; }
    if(value===null){ showToast('Escribe el valor al cierre','error'); return; }
    if(dep===null){ showToast('Revisa los depósitos','error'); return; }
    const month = m+'-01';
    const payload = {account_id:accId, month, balance_cents:value, net_deposits_cents:dep};
    const existing = fin.snapshots.find(x=>x.account_id===accId && x.month===month && (!ed || x.id!==ed.id));
    if(existing && !confirm(`Ya hay un valor para ${monthName(month)}. ¿Reemplazarlo?`)) return;
    try{
      const target = (ed && fin.snapshots.find(x=>x.id===ed.id)) || existing;
      if(target){ const [row] = await dbPatch('balance_snapshots', payload, `?id=eq.${target.id}`); Object.assign(target, row||payload); }
      else { const [row] = await dbPost('balance_snapshots', payload); fin.snapshots.push(row); }
      openHistoryModal(accId); renderContent(); showToast('Mes guardado','success');
    }catch(e){ showToast('No se pudo guardar: '+finErr(e),'error'); }
  };
  if(ed) document.getElementById('snapDelete').onclick = async ()=>{
    if(!confirm(`¿Eliminar ${monthName(ed.month)} del historial?`)) return;
    try{ await dbDelete('balance_snapshots', `?id=eq.${ed.id}`); fin.snapshots = fin.snapshots.filter(x=>x.id!==ed.id); openHistoryModal(accId); renderContent(); }
    catch(e){ showToast('No se pudo eliminar: '+finErr(e),'error'); }
  };
}

// Préstamos: cada préstamo es una cuenta especial ('lent' = te deben, 'borrowed' = debes).
// Prestar / recibir / abonar = transferencias entre tu cuenta y la del préstamo, así no cuentan como gasto.
function loanStats(a){
  const opening = Number(a.opening_balance_cents)||0;
  let tin=0, tout=0, inc=0, exp=0;
  for(const t of fin.tx){
    const amt = Number(t.amount_cents)||0;
    if(t.account_id===a.id){ if(t.type==='transfer') tout+=amt; else if(t.type==='income') inc+=amt; else exp+=amt; }
    if(t.type==='transfer' && t.to_account_id===a.id) tin+=amt;
  }
  const bal = opening + tin + inc - tout - exp;
  if(a.kind==='lent') return {principal: Math.max(0,opening)+tin, paid: tout, forgiven: exp, owed: bal};
  return {principal: Math.max(0,-opening)+tout, paid: tin, forgiven: inc, owed: -bal};
}
function loanCardHTML(a){
  const st = loanStats(a);
  const lent = a.kind==='lent';
  const pct = st.principal>0 ? Math.min(100, (st.paid+st.forgiven)*100/st.principal) : 0;
  const lines = [];
  if(a.due_date && st.owed>0){
    const m = monthsUntil(a.due_date);
    const late = a.due_date < localDate() && st.owed>0;
    lines.push(`<span class="${late?'warn':''}">Fecha para pagar: ${escapeHTML(finDate(a.due_date))}${late?' · vencido':m>0?` · faltan ${m} ${m===1?'mes':'meses'}`:''}</span>`);
  }
  if(st.forgiven>0) lines.push(`${lent?'Perdonado':'Te condonaron'}: ${fmtMoney(st.forgiven)}`);
  if(a.note) lines.push(escapeHTML(a.note));
  return `<div class="fin-card">
    <div class="fin-acc-head"><div class="fin-acc-name">${escapeHTML(a.name)}</div><span class="fin-kind">${lent?'Te debe':'Le debes'}</span></div>
    <div class="fin-big ${st.owed>0?(lent?'':'neg'):'pos'}">${fmtMoney(Math.max(0,st.owed))}</div>
    <div class="fin-bar"><div class="${st.owed<=0?'ok':'goal'}" style="width:${pct.toFixed(1)}%"></div></div>
    <div class="fin-budget-txt">${lent?'Te ha pagado':'Has pagado'} ${fmtMoney(st.paid)} de ${fmtMoney(st.principal)}</div>
    ${lines.length?`<div class="fin-goal-lines">${lines.map(l=>`<div>${l}</div>`).join('')}</div>`:''}
    <div class="fin-acc-actions">
      ${a.archived
        ? `<button type="button" class="btn btn-ghost fin-small-btn" data-loan-reopen="${escapeAttr(a.id)}">Reabrir</button>`
        : `${st.owed>0?`<button type="button" class="btn btn-primary fin-small-btn" data-loan-pay="${escapeAttr(a.id)}">Registrar abono</button>`:`<button type="button" class="btn btn-primary fin-small-btn" data-loan-close="${escapeAttr(a.id)}">Marcar liquidado</button>`}
           <button type="button" class="btn btn-ghost fin-small-btn" data-loan-edit="${escapeAttr(a.id)}">Editar</button>`}
    </div>
  </div>`;
}
function finLoansHTML(){
  const open = activeAccounts().filter(isLoan);
  const closed = fin.accounts.filter(a=>isLoan(a) && a.archived);
  const group = (kind, title)=>{
    const list = open.filter(a=>a.kind===kind);
    if(!list.length) return '';
    const total = list.reduce((s,a)=>s+Math.max(0,loanStats(a).owed),0);
    return `<div class="task-group-label fin-section-label"><span>${title}</span><span>${fmtMoney(total)}</span></div>
      <div class="fin-acc-grid">${list.map(loanCardHTML).join('')}</div>`;
  };
  const body = group('lent','Te deben') + group('borrowed','Debes');
  const closedHTML = closed.length ? `<div class="task-group-label fin-section-label"><span>Liquidados (${closed.length})</span><button type="button" class="btn btn-ghost fin-small-btn" id="finToggleLoans">${finShowClosedLoans?'Ocultar':'Ver'}</button></div>
    ${finShowClosedLoans?`<div class="fin-acc-grid">${closed.map(loanCardHTML).join('')}</div>`:''}` : '';
  return (body || '<div class="empty"><p>No tienes préstamos activos.</p></div>') + closedHTML +
    `<button type="button" class="btn btn-ghost fin-add-btn" id="finNewLoan">+ Nuevo préstamo</button>`;
}
function openLoanModal(){
  let kind = 'lent';
  const body = `
    <div class="fin-type-btns" style="grid-template-columns:repeat(2,minmax(0,1fr))">
      <button type="button" class="fin-type-btn income" data-lk="lent">Yo presté</button>
      <button type="button" class="fin-type-btn expense" data-lk="borrowed">Me prestaron</button>
    </div>
    <div class="form-group"><label class="form-label" for="loanName" id="loanNameLabel">¿A quién?</label>
      <input class="form-input" id="loanName" maxlength="40" autocomplete="off" style="font-size:16px" placeholder="Ej. Mamá"></div>
    <div class="form-row">
      <div class="form-group"><label class="form-label" for="loanAmount">Monto</label>
        <input class="form-input fin-money" id="loanAmount" inputmode="decimal" autocomplete="off" placeholder="0.00"></div>
      <div class="form-group"><label class="form-label" for="loanDate">Fecha</label>
        <input type="date" class="form-input" id="loanDate" value="${localDate()}"></div>
    </div>
    <div class="form-group"><label class="form-label" for="loanAccount" id="loanAccLabel">¿De qué cuenta salió?</label>
      <select class="form-input form-select fin-field" id="loanAccount">${optionList(bankAccounts(), (bankAccounts().find(a=>a.kind==='debit')||{}).id)}<option value="">Ya está descontado de mis saldos (solo registrar)</option></select>
      <div class="fin-hint" id="loanAccHint"></div></div>
    <div class="form-row">
      <div class="form-group"><label class="form-label" for="loanDue">Fecha para pagar (opcional)</label>
        <input type="date" class="form-input" id="loanDue"></div>
      <div class="form-group"><label class="form-label" for="loanNote">Nota (opcional)</label>
        <input class="form-input" id="loanNote" maxlength="120" autocomplete="off" style="font-size:16px"></div>
    </div>`;
  openFinModal('Nuevo préstamo', body, `<button type="button" class="btn btn-primary" id="loanSave">Guardar</button>`);
  const sync = ()=>{
    document.querySelectorAll('[data-lk]').forEach(b=>b.classList.toggle('active', b.dataset.lk===kind));
    const lent = kind==='lent';
    document.getElementById('loanNameLabel').textContent = lent ? '¿A quién le prestaste?' : '¿Quién te prestó?';
    document.getElementById('loanAccLabel').textContent = lent ? '¿De qué cuenta salió?' : '¿A qué cuenta llegó?';
    const opt = document.querySelector('#loanAccount option[value=""]');
    opt.textContent = lent ? 'Ya está descontado de mis saldos (solo registrar)' : 'Ya está sumado en mis saldos (solo registrar)';
    document.getElementById('loanAccHint').textContent = lent
      ? 'Si eliges una cuenta, se le resta el monto. Si ya capturaste el saldo actual sin ese dinero, elige "solo registrar".'
      : 'Si eliges una cuenta, se le suma el monto. Si ya capturaste el saldo actual con ese dinero, elige "solo registrar".';
  };
  document.querySelectorAll('[data-lk]').forEach(b=>b.onclick=()=>{ kind=b.dataset.lk; sync(); });
  sync();
  setTimeout(()=>document.getElementById('loanName').focus(), 50);
  document.getElementById('loanSave').onclick = async ()=>{
    const name = finVal('loanName');
    const amount = parseCents(finVal('loanAmount'));
    const date = finVal('loanDate');
    const acc = finVal('loanAccount');
    if(!name){ showToast('Escribe el nombre','error'); return; }
    if(!amount){ showToast('Escribe un monto válido','error'); return; }
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date)){ showToast('Elige la fecha','error'); return; }
    const lent = kind==='lent';
    const btn = document.getElementById('loanSave'); btn.disabled = true;
    let loan;
    try{
      [loan] = await dbPost('accounts', {name, kind, opening_balance_cents: acc ? 0 : (lent ? amount : -amount), due_date: finVal('loanDue') || null, note: finVal('loanNote') || null, sort_order: 100});
      fin.accounts.push(loan);
      if(acc){
        const tx = {type:'transfer', amount_cents:amount, occurred_on:date, note:`Préstamo · ${name}`, category_id:null,
          account_id: lent ? acc : loan.id, to_account_id: lent ? loan.id : acc};
        const [row] = await dbPost('transactions', tx); fin.tx.push(row); sortTx();
      }
      closeFinModal(); finView='loans'; renderContent(); showToast('Préstamo registrado','success');
    }catch(e){
      if(loan){ try{ await dbDelete('accounts', `?id=eq.${loan.id}`); }catch(_){} fin.accounts = fin.accounts.filter(a=>a!==loan); }
      btn.disabled = false; showToast('No se pudo guardar: '+finErr(e),'error');
    }
  };
}
function openLoanPaymentModal(id){
  const a = fin.accounts.find(x=>x.id===id); if(!a) return;
  const lent = a.kind==='lent';
  const st = loanStats(a);
  openFinModal(`Abono · ${a.name}`, `
    <div class="fin-hint" style="margin:0 0 14px">Falta: ${fmtMoney(st.owed)}</div>
    <div class="form-row">
      <div class="form-group"><label class="form-label" for="payAmount">Monto</label>
        <input class="form-input fin-money" id="payAmount" inputmode="decimal" autocomplete="off" value="${centsToInput(st.owed)}"></div>
      <div class="form-group"><label class="form-label" for="payDate">Fecha</label>
        <input type="date" class="form-input" id="payDate" value="${localDate()}"></div>
    </div>
    <div class="form-group" style="margin-bottom:0"><label class="form-label" for="payAccount">${lent?'¿A qué cuenta llegó?':'¿De qué cuenta salió?'}</label>
      <select class="form-input form-select fin-field" id="payAccount">${optionList(bankAccounts(), (bankAccounts().find(x=>x.kind==='debit')||{}).id)}</select></div>`,
    `<button type="button" class="btn btn-primary" id="paySave">Guardar abono</button>`);
  document.getElementById('paySave').onclick = async ()=>{
    const amount = parseCents(finVal('payAmount'));
    const date = finVal('payDate'), acc = finVal('payAccount');
    if(!amount){ showToast('Escribe un monto válido','error'); return; }
    if(amount > st.owed){ showToast(`El abono es mayor que lo que falta (${fmtMoney(st.owed)})`,'error'); return; }
    if(!acc || !/^\d{4}-\d{2}-\d{2}$/.test(date)){ showToast('Elige cuenta y fecha','error'); return; }
    const tx = {type:'transfer', amount_cents:amount, occurred_on:date, note:`Abono préstamo · ${a.name}`, category_id:null,
      account_id: lent ? a.id : acc, to_account_id: lent ? acc : a.id};
    try{ const [row] = await dbPost('transactions', tx); fin.tx.push(row); sortTx(); closeFinModal(); renderContent(); showToast('Abono registrado','success'); }
    catch(e){ showToast('No se pudo guardar: '+finErr(e),'error'); }
  };
}
function openLoanEditModal(id){
  const a = fin.accounts.find(x=>x.id===id); if(!a) return;
  const lent = a.kind==='lent';
  const st = loanStats(a);
  openFinModal('Editar préstamo', `
    <div class="form-group"><label class="form-label" for="leName">Nombre</label>
      <input class="form-input" id="leName" maxlength="40" autocomplete="off" style="font-size:16px" value="${escapeAttr(a.name)}"></div>
    <div class="form-row">
      <div class="form-group"><label class="form-label" for="leDue">Fecha para pagar</label>
        <input type="date" class="form-input" id="leDue" value="${escapeAttr(a.due_date||'')}"></div>
      <div class="form-group"><label class="form-label" for="leNote">Nota</label>
        <input class="form-input" id="leNote" maxlength="120" autocomplete="off" style="font-size:16px" value="${escapeAttr(a.note||'')}"></div>
    </div>
    <div class="fin-hint">Los movimientos del préstamo aparecen en Movimientos y se editan ahí.</div>`,
    `${st.owed>0?`<button type="button" class="btn btn-ghost fin-modal-del" id="leForgive">${lent?'Perdonar lo que falta':'Me condonaron lo que falta'}</button>`:''}<button type="button" class="btn btn-primary" id="leSave">Guardar</button>`);
  document.getElementById('leSave').onclick = async ()=>{
    const payload = {name: finVal('leName'), due_date: finVal('leDue') || null, note: finVal('leNote') || null};
    if(!payload.name){ showToast('Escribe el nombre','error'); return; }
    try{ await dbPatch('accounts', payload, `?id=eq.${a.id}`); Object.assign(a, payload); closeFinModal(); renderContent(); showToast('Préstamo actualizado','success'); }
    catch(e){ showToast('No se pudo guardar: '+finErr(e),'error'); }
  };
  if(st.owed>0) document.getElementById('leForgive').onclick = async ()=>{
    const msg = lent ? `¿Perdonar ${fmtMoney(st.owed)} a ${a.name}? Se registra como gasto de hoy.` : `¿Registrar que ${a.name} te condonó ${fmtMoney(st.owed)}? Se registra como ingreso de hoy.`;
    if(!confirm(msg)) return;
    const tx = {type: lent?'expense':'income', amount_cents: st.owed, account_id: a.id, to_account_id:null, category_id:null, occurred_on: localDate(), note: lent?`Préstamo perdonado · ${a.name}`:`Préstamo condonado · ${a.name}`};
    try{ const [row] = await dbPost('transactions', tx); fin.tx.push(row); sortTx(); closeFinModal(); renderContent(); showToast('Registrado','success'); }
    catch(e){ showToast('No se pudo guardar: '+finErr(e),'error'); }
  };
}
async function setLoanClosed(id, archived){
  const a = fin.accounts.find(x=>x.id===id); if(!a) return;
  try{ await dbPatch('accounts', {archived}, `?id=eq.${id}`); a.archived = archived; renderContent(); showToast(archived?'Préstamo liquidado':'Préstamo reabierto','success'); }
  catch(e){ showToast('No se pudo actualizar: '+finErr(e),'error'); }
}

// d) Presupuesto
function finBudgetHTML(){
  const expCats = activeCats('expense');
  let totalLim = 0, totalSpent = 0;
  const rows = expCats.map(c=>{
    const spent = fin.tx.filter(t=>t.type==='expense' && t.category_id===c.id && txInMonth(t,0)).reduce((s,t)=>s+(Number(t.amount_cents)||0),0);
    const b = currentBudget(c.id);
    let detail;
    if(b){
      const lim = Number(b.amount_cents)||0;
      totalLim += lim; totalSpent += spent;
      const pct = lim>0 ? spent*100/lim : (spent>0 ? 101 : 0);
      const cls = pct>100 ? 'over' : pct>=80 ? 'warn' : 'ok';
      detail = `<div class="fin-bar"><div class="${cls}" style="width:${Math.min(100,pct).toFixed(1)}%"></div></div>
        <div class="fin-budget-txt ${pct>100?'over':''}">${fmtMoney(spent)} de ${fmtMoney(lim)}${lim>0?` (${Math.round(pct)}%)`:''}</div>`;
    } else detail = `<div class="fin-budget-txt">Gastado: ${fmtMoney(spent)}</div>`;
    return `<div class="fin-budget-row">
      <div class="fin-budget-top">
        <div class="fin-budget-name">${escapeHTML(c.name)}</div>
        <button type="button" class="fin-limit ${b?'':'empty'}" data-fin-limit="${escapeAttr(c.id)}" title="Editar límite">${b?fmtMoney(b.amount_cents):'Sin presupuesto'}</button>
        <button type="button" class="fin-icon-btn" data-cat-rename="${escapeAttr(c.id)}" title="Renombrar" aria-label="Renombrar"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/></svg></button>
        <button type="button" class="fin-icon-btn" data-cat-archive="${escapeAttr(c.id)}" title="Archivar" aria-label="Archivar"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v11a1 1 0 001 1h12a1 1 0 001-1V8"/><line x1="10" y1="12" x2="14" y2="12"/></svg></button>
      </div>${detail}
    </div>`;
  }).join('');
  const saved = savedInMonth(0);
  const savRows = activeCats('savings').map(c=>{
    const b = currentBudget(c.id);
    let detail;
    if(b){
      const goal = Number(b.amount_cents)||0;
      const pct = goal>0 ? saved*100/goal : 100;
      detail = `<div class="fin-bar"><div class="${savingsClass(pct)}" style="width:${Math.max(0,Math.min(100,pct)).toFixed(1)}%"></div></div>
        <div class="fin-budget-txt" style="color:${pct>=100?'var(--green)':pct>=80?'var(--amber)':'var(--red)'}">${fmtMoney(saved)} de ${fmtMoney(goal)} (${Math.round(pct)}%)${pct>=100?' · ¡Meta cumplida!':''}</div>`;
    } else detail = `<div class="fin-budget-txt">Ahorrado: ${fmtMoney(saved)}</div>`;
    return `<div class="fin-budget-row">
      <div class="fin-budget-top">
        <div class="fin-budget-name">${escapeHTML(c.name)}</div>
        <button type="button" class="fin-limit ${b?'':'empty'}" data-fin-limit="${escapeAttr(c.id)}" title="Editar meta">${b?fmtMoney(b.amount_cents):'Sin meta'}</button>
        <button type="button" class="fin-icon-btn" data-cat-rename="${escapeAttr(c.id)}" title="Renombrar" aria-label="Renombrar"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/></svg></button>
      </div>${detail}
    </div>`;
  }).join('');
  const savHTML = savRows ? `<div class="task-group-label fin-section-label" style="margin-top:0"><span>Meta de ahorro</span></div>
    <div class="fin-list">${savRows}</div>
    <div class="fin-hint" style="margin-bottom:6px">Cuenta lo que transfieres a tus cuentas de ahorro e inversión (NU, GBM) este mes, menos lo que sacas.</div>
    <div class="task-group-label fin-section-label"><span>Gastos</span></div>` : '';
  const incRows = activeCats('income').map(c=>{
    const b = currentBudget(c.id);
    const rec = receivedInMonth(c.id);
    let detail;
    if(b){
      const exp = Number(b.amount_cents)||0;
      const pct = exp>0 ? rec*100/exp : 0;
      detail = `<div class="fin-bar"><div class="${pct>=100?'ok':'goal'}" style="width:${Math.min(100,pct).toFixed(1)}%"></div></div>
        <div class="fin-budget-txt">Recibido ${fmtMoney(rec)} de ${fmtMoney(exp)}${pct>=100?' · ✓ Completo':''}</div>`;
    } else detail = `<div class="fin-budget-txt">Recibido este mes: ${fmtMoney(rec)}</div>`;
    return `<div class="fin-budget-row"><div class="fin-budget-top">
      <div class="fin-budget-name">${escapeHTML(c.name)}</div>
      <button type="button" class="fin-limit ${b?'':'empty'}" data-fin-limit="${escapeAttr(c.id)}" title="Monto esperado al mes">${b?fmtMoney(b.amount_cents):'Sin monto esperado'}</button>
      <button type="button" class="fin-icon-btn" data-cat-rename="${escapeAttr(c.id)}" title="Renombrar" aria-label="Renombrar"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/></svg></button>
      <button type="button" class="fin-icon-btn" data-cat-archive="${escapeAttr(c.id)}" title="Archivar" aria-label="Archivar"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v11a1 1 0 001 1h12a1 1 0 001-1V8"/><line x1="10" y1="12" x2="14" y2="12"/></svg></button>
    </div>${detail}</div>`;
  }).join('');
  const archived = fin.categories.filter(c=>c.archived);
  const archivedHTML = archived.length ? `<div class="task-group-label fin-section-label"><span>Archivadas (${archived.length})</span><button type="button" class="btn btn-ghost fin-small-btn" id="finToggleArchived">${finShowArchived?'Ocultar':'Ver'}</button></div>
    ${finShowArchived ? `<div class="fin-list">${archived.map(c=>`<div class="fin-budget-row"><div class="fin-budget-top"><div class="fin-budget-name">${escapeHTML(c.name)} <span class="fin-kind">${c.kind==='income'?'Ingreso':c.kind==='savings'?'Ahorro':'Gasto'}</span></div><button type="button" class="fin-icon-btn" data-cat-restore="${escapeAttr(c.id)}">Restaurar</button></div></div>`).join('')}</div>` : ''}` : '';
  return `<div class="fin-month-sum">${escapeHTML(monthLabel(0))} · Gastado ${fmtMoney(totalSpent)} de ${fmtMoney(totalLim)} presupuestado</div>
    ${savHTML}
    <div class="fin-list">${rows || '<div class="empty"><p>No hay categorías de gasto.</p></div>'}</div>
    ${incomeSourcesHTML()}
    ${fin.incomes.some(x=>x.active) ? (incRows ? `<div class="task-group-label fin-section-label"><span>Categorías de ingreso</span></div><div class="fin-list">${activeCats('income').map(c=>`<div class="fin-budget-row"><div class="fin-budget-top"><div class="fin-budget-name">${escapeHTML(c.name)}</div><button type="button" class="fin-icon-btn" data-cat-rename="${escapeAttr(c.id)}">Renombrar</button><button type="button" class="fin-icon-btn" data-cat-archive="${escapeAttr(c.id)}">Archivar</button></div></div>`).join('')}</div>` : '') :
    incRows ? `<div class="task-group-label fin-section-label"><span>Ingresos esperados al mes</span></div><div class="fin-list">${incRows}</div><div class="fin-hint">No se registran solos: cuando te paguen, usa "Ya lo recibí" en Hoy.</div>` : ''}
    ${archivedHTML}
    <button type="button" class="btn btn-ghost fin-add-btn" id="finNewCat">+ Nueva categoría</button>`;
}

// e) Metas
function monthsUntil(due){
  const [y,m] = due.split('-').map(Number);
  const now = new Date();
  return (y-now.getFullYear())*12 + (m-1-now.getMonth());
}
// Varias metas en la misma cuenta: el saldo se reparte por fecha límite (la más cercana se llena primero).
function goalSiblings(g){ const k=x=>x.due_date||'9999-12-31'; return fin.goals.filter(x=>x.account_id===g.account_id).sort((a,b)=>k(a)<k(b)?-1:k(a)>k(b)?1:String(a.created_at).localeCompare(String(b.created_at))); }
function goalCurrent(g){
  if(!g.account_id) return Number(g.saved_cents)||0;
  const acc = fin.accounts.find(a=>a.id===g.account_id);
  const pool = Math.max(0, acc && acc.kind==='investment' && accPositions(acc.id).length ? accBalance(acc.id) : accountValue(g.account_id));
  const sib = goalSiblings(g);
  if(sib.length<2) return pool;
  let left = pool;
  for(const x of sib){ const take = Math.min(left, Number(x.target_cents)||0); if(x.id===g.id) return take; left -= take; }
  return 0;
}
function finGoalsHTML(){
  const cards = fin.goals.map(g=>{
    const target = Number(g.target_cents)||0;
    const cur = goalCurrent(g);
    if(!target) return `<div class="fin-card fin-goal" data-goal="${escapeAttr(g.id)}"><div class="fin-acc-head"><div class="fin-acc-name">${escapeHTML(g.name)}</div><span class="fin-kind">Sin monto total</span></div><div class="fin-big">${fmtMoney(cur)}</div><div class="fin-sub">${g.account_id?`Vive en: ${escapeHTML(accName(g.account_id))}`:'Progreso capturado a mano'}</div></div>`;
    const pct = target>0 ? Math.min(100, cur*100/target) : 0;
    const remaining = Math.max(0, target-cur);
    const lines = [];
    lines.push(g.account_id ? `Vive en: ${escapeHTML(accName(g.account_id))}${goalSiblings(g).length>1?' (se reparte por fecha con otras metas)':''}` : 'Progreso capturado a mano');
    if(g.due_date){
      const m = monthsUntil(g.due_date);
      const when = m<0 ? 'ya venció' : m===0 ? 'vence este mes' : `faltan ${m} ${m===1?'mes':'meses'}`;
      lines.push(`Fecha límite: ${escapeHTML(finDate(g.due_date))} · ${when}`);
      if(remaining>0){
        const need = Math.ceil(remaining / Math.max(1, m));
        lines.push(`Para llegar: ${fmtMoney(need)} al mes`);
        const plan = Number(g.monthly_contribution_cents)||0;
        if(plan>0) lines.push(plan>=need ? `Aportación planeada: ${fmtMoney(plan)} al mes` : `<span class="warn">Aportación planeada: ${fmtMoney(plan)} al mes (no alcanza)</span>`);
      }
    } else if(Number(g.monthly_contribution_cents)>0){
      const plan = Number(g.monthly_contribution_cents);
      lines.push(`Aportación planeada: ${fmtMoney(plan)} al mes`);
      if(remaining>0) lines.push(`Con eso llegas en ${Math.ceil(remaining/plan)} meses`);
    }
    if(remaining===0 && target>0) lines.push('<span style="color:var(--green)">¡Meta alcanzada!</span>');
    return `<div class="fin-card fin-goal" data-goal="${escapeAttr(g.id)}">
      <div class="fin-acc-head"><div class="fin-acc-name">${escapeHTML(g.name)}</div><span class="fin-kind">${Math.round(pct)}%</span></div>
      <div class="fin-bar"><div class="${remaining===0&&target>0?'ok':'goal'}" style="width:${pct.toFixed(1)}%"></div></div>
      <div class="fin-budget-txt">${fmtMoney(cur)} de ${fmtMoney(target)}</div>
      <div class="fin-goal-lines">${lines.map(l=>`<div>${l}</div>`).join('')}</div>
    </div>`;
  }).join('');
  return `${bucketsHTML()}
    <div class="task-group-label fin-section-label"><span>Metas</span></div>
    ${cards ? `<div class="fin-acc-grid">${cards}</div>` : '<div class="empty"><p>Aún no tienes metas.</p></div>'}
    <button type="button" class="btn btn-ghost fin-add-btn" id="finNewGoal">+ Nueva meta</button>`;
}

function bindFinance(el){
  el.querySelectorAll('[data-fin-goto]').forEach(b=>b.onclick=()=>{ finView=b.dataset.finGoto; renderContent(); });
  el.querySelectorAll('[data-tx]').forEach(r=>r.onclick=()=>openTxModal(r.dataset.tx));
  el.querySelectorAll('[data-fin-month]').forEach(b=>b.onclick=()=>{ finMonthOffset=Math.min(0, finMonthOffset+Number(b.dataset.finMonth)); renderContent(); });
  const fa = el.querySelector('#finFilterAcc'); if(fa) fa.onchange=()=>{ finFilterAcc=fa.value; renderContent(); };
  const fc = el.querySelector('#finFilterCat'); if(fc) fc.onchange=()=>{ finFilterCat=fc.value; renderContent(); };
  el.querySelectorAll('[data-fin-opening]').forEach(b=>b.onclick=()=>openOpeningModal(b.dataset.finOpening));
  el.querySelectorAll('[data-fin-limit]').forEach(b=>b.onclick=()=>editLimitInline(b));
  el.querySelectorAll('[data-cat-rename]').forEach(b=>b.onclick=()=>openCategoryModal(b.dataset.catRename));
  el.querySelectorAll('[data-cat-archive]').forEach(b=>b.onclick=()=>setCategoryArchived(b.dataset.catArchive, true));
  el.querySelectorAll('[data-cat-restore]').forEach(b=>b.onclick=()=>setCategoryArchived(b.dataset.catRestore, false));
  const ta = el.querySelector('#finToggleArchived'); if(ta) ta.onclick=()=>{ finShowArchived=!finShowArchived; renderContent(); };
  const nc = el.querySelector('#finNewCat'); if(nc) nc.onclick=()=>openCategoryModal();
  el.querySelectorAll('[data-goal]').forEach(c=>c.onclick=()=>openGoalModal(c.dataset.goal));
  const ng = el.querySelector('#finNewGoal'); if(ng) ng.onclick=()=>openGoalModal();
  el.querySelectorAll('[data-loan-pay]').forEach(b=>b.onclick=()=>openLoanPaymentModal(b.dataset.loanPay));
  el.querySelectorAll('[data-loan-edit]').forEach(b=>b.onclick=()=>openLoanEditModal(b.dataset.loanEdit));
  el.querySelectorAll('[data-loan-close]').forEach(b=>b.onclick=()=>setLoanClosed(b.dataset.loanClose, true));
  el.querySelectorAll('[data-loan-reopen]').forEach(b=>b.onclick=()=>setLoanClosed(b.dataset.loanReopen, false));
  const nl = el.querySelector('#finNewLoan'); if(nl) nl.onclick=()=>openLoanModal();
  const tl = el.querySelector('#finToggleLoans'); if(tl) tl.onclick=()=>{ finShowClosedLoans=!finShowClosedLoans; renderContent(); };
  el.querySelectorAll('[data-income-receive]').forEach(b=>b.onclick=()=>{
    const x = expectedIncomes().find(i=>i.cat.id===b.dataset.incomeReceive); if(!x) return;
    const step = x.source && x.source.frequency!=='irregular' ? Math.min(Number(x.source.amount_cents)||0, x.expected-x.received) : x.expected-x.received;
    openTxModal(null, {type:'income', category_id:x.cat.id, amount:Math.max(0,step), account_id:x.source&&x.source.account_id, title:`Recibí ${x.cat.name}`, receipt:true});
  });
  el.querySelectorAll('[data-card-edit]').forEach(b=>b.onclick=()=>openCardModal(b.dataset.cardEdit));
  el.querySelectorAll('[data-rec-edit]').forEach(b=>b.onclick=()=>openRecurringModal(b.dataset.recEdit));
  el.querySelectorAll('[data-rec-pause]').forEach(b=>b.onclick=()=>toggleRecurringPause(b.dataset.recPause));
  el.querySelectorAll('[data-rec-charge]').forEach(b=>b.onclick=()=>chargeRecurring(b.dataset.recCharge));
  const nr = el.querySelector('#finNewRec'); if(nr) nr.onclick=()=>openRecurringModal();
  el.querySelectorAll('[data-alert-hide]').forEach(b=>b.onclick=()=>{ hideAlert(b.dataset.alertHide); renderContent(); });
  el.querySelectorAll('[data-rev-month]').forEach(b=>b.onclick=()=>{ finReviewOffset=Math.min(0, finReviewOffset+Number(b.dataset.revMonth)); renderContent(); });
  const sr = el.querySelector('#finSaveReview'); if(sr) sr.onclick=saveReview;
  const em = el.querySelector('#finExportMovs'); if(em) em.onclick=exportMovsCSV;
  const ep = el.querySelector('#finExportPat'); if(ep) ep.onclick=exportPatrimonioCSV;
  el.querySelectorAll('[data-fin-allocate]').forEach(b=>b.onclick=openAllocateModal);
  el.querySelectorAll('[data-acc-monthly]').forEach(b=>b.onclick=()=>editAccMonthlyInline(b));
  el.querySelectorAll('[data-src-edit]').forEach(b=>b.onclick=()=>openSourceModal(b.dataset.srcEdit));
  el.querySelectorAll('[data-src-new]').forEach(b=>b.onclick=()=>openSourceModal());
  el.querySelectorAll('[data-acc-edit]').forEach(b=>b.onclick=()=>openAccountModal(b.dataset.accEdit));
  const na = el.querySelector('#finNewAcc'); if(na) na.onclick=()=>openAccountModal();
  const tc = el.querySelector('#finToggleClosedAcc'); if(tc) tc.onclick=()=>{ finShowClosedAcc=!finShowClosedAcc; renderContent(); };
  el.querySelectorAll('[data-acc-restore]').forEach(b=>b.onclick=()=>setAccountArchived(b.dataset.accRestore, false));
  el.querySelectorAll('[data-acc-history]').forEach(b=>b.onclick=()=>openHistoryModal(b.dataset.accHistory));
  el.querySelectorAll('[data-fin-goto-loans]').forEach(b=>b.onclick=()=>{ finView='loans'; renderContent(); });
}

// Modal genérico de finanzas
function openFinModal(title, body, footer){
  document.getElementById('finModalTitle').textContent = title;
  document.getElementById('finModalBody').innerHTML = body;
  document.getElementById('finModalFooter').innerHTML = footer;
  document.getElementById('finModal').classList.add('open');
}
function closeFinModal(){ document.getElementById('finModal').classList.remove('open'); }
document.getElementById('finModalClose').addEventListener('click', closeFinModal);
document.getElementById('finModal').addEventListener('click', e=>{ if(e.target.id==='finModal') closeFinModal(); });
function finVal(id){ const e=document.getElementById(id); return e ? e.value.trim() : ''; }
function finErr(e){ return String((e && e.message) || e).slice(0,140); }

// Movimiento: crear / editar / eliminar
function openTxModal(id, preset){
  const t = id ? fin.tx.find(x=>x.id===id) : null;
  if(id && !t) return;
  preset = preset || {};
  let type = t ? t.type : (preset.type || 'expense');
  const accs = fin.accounts.filter(a=>!a.archived || (t && (a.id===t.account_id || a.id===t.to_account_id)));
  const firstAcc = preset.account_id || (activeAccounts().find(a=>a.kind==='debit') || accs[0] || {}).id;
  const body = `
    <div class="fin-type-btns">${Object.entries(TX_TYPES).map(([k,v])=>`<button type="button" class="fin-type-btn ${k}" data-type="${k}">${v}</button>`).join('')}</div>
    <div class="form-group"><label class="form-label" for="txAmount">Monto</label>
      <input class="form-input fin-money" id="txAmount" inputmode="decimal" autocomplete="off" placeholder="0.00" value="${t?centsToInput(t.amount_cents):(preset.amount?centsToInput(preset.amount):'')}"></div>
    <div class="form-row">
      <div class="form-group"><label class="form-label" for="txAccount" id="txAccLabel">Cuenta</label>
        <select class="form-input form-select fin-field" id="txAccount">${optionList(accs, t?t.account_id:firstAcc, accLabel)}</select></div>
      <div class="form-group" id="txToWrap"><label class="form-label" for="txTo">Hacia</label>
        <select class="form-input form-select fin-field" id="txTo">${optionList(accs, t&&t.to_account_id ? t.to_account_id : (activeAccounts().find(a=>a.kind==='credit')||{}).id, accLabel)}</select></div>
    </div>
    <div class="form-group" id="txCatWrap"><label class="form-label" for="txCategory">Categoría</label>
      <select class="form-input form-select fin-field" id="txCategory"></select></div>
    <div class="form-group"><label class="form-label" for="txDate">Fecha</label>
      <input type="date" class="form-input" id="txDate" value="${escapeAttr(t?t.occurred_on:localDate())}"></div>
    <div class="form-group" style="margin-bottom:0"><label class="form-label" for="txNote">Nota (opcional)</label>
      <input class="form-input" id="txNote" maxlength="200" autocomplete="off" value="${escapeAttr(t ? (t.note||'') : (preset.note||''))}"></div>
    ${!t && preset.receipt ? `<label class="wiz-check" style="margin-top:14px"><input type="checkbox" id="txIncluded"> Ya estaba incluido en el saldo que capturé (solo lo registro, no lo vuelvo a sumar)</label>` : ''}`;
  const footer = `${t?'<button type="button" class="btn btn-ghost fin-modal-del" id="txDelete">Eliminar</button>':''}<button type="button" class="btn btn-primary" id="txSave">Guardar</button>`;
  openFinModal(t ? 'Editar movimiento' : (preset.title || 'Nuevo movimiento'), body, footer);

  const applyType = ()=>{
    document.querySelectorAll('.fin-type-btn').forEach(b=>b.classList.toggle('active', b.dataset.type===type));
    const isT = type==='transfer';
    document.getElementById('txToWrap').style.display = isT ? '' : 'none';
    document.getElementById('txCatWrap').style.display = isT ? 'none' : '';
    document.getElementById('txAccLabel').textContent = isT ? 'Desde' : 'Cuenta';
    if(!isT){
      const sel = document.getElementById('txCategory');
      const keep = sel.value || (t && t.category_id) || preset.category_id;
      const cats = fin.categories.filter(c=>c.kind===type && (!c.archived || c.id===keep)).sort((a,b)=>a.name.localeCompare(b.name,'es'));
      sel.innerHTML = optionList(cats, keep);
    }
  };
  document.querySelectorAll('.fin-type-btn').forEach(b=>b.onclick=()=>{ type=b.dataset.type; document.getElementById('txCategory').value=''; applyType(); });
  applyType();
  document.getElementById('txSave').onclick = ()=>saveTx(t, type);
  if(t) document.getElementById('txDelete').onclick = ()=>deleteTx(t);
  if(!t) setTimeout(()=>document.getElementById('txAmount').focus(), 50);
}
async function saveTx(t, type){
  const amount = parseCents(finVal('txAmount'));
  if(!amount){ showToast('Escribe un monto válido, por ejemplo 250.50','error'); return; }
  const account_id = finVal('txAccount');
  const occurred_on = finVal('txDate');
  if(!account_id){ showToast('Elige una cuenta','error'); return; }
  if(!/^\d{4}-\d{2}-\d{2}$/.test(occurred_on)){ showToast('Elige una fecha','error'); return; }
  const payload = {type, amount_cents:amount, account_id, occurred_on, note: finVal('txNote') || null, to_account_id:null, category_id:null};
  if(type==='transfer'){
    payload.to_account_id = finVal('txTo');
    if(!payload.to_account_id || payload.to_account_id===account_id){ showToast('Elige dos cuentas distintas','error'); return; }
  } else {
    payload.category_id = finVal('txCategory') || null;
    if(!payload.category_id){ showToast('Elige una categoría','error'); return; }
  }
  const btn = document.getElementById('txSave'); btn.disabled = true;
  try{
    if(t){
      const [row] = await dbPatch('transactions', payload, `?id=eq.${t.id}`);
      Object.assign(t, row || payload);
    } else {
      const included = type==='income' && document.getElementById('txIncluded') && document.getElementById('txIncluded').checked;
      const [row] = await dbPost('transactions', payload);
      fin.tx.push(row);
      if(included){ // el saldo capturado ya lo traía: bajamos el saldo inicial para no contarlo dos veces
        const acc = fin.accounts.find(a=>a.id===account_id);
        const opening = (Number(acc.opening_balance_cents)||0) - amount;
        await dbPatch('accounts', {opening_balance_cents:opening}, `?id=eq.${acc.id}`); acc.opening_balance_cents = opening;
      }
    }
    sortTx(); closeFinModal(); renderContent();
    showToast(t ? 'Movimiento actualizado' : 'Movimiento guardado','success');
  }catch(e){ btn.disabled = false; showToast('No se pudo guardar: '+finErr(e),'error'); }
}
async function deleteTx(t){
  if(!confirm('¿Eliminar este movimiento? No se puede deshacer.')) return;
  try{
    await dbDelete('transactions', `?id=eq.${t.id}`);
    fin.tx = fin.tx.filter(x=>x.id!==t.id);
    closeFinModal(); renderContent(); showToast('Movimiento eliminado','success');
  }catch(e){ showToast('No se pudo eliminar: '+finErr(e),'error'); }
}

// Saldo / deuda inicial de una cuenta
function openOpeningModal(id){
  const a = fin.accounts.find(x=>x.id===id); if(!a) return;
  const isCredit = a.kind==='credit';
  openFinModal(`${isCredit?'Deuda inicial':'Saldo inicial'} · ${a.name}`,
    `<div class="form-group" style="margin-bottom:0"><label class="form-label" for="accOpening">${isCredit?'¿Cuánto debías al empezar a registrar?':'¿Cuánto tenías al empezar a registrar?'}</label>
      <input class="form-input fin-money" id="accOpening" inputmode="decimal" autocomplete="off" placeholder="0.00" value="${centsToInput(a.opening_balance_cents)}">
      <div class="fin-hint">El saldo se calcula a partir de aquí sumando y restando tus movimientos.</div></div>`,
    `<button type="button" class="btn btn-primary" id="accOpeningSave">Guardar</button>`);
  document.getElementById('accOpeningSave').onclick = async ()=>{
    const raw = finVal('accOpening');
    const c = raw==='' ? 0 : parseCents(raw);
    if(c===null){ showToast('Escribe un monto válido','error'); return; }
    const value = isCredit ? -c : c;
    try{
      await dbPatch('accounts', {opening_balance_cents:value}, `?id=eq.${a.id}`);
      a.opening_balance_cents = value; closeFinModal(); renderContent(); showToast('Guardado','success');
    }catch(e){ showToast('No se pudo guardar: '+finErr(e),'error'); }
  };
}

// Límite de presupuesto editable en el lugar
function editLimitInline(btn){
  const catId = btn.dataset.finLimit;
  const b = currentBudget(catId);
  const inp = document.createElement('input');
  inp.className = 'form-input fin-limit-input'; inp.inputMode = 'decimal'; inp.placeholder = 'Límite'; inp.autocomplete = 'off';
  inp.value = b ? centsToInput(b.amount_cents) : '';
  btn.replaceWith(inp); inp.focus(); inp.select();
  let done = false;
  const commit = async (save)=>{
    if(done) return; done = true;
    if(save) await saveBudget(catId, inp.value.trim());
    renderContent();
  };
  inp.addEventListener('keydown', e=>{ if(e.key==='Enter'){ e.preventDefault(); commit(true); } else if(e.key==='Escape') commit(false); });
  inp.addEventListener('blur', ()=>commit(true));
}
async function saveBudget(catId, raw){
  const ms = monthStartStr(0);
  const exact = fin.budgets.find(b=>b.category_id===catId && b.month===ms);
  const inherited = currentBudget(catId);
  const c = raw==='' ? 0 : parseCents(raw); // vacío = quitar presupuesto desde este mes
  if(c===null){ showToast('Escribe un monto válido','error'); return; }
  try{
    if(exact){ if(Number(exact.amount_cents)===c) return; await dbPatch('budgets', {amount_cents:c}, `?id=eq.${exact.id}`); exact.amount_cents = c; }
    else { if((inherited ? Number(inherited.amount_cents) : 0)===c) return; const [row] = await dbPost('budgets', {category_id:catId, month:ms, amount_cents:c}); fin.budgets.push(row); }
  }catch(e){ showToast('No se pudo guardar: '+finErr(e),'error'); }
}

// Categorías: crear, renombrar, archivar
function openCategoryModal(id){
  const c = id ? fin.categories.find(x=>x.id===id) : null;
  openFinModal(c ? 'Renombrar categoría' : 'Nueva categoría',
    `<div class="form-group"><label class="form-label" for="catName">Nombre</label>
      <input class="form-input" id="catName" maxlength="40" autocomplete="off" value="${escapeAttr(c?c.name:'')}" style="font-size:16px"></div>
     ${c ? '' : `<div class="form-group" style="margin-bottom:0"><label class="form-label" for="catKind">Tipo</label>
      <select class="form-input form-select fin-field" id="catKind"><option value="expense">Gasto</option><option value="income">Ingreso</option><option value="savings">Meta de ahorro</option></select></div>`}`,
    `<button type="button" class="btn btn-primary" id="catSave">Guardar</button>`);
  setTimeout(()=>document.getElementById('catName').focus(), 50);
  document.getElementById('catSave').onclick = async ()=>{
    const name = finVal('catName');
    if(!name){ showToast('Escribe un nombre','error'); return; }
    try{
      if(c){ await dbPatch('categories', {name}, `?id=eq.${c.id}`); c.name = name; }
      else { const [row] = await dbPost('categories', {name, kind: finVal('catKind') || 'expense'}); fin.categories.push(row); }
      closeFinModal(); renderContent(); showToast('Categoría guardada','success');
    }catch(e){ showToast('No se pudo guardar: '+finErr(e),'error'); }
  };
}
async function setCategoryArchived(id, archived){
  const c = fin.categories.find(x=>x.id===id); if(!c) return;
  c.archived = archived; renderContent();
  try{ await dbPatch('categories', {archived}, `?id=eq.${id}`); showToast(archived?`"${c.name}" archivada`:`"${c.name}" restaurada`,'success'); }
  catch(e){ c.archived = !archived; renderContent(); showToast('No se pudo actualizar: '+finErr(e),'error'); }
}

// Metas
function openGoalModal(id){
  const g = id ? fin.goals.find(x=>x.id===id) : null;
  if(id && !g) return;
  const accs = bankAccounts().filter(a=>a.kind!=='credit');
  const body = `
    <div class="form-group"><label class="form-label" for="goalName">Nombre</label>
      <input class="form-input" id="goalName" maxlength="60" autocomplete="off" style="font-size:16px" value="${escapeAttr(g?g.name:'')}"></div>
    <div class="form-row">
      <div class="form-group"><label class="form-label" for="goalTarget">Monto total (opcional)</label>
        <input class="form-input fin-money" id="goalTarget" inputmode="decimal" autocomplete="off" placeholder="0.00" value="${g?centsToInput(g.target_cents):''}"></div>
      <div class="form-group"><label class="form-label" for="goalDue">Fecha límite</label>
        <input type="date" class="form-input" id="goalDue" value="${escapeAttr(g&&g.due_date||'')}"></div>
    </div>
    <div class="form-group"><label class="form-label" for="goalAccount">¿Dónde vive el dinero?</label>
      <select class="form-input form-select fin-field" id="goalAccount"><option value="">Ninguna cuenta (lo capturo a mano)</option>${optionList(accs, g?g.account_id:'')}</select></div>
    <div class="form-row">
      <div class="form-group"><label class="form-label" for="goalMonthly">Aportación mensual</label>
        <input class="form-input fin-money" id="goalMonthly" inputmode="decimal" autocomplete="off" placeholder="0.00" value="${g&&Number(g.monthly_contribution_cents)?centsToInput(g.monthly_contribution_cents):''}"></div>
      <div class="form-group" id="goalSavedWrap"><label class="form-label" for="goalSaved">Llevo ahorrado</label>
        <input class="form-input fin-money" id="goalSaved" inputmode="decimal" autocomplete="off" placeholder="0.00" value="${g&&Number(g.saved_cents)?centsToInput(g.saved_cents):''}"></div>
    </div>
    <div class="fin-hint" id="goalHint"></div>`;
  const footer = `${g?'<button type="button" class="btn btn-ghost fin-modal-del" id="goalDelete">Eliminar</button>':''}<button type="button" class="btn btn-primary" id="goalSave">Guardar</button>`;
  openFinModal(g ? 'Editar meta' : 'Nueva meta', body, footer);
  const syncAcc = ()=>{
    const hasAcc = !!finVal('goalAccount');
    document.getElementById('goalSavedWrap').style.visibility = hasAcc ? 'hidden' : '';
    document.getElementById('goalHint').textContent = hasAcc ? 'El progreso es el saldo de esa cuenta.' : 'El progreso es lo que captures en "Llevo ahorrado".';
  };
  document.getElementById('goalAccount').onchange = syncAcc; syncAcc();
  if(!g) setTimeout(()=>document.getElementById('goalName').focus(), 50);
  document.getElementById('goalSave').onclick = async ()=>{
    const name = finVal('goalName');
    const targetRaw = finVal('goalTarget'); const target = targetRaw==='' ? null : parseCents(targetRaw);
    const monthlyRaw = finVal('goalMonthly'), savedRaw = finVal('goalSaved');
    const monthly = monthlyRaw==='' ? 0 : parseCents(monthlyRaw);
    const saved = savedRaw==='' ? 0 : parseCents(savedRaw);
    if(!name){ showToast('Escribe un nombre','error'); return; }
    if(targetRaw!=='' && !target){ showToast('Revisa el monto objetivo','error'); return; }
    if(monthly===null || saved===null){ showToast('Revisa los montos','error'); return; }
    const payload = {name, target_cents:target, due_date: finVal('goalDue') || null, account_id: finVal('goalAccount') || null, monthly_contribution_cents:monthly, saved_cents:saved};
    try{
      if(g){ const [row] = await dbPatch('money_goals', payload, `?id=eq.${g.id}`); Object.assign(g, row || payload); }
      else { const [row] = await dbPost('money_goals', payload); fin.goals.push(row); }
      closeFinModal(); renderContent(); showToast('Meta guardada','success');
    }catch(e){ showToast('No se pudo guardar: '+finErr(e),'error'); }
  };
  if(g) document.getElementById('goalDelete').onclick = async ()=>{
    if(!confirm(`¿Eliminar la meta "${g.name}"? No se puede deshacer.`)) return;
    try{ await dbDelete('money_goals', `?id=eq.${g.id}`); fin.goals = fin.goals.filter(x=>x!==g); closeFinModal(); renderContent(); showToast('Meta eliminada','success'); }
    catch(e){ showToast('No se pudo eliminar: '+finErr(e),'error'); }
  };
}

// ── FINANZAS v2: fondos, fuentes de ingreso, patrimonio, asistente ──
function assumption(key){ const a=fin.assumptions.find(x=>x.key===key); return a && a.value!==null && a.value!==undefined ? Number(a.value) : null; }
function positionValue(p, offset=0){
  const ms = monthStartStr(offset);
  const v = fin.valuations.filter(x=>x.position_id===p.id && x.month<=ms).sort((a,b)=>a.month<b.month?1:-1)[0];
  return v ? Number(v.value_cents) : null;
}
function accPositions(accId){ return fin.positions.filter(p=>!p.archived && p.account_id===accId); }
// Cuentas de inversión con fondos: su valor es la suma del último valor capturado de cada fondo.
function accountValue(id){ const ps=accPositions(id); return ps.length ? ps.reduce((s,p)=>s+(positionValue(p)||0),0) : accBalance(id); }
function paydaysInMonth(weekday, offset=0){
  const d=new Date(); d.setDate(1); d.setMonth(d.getMonth()+offset);
  const m=d.getMonth(); let n=0;
  while(d.getMonth()===m){ if(d.getDay()===Number(weekday)) n++; d.setDate(d.getDate()+1); }
  return n;
}
// Mensual "base": semanal ×4, quincenal ×2. Para lo que esperas recibir ESTE mes, semanal cuenta los días de pago reales del mes.
// Fecha de los saldos que capturaste en el asistente: lo que se pagó antes ya estaba en tus saldos.
function finStartDate(){ const v=assumption('start_date'); if(!v) return null; const s=String(Math.round(v)); return new Date(Number(s.slice(0,4)), Number(s.slice(4,6))-1, Number(s.slice(6,8))); }
// Primer día que cuenta este mes (día 1, o la fecha de inicio si cae en este mes)
function countFrom(){ const first=new Date(); first.setHours(0,0,0,0); first.setDate(1); const st=finStartDate(); return st && st>first ? st : first; }
function paydaysFrom(src, from, until){ // pagos con fecha en [from, until)
  const a = Number(src.amount_cents)||0;
  if(src.frequency==='semanal'){
    if(src.pay_weekday===null || src.pay_weekday===undefined || src.pay_weekday==='') return null;
    let n=0; const d=new Date(from); while(d<until){ if(d.getDay()===Number(src.pay_weekday)) n++; d.setDate(d.getDate()+1); } return n*a;
  }
  if((src.frequency==='mensual' || src.frequency==='quincenal') && src.pay_day){
    const y=from.getFullYear(), m=from.getMonth(), len=new Date(y,m+1,0).getDate();
    const days = src.frequency==='mensual' ? [src.pay_day] : [src.pay_day, src.pay_day+15];
    return days.filter(dd=>dd<=len).map(dd=>new Date(y,m,dd)).filter(dt=>dt>=from && dt<until).length * a;
  }
  return null;
}
function sourceMonthly(src, thisMonth){
  const a = Number(src.amount_cents)||0;
  if(thisMonth){
    const from = countFrom(), end = new Date(from.getFullYear(), from.getMonth()+1, 1);
    const n = paydaysFrom(src, from, end);
    if(n!==null) return n;
    const st = finStartDate(), first = new Date(from.getFullYear(), from.getMonth(), 1);
    if(st && st>first && src.frequency!=='semanal') return 0; // sin día conocido y empezaste este mes: ya estaba en tus saldos
  }
  if(src.frequency==='semanal') return a*4;
  if(src.frequency==='quincenal') return a*2;
  return a;
}
const FREQ_LABEL = {semanal:'semanal', quincenal:'quincenal', mensual:'mensual', irregular:'irregular (promedio)'};
const WEEKDAYS = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];

// Patrimonio: Herencia (fondos heredados) y Ahorro propio (cuentas, fondos propios y préstamos)
function finPatrimonioHTML(){
  const sum=(arr,f)=>arr.reduce((s,x)=>s+f(x),0);
  const funds = fin.positions.filter(p=>!p.archived);
  const fv = p=>positionValue(p)||0;
  const fprev = p=>{ const v=positionValue(p,-1); return v===null ? fv(p) : v; };
  const her = funds.filter(p=>p.origin==='heredado'), propF = funds.filter(p=>p.origin==='propio');
  const herVal=sum(her,fv), herCost=sum(her,p=>Number(p.cost_basis_cents)||0), herChange=herVal-sum(her,fprev);
  const rows = [];
  bankAccounts().forEach(a=>{
    if(accPositions(a.id).length) return; // sus fondos se listan aparte
    const v = accBalance(a.id);
    if(v!==0 || a.kind!=='investment') rows.push({name:a.name, sub:ACC_KIND[a.kind]||a.kind, v});
  });
  propF.forEach(p=>rows.push({name:p.fund_name, sub:`Fondo propio · aportado ${fmtMoney(p.cost_basis_cents)}`, v:fv(p)}));
  activeAccounts().filter(isLoan).forEach(l=>{ const o=loanStats(l).owed; if(o>0) rows.push({name:l.name, sub:l.kind==='lent'?'Te debe':'Le debes', v:l.kind==='lent'?o:-o}); });
  const propVal = sum(rows,r=>r.v);
  const {inc, exp} = monthTotals(0);
  const propChange = inc - exp + sum(propF,p=>fv(p)-fprev(p));
  const total = herVal + propVal;
  const pctTxt = (a,b)=> b>0 ? ` (${(a*100/b).toFixed(1)}%)` : '';
  const signed = c=> `<span style="color:${c<0?'var(--red)':'var(--green)'}">${c<0?'':'+'}${fmtMoney(c)}</span>`;
  const line = (name, sub, v, extra)=>`<div class="fin-tx" style="cursor:default"><div class="fin-tx-main"><div class="fin-tx-title">${escapeHTML(name)}</div><div class="fin-tx-sub">${sub}</div></div><div style="text-align:right;flex-shrink:0"><div class="fin-tx-amt ${v<0?'expense':''}">${fmtMoney(v)}</div>${extra||''}</div></div>`;
  return `<div class="fin-card fin-card-hero" style="margin-bottom:12px">
      <div class="fin-label">Patrimonio neto</div>
      <div class="fin-big ${total<0?'neg':''}">${fmtMoney(total)}</div>
      <div class="fin-sub">Herencia ${fmtMoney(herVal)} + Ahorro propio ${fmtMoney(propVal)}</div>
    </div>
    <div class="fin-acc-grid fin-pat-grid">
      <div class="fin-card">
        <div class="fin-acc-head"><div class="fin-acc-name">Herencia</div><span class="fin-kind">${her.length} fondo${her.length===1?'':'s'}</span></div>
        <div class="fin-big">${fmtMoney(herVal)}</div>
        <div class="fin-sub">Aportado ${fmtMoney(herCost)} · rendimiento ${signed(herVal-herCost)}${pctTxt(herVal-herCost, herCost)}</div>
        <div class="fin-sub">Cambio vs mes anterior: ${signed(herChange)}</div>
        <div class="fin-list" style="margin-top:12px">${her.length ? her.map(p=>{ const v=fv(p), c=Number(p.cost_basis_cents)||0; return line(p.fund_name, `${p.fund_key?escapeHTML(p.fund_key)+' · ':''}aportado ${fmtMoney(c)}`, v, `<div class="fin-tx-sub">${signed(v-c)}</div>`); }).join('') : '<div class="fin-hint">Sin fondos heredados. Agrégalos en ⚙ Configurar.</div>'}</div>
      </div>
      <div class="fin-card">
        <div class="fin-acc-head"><div class="fin-acc-name">Ahorro propio</div><span class="fin-kind">${rows.length} concepto${rows.length===1?'':'s'}</span></div>
        <div class="fin-big ${propVal<0?'neg':''}">${fmtMoney(propVal)}</div>
        <div class="fin-sub">Cambio este mes: ${signed(propChange)} (ingresos − gastos + rendimiento de fondos propios)</div>
        <div class="fin-list" style="margin-top:12px">${rows.map(r=>line(r.name, escapeHTML(r.sub), r.v)).join('')}</div>
      </div>
    </div>
    <div class="fin-hint">Los fondos usan el último valor capturado (asistente o revisión mensual).</div>
    <button type="button" class="btn btn-ghost fin-add-btn" id="finExportPat">Exportar CSV</button>`;
}

// Fuentes de ingreso (editar desde Presupuesto)
function incomeSourcesHTML(){
  const srcs = fin.incomes.filter(x=>x.active);
  if(!srcs.length) return '';
  const base = srcs.filter(x=>x.counts_for_budget).reduce((t,x)=>t+sourceMonthly(x,false),0);
  return `<div class="task-group-label fin-section-label"><span>Ingresos</span><span>Base ${fmtMoney(base)}/mes</span></div>
    <div class="fin-list">${srcs.map(x=>{
      const rec = x.category_id ? receivedInMonth(x.category_id) : 0, exp = sourceMonthly(x,true);
      const pct = exp>0 ? Math.min(100, rec*100/exp) : 0;
      const when = x.frequency==='semanal' && x.pay_weekday!==null && x.pay_weekday!==undefined ? ` · ${WEEKDAYS[x.pay_weekday].toLowerCase()}` : (x.pay_day ? ` · día ${x.pay_day}` : '');
      return `<div class="fin-budget-row"><div class="fin-budget-top">
          <div class="fin-budget-name">${escapeHTML(x.name)} <span class="fin-kind">${x.counts_for_budget?'Base':'Extra'}</span></div>
          <button type="button" class="fin-limit" data-src-edit="${escapeAttr(x.id)}">${fmtMoney(x.amount_cents)} ${FREQ_LABEL[x.frequency]}</button>
        </div>
        <div class="fin-bar"><div class="${pct>=100?'ok':'goal'}" style="width:${pct.toFixed(1)}%"></div></div>
        <div class="fin-budget-txt">Recibido este mes ${fmtMoney(rec)} de ${fmtMoney(exp)}${escapeHTML(when)}</div></div>`;
    }).join('')}</div>
    <button type="button" class="btn btn-ghost fin-add-btn" data-src-new style="margin-top:8px">+ Fuente de ingreso</button>`;
}
function openSourceModal(id){
  const x = id ? fin.incomes.find(i=>i.id===id) : null;
  const v = x || {name:'', amount_cents:0, frequency:'mensual', counts_for_budget:true, pay_weekday:null, pay_day:null, account_id:(bankAccounts().find(a=>a.kind==='debit')||{}).id};
  openFinModal(x ? 'Editar ingreso' : 'Nueva fuente de ingreso', `
    <div class="form-group"><label class="form-label" for="srcName">Nombre</label><input class="form-input" id="srcName" maxlength="40" style="font-size:16px" value="${escapeAttr(v.name)}"></div>
    <div class="form-row">
      <div class="form-group"><label class="form-label" for="srcAmount">Monto por pago</label><input class="form-input fin-money" id="srcAmount" inputmode="decimal" value="${v.amount_cents?centsToInput(v.amount_cents):''}" placeholder="0.00"></div>
      <div class="form-group"><label class="form-label" for="srcFreq">Frecuencia</label><select class="form-input form-select fin-field" id="srcFreq">${Object.keys(FREQ_LABEL).map(f=>`<option value="${f}" ${v.frequency===f?'selected':''}>${FREQ_LABEL[f]}</option>`).join('')}</select></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label" for="srcWeekday">Día de pago (semanal)</label><select class="form-input form-select fin-field" id="srcWeekday"><option value="">—</option>${WEEKDAYS.map((w,i)=>`<option value="${i}" ${String(v.pay_weekday)===String(i)?'selected':''}>${w}</option>`).join('')}</select></div>
      <div class="form-group"><label class="form-label" for="srcDay">Día del mes</label><input class="form-input fin-money" id="srcDay" inputmode="numeric" maxlength="2" value="${v.pay_day||''}" placeholder="1–31"></div>
    </div>
    <div class="form-group"><label class="form-label" for="srcAcc">¿A qué cuenta llega?</label><select class="form-input form-select fin-field" id="srcAcc">${optionList(bankAccounts(), v.account_id)}</select></div>
    <label class="wiz-check" style="margin-bottom:0"><input type="checkbox" id="srcCounts" ${v.counts_for_budget?'checked':''}> Cuenta para presupuesto (ingreso base)</label>`,
    `${x?'<button type="button" class="btn btn-ghost fin-modal-del" id="srcOff">Quitar</button>':''}<button type="button" class="btn btn-primary" id="srcSave">Guardar</button>`);
  document.getElementById('srcSave').onclick = async ()=>{
    const name=finVal('srcName'), amount=parseCents(finVal('srcAmount')), day=finVal('srcDay');
    if(!name){ showToast('Escribe el nombre','error'); return; }
    if(amount===null){ showToast('Escribe un monto válido','error'); return; }
    if(day && !(Number(day)>=1 && Number(day)<=31)){ showToast('El día debe ser entre 1 y 31','error'); return; }
    try{
      const cat = await ensureCategory(name, 'income');
      const payload = {name, amount_cents:amount, frequency:finVal('srcFreq'), pay_weekday: finVal('srcWeekday')===''?null:Number(finVal('srcWeekday')), pay_day: day?Number(day):null, account_id: finVal('srcAcc')||null, counts_for_budget: document.getElementById('srcCounts').checked, category_id: cat.id};
      await upsertRow('income_sources', x, payload, fin.incomes);
      closeFinModal(); renderContent(); showToast('Ingreso guardado','success');
    }catch(e){ showToast('No se pudo guardar: '+finErr(e),'error'); }
  };
  if(x) document.getElementById('srcOff').onclick = async ()=>{
    if(!confirm(`¿Quitar "${x.name}" de tus ingresos? Lo ya registrado no se borra.`)) return;
    try{ await dbPatch('income_sources',{active:false},`?id=eq.${x.id}`); x.active=false; closeFinModal(); renderContent(); }
    catch(e){ showToast('No se pudo actualizar: '+finErr(e),'error'); }
  };
}

// Utilidades de guardado
async function upsertRow(table, row, payload, list){
  if(row){ const [r] = await dbPatch(table, payload, `?id=eq.${row.id}`); Object.assign(row, r||payload); return row; }
  const [r] = await dbPost(table, payload); list.push(r); return r;
}
// Ajusta el saldo inicial para que el saldo calculado de hoy sea exactamente "cents".
async function setBalanceTo(acc, cents){
  const effect = accBalance(acc.id) - (Number(acc.opening_balance_cents)||0);
  const opening = cents - effect;
  if(opening !== Number(acc.opening_balance_cents)){ await dbPatch('accounts', {opening_balance_cents:opening}, `?id=eq.${acc.id}`); acc.opening_balance_cents = opening; }
}
async function ensureCategory(name, kind){
  let c = fin.categories.find(x=>x.kind===kind && x.name.trim().toLowerCase()===name.trim().toLowerCase());
  if(!c){ [c] = await dbPost('categories', {name, kind}); fin.categories.push(c); }
  else if(c.archived){ await dbPatch('categories', {archived:false}, `?id=eq.${c.id}`); c.archived = false; }
  return c;
}
async function ensureAccount(name, kind, institution){
  let a = fin.accounts.find(x=>!isLoan(x) && x.name.trim().toLowerCase()===name.trim().toLowerCase());
  if(!a){ [a] = await dbPost('accounts', {name, kind, institution, sort_order:50}); fin.accounts.push(a); }
  else if(a.archived){ await dbPatch('accounts', {archived:false}, `?id=eq.${a.id}`); a.archived = false; }
  return a;
}
async function setAssumption(key, value){ await upsertRow('assumptions', fin.assumptions.find(x=>x.key===key), {key, value, updated_at:new Date().toISOString()}, fin.assumptions); }
async function upsertGoal(name, account_id, target, due){
  const g = fin.goals.find(x=>x.name===name);
  if(!target){ return; }
  await upsertRow('money_goals', g, {name, account_id, target_cents:target, due_date:due||null}, fin.goals);
}

// ── ASISTENTE ──
const WIZ_KEY = 'finWizardV1';
const WIZ_TITLES = ['Ingresos','Gastos fijos y suscripciones','Tarjeta de crédito','Saldos actuales','Presupuesto de gastos variables','Metas de ahorro','Colchón','Supuestos','Resumen'];
const WIZ_SUGGESTED = {comida:'4000', transporte:'2000', ocio:'2000', ropa:'1000', salud:'500', otros:'2500'};
let wiz = null;
function wizSave(){ try{ localStorage.setItem(WIZ_KEY, JSON.stringify(wiz)); }catch(e){} }
function wizLoad(){ try{ const j=localStorage.getItem(WIZ_KEY); return j ? JSON.parse(j) : null; }catch(e){ return null; } }
function maybeOpenWizard(){
  if(fin.errors.length || fin.incomes.length || assumption('setup_completed')!==null) return;
  try{ if(sessionStorage.getItem('finWizSkip')) return; }catch(e){}
  openWizard();
}
function openWizard(){
  if(fin.errors.length){ showToast('Faltan tablas de finanzas: corre el SQL v2 primero','error'); return; }
  wiz = wizLoad() || {step:0, d:wizDefaults()};
  renderWizard();
  document.getElementById('finWizard').classList.add('open');
}
function closeWizard(){
  wizSave();
  document.getElementById('finWizard').classList.remove('open');
  try{ sessionStorage.setItem('finWizSkip','1'); }catch(e){}
}
function wizAcc(test){ return fin.accounts.find(a=>!a.archived && !isLoan(a) && test(a)); }
function wizDefaults(){
  const money = c=> c ? centsToInput(c) : '';
  const plata = wizAcc(a=>a.name==='Plata') || wizAcc(a=>a.kind==='debit');
  const nu = wizAcc(a=>a.name==='NU ahorro');
  const credit = wizAcc(a=>a.kind==='credit');
  const viaje = wizAcc(a=>a.kind==='savings' && /viaje/i.test(a.name));
  const futuro = wizAcc(a=>a.kind==='savings' && /futuro/i.test(a.name));
  const card = credit && fin.cards.find(c=>c.account_id===credit.id);
  const srcs = fin.incomes.filter(x=>x.active);
  const ahorro = activeCats('savings')[0];
  const trips = viaje ? fin.goals.filter(g=>g.account_id===viaje.id).map(g=>({id:g.id, name:g.name, amount:money(g.target_cents), date:g.due_date||''})) : [];
  while(trips.length<4) trips.push({name:['Viaje grande 1','Viaje grande 2','Viaje pequeño 1','Viaje pequeño 2'][trips.length], amount:'', date:''});
  const goalBy = n=>fin.goals.find(g=>g.name===n);
  const boda = goalBy('Boda y casa'), largo = goalBy('Largo plazo');
  const funds = fin.positions.filter(p=>!p.archived).map(p=>({id:p.id, name:p.fund_name, key:p.fund_key||'', origin:p.origin, value:money(positionValue(p)), cost:money(p.cost_basis_cents)}));
  if(!funds.length) for(let i=0;i<5;i++) funds.push({name:'', key:'', origin:'heredado', value:'', cost:''});
  const A = k=>{ const v=assumption(k); return v===null ? '' : String(v); };
  return {
    date: localDate(),
    incomes: srcs.length ? srcs.map(x=>({id:x.id, name:x.name, amount:money(x.amount_cents), frequency:x.frequency, counts:!!x.counts_for_budget, pay_weekday:x.pay_weekday===null||x.pay_weekday===undefined?'':String(x.pay_weekday), pay_day:x.pay_day?String(x.pay_day):'', account_id:x.account_id||''}))
      : [{name:'Sueldo', amount:'4500.00', frequency:'semanal', counts:true, pay_weekday:'', pay_day:'', account_id:plata?plata.id:''},
         {name:'Apoyo papá', amount:'6000.00', frequency:'mensual', counts:false, pay_weekday:'', pay_day:'', account_id:plata?plata.id:''}],
    recurring: fin.recurring.length ? fin.recurring.map(r=>({id:r.id, name:r.name, amount:money(r.amount_cents), day:r.day_of_month?String(r.day_of_month):'', kind:r.kind, account_id:r.account_id||''}))
      : [{name:'YouTube Premium', amount:'159.00', day:'', kind:'suscripcion', account_id:credit?credit.id:''},
         {name:'Claude', amount:'399.00', day:'', kind:'suscripcion', account_id:credit?credit.id:''}],
    card: {limit: card?money(card.credit_limit_cents):'', owed: credit?money(Math.max(0,-accBalance(credit.id))):'', cut: card?String(card.cut_day):'17', pay: card?String(card.pay_day):'16'},
    balances: {plata: plata?money(Math.max(0,accBalance(plata.id))):'', nu: nu?money(Math.max(0,accBalance(nu.id))):''},
    funds,
    budget: Object.fromEntries(activeCats('expense').map(c=>{ const b=currentBudget(c.id); return [c.id, b?centsToInput(b.amount_cents):'']; })),
    savings: {monthly: ahorro && currentBudget(ahorro.id) ? centsToInput(currentBudget(ahorro.id).amount_cents) : '',
      viaje: {balance: viaje?money(Math.max(0,accBalance(viaje.id))):'', trips},
      futuro: {balance: futuro?money(Math.max(0,accBalance(futuro.id))):'', amount: boda?money(boda.target_cents):'', date: boda&&boda.due_date||''},
      largo: {amount: largo?money(largo.target_cents):'', date: largo&&largo.due_date||''},
      monthlyBy: {nu: nu&&Number(nu.monthly_target_cents)?money(nu.monthly_target_cents):'', viaje: viaje&&Number(viaje.monthly_target_cents)?money(viaje.monthly_target_cents):'', futuro: futuro&&Number(futuro.monthly_target_cents)?money(futuro.monthly_target_cents):'', gbm: (()=>{ const g=wizAcc(a=>a.kind==='investment'); return g&&Number(g.monthly_target_cents)?money(g.monthly_target_cents):''; })()}},
    assume: {inflation:A('inflation'), expected_return:A('expected_return'), retirement_age:A('retirement_age'), years_to_retirement:A('years_to_retirement')},
    removed: {incomes:[], recurring:[], funds:[]},
  };
}
// Cálculos sobre lo capturado en el asistente
const wc = v=>{ const c=parseCents(v); return c===null?0:c; };
function wizMonthly(i){ const a=wc(i.amount); return i.frequency==='semanal'?a*4 : i.frequency==='quincenal'?a*2 : a; }
function wizIncomeTotals(){ const d=wiz.d; return {base:d.incomes.filter(i=>i.counts).reduce((t,i)=>t+wizMonthly(i),0), total:d.incomes.reduce((t,i)=>t+wizMonthly(i),0)}; }
function wizBudgetTotal(){ return Object.values(wiz.d.budget).reduce((t,v)=>t+wc(v),0); }
function wizSubsTotal(){ return wiz.d.recurring.reduce((t,r)=>t+wc(r.amount),0); }
function wizColchonGoal(){ return 3*(wizBudgetTotal()+wizSubsTotal()); }
function wizSummary(){
  const d=wiz.d;
  const her = d.funds.filter(f=>f.name.trim() && f.origin==='heredado').reduce((t,f)=>t+wc(f.value),0);
  const propFunds = d.funds.filter(f=>f.name.trim() && f.origin==='propio').reduce((t,f)=>t+wc(f.value),0);
  let loansNet = 0; activeAccounts().filter(isLoan).forEach(l=>{ const o=loanStats(l).owed; loansNet += l.kind==='lent'?o:-o; });
  const prop = wc(d.balances.plata)+wc(d.balances.nu)+wc(d.savings.viaje.balance)+wc(d.savings.futuro.balance)+propFunds-wc(d.card.owed)+loansNet;
  return {her, prop, propFunds, loansNet, total:her+prop};
}
function wizDate(){ return finDate(wiz.d.date); }

// Campos (data-w = ruta dentro de wiz.d)
const wv = v=>escapeAttr(v===null||v===undefined?'':String(v));
function wMoney(path, val, ph){ return `<input class="form-input fin-money" data-w="${path}" inputmode="decimal" autocomplete="off" placeholder="${escapeAttr(ph||'0.00')}" value="${wv(val)}">`; }
function wText(path, val, ph){ return `<input class="form-input" style="font-size:16px;height:42px" data-w="${path}" autocomplete="off" maxlength="60" placeholder="${escapeAttr(ph||'')}" value="${wv(val)}">`; }
function wNum(path, val, ph){ return `<input class="form-input fin-money" data-w="${path}" inputmode="numeric" autocomplete="off" maxlength="3" placeholder="${escapeAttr(ph||'')}" value="${wv(val)}">`; }
function wDate(path, val){ return `<input type="date" class="form-input" data-w="${path}" value="${wv(val)}">`; }
function wSelect(path, val, opts, rerender){ return `<select class="form-input form-select fin-field" data-w="${path}" ${rerender?'data-wrender':''}>${opts.map(([v,l])=>`<option value="${escapeAttr(v)}" ${String(val)===String(v)?'selected':''}>${escapeHTML(l)}</option>`).join('')}</select>`; }
function wField(label, input, hint){ return `<div class="form-group"><label class="form-label">${label}</label>${input}${hint?`<div class="fin-hint">${hint}</div>`:''}</div>`; }
const accOpts = ()=>bankAccounts().map(a=>[a.id, a.name]);

function wizStepHTML(){
  const d = wiz.d, st = wiz.step;
  if(st===0){
    const t = wizIncomeTotals();
    return `<p class="fin-hint" style="margin:0 0 14px">Tus ingresos no se registran solos: en Hoy aparecerán como "por recibir" hasta que digas "Ya lo recibí".</p>
      ${d.incomes.map((i,k)=>`<div class="wiz-item">
        ${wField('Nombre', wText(`incomes.${k}.name`, i.name, 'Ej. Sueldo'))}
        <div class="form-row">${wField('Monto por pago', wMoney(`incomes.${k}.amount`, i.amount))}${wField('Frecuencia', wSelect(`incomes.${k}.frequency`, i.frequency, Object.entries(FREQ_LABEL), true))}</div>
        <div class="form-row">
          ${i.frequency==='semanal' ? wField('Día de pago', wSelect(`incomes.${k}.pay_weekday`, i.pay_weekday, [['','No sé'],...WEEKDAYS.map((w,n)=>[String(n),w])])) : i.frequency==='irregular' ? '<div></div>' : wField('Día del mes', wNum(`incomes.${k}.pay_day`, i.pay_day, '1–31'))}
          ${wField('Llega a', wSelect(`incomes.${k}.account_id`, i.account_id, accOpts()))}
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><label class="wiz-check"><input type="checkbox" data-w="incomes.${k}.counts" data-wrender ${i.counts?'checked':''}> Cuenta para presupuesto</label>
        <button type="button" class="fin-icon-btn" data-wdel="incomes.${k}">Quitar</button></div>
      </div>`).join('')}
      <button type="button" class="btn btn-ghost fin-small-btn" data-wadd="incomes">+ Agregar ingreso</button>
      <div class="wiz-sum" id="wizLive">Ingreso base: <b>${fmtMoney(t.base)}</b>/mes · total con extras: <b>${fmtMoney(t.total)}</b>/mes<br><span class="fin-hint">Semanal se cuenta ×4 (meses con 5 pagos traen uno extra).</span></div>`;
  }
  if(st===1){
    return `${d.recurring.map((r,k)=>`<div class="wiz-item">
        <div class="form-row">${wField('Nombre', wText(`recurring.${k}.name`, r.name))}${wField('Monto', wMoney(`recurring.${k}.amount`, r.amount))}</div>
        <div class="form-row">${wField('Día de cobro', wNum(`recurring.${k}.day`, r.day, '1–31'), r.day?'':'Si no lo sabes, déjalo vacío y lo confirmas después.')}${wField('Se cobra en', wSelect(`recurring.${k}.account_id`, r.account_id, accOpts()))}</div>
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">${wSelect(`recurring.${k}.kind`, r.kind, [['suscripcion','Suscripción'],['otro','Otro gasto fijo']])}<button type="button" class="fin-icon-btn" data-wdel="recurring.${k}">Quitar</button></div>
      </div>`).join('')}
      <button type="button" class="btn btn-ghost fin-small-btn" data-wadd="recurring">+ Agregar</button>
      <div class="wiz-sum" id="wizLive">Total fijo al mes: <b>${fmtMoney(wizSubsTotal())}</b></div>`;
  }
  if(st===2){
    const credit = wizAcc(a=>a.kind==='credit');
    if(!credit) return '<div class="fin-hint">No tienes una cuenta de crédito. Puedes crearla en Cuentas y volver a este paso.</div>';
    return `<p class="fin-hint" style="margin:0 0 14px">${escapeHTML(credit.name)}. El límite y lo que debes son cosas distintas.</p>
      <div class="form-row">${wField('Límite de crédito', wMoney('card.limit', d.card.limit))}${wField(`Lo que debes al ${escapeHTML(wizDate())}`, wMoney('card.owed', d.card.owed))}</div>
      <div class="form-row">${wField('Día de corte', wNum('card.cut', d.card.cut, '1–31'))}${wField('Día límite de pago', wNum('card.pay', d.card.pay, '1–31'))}</div>
      <div class="wiz-sum" id="wizLive">${wc(d.card.limit)>0 ? `Uso del límite: <b>${(wc(d.card.owed)*100/wc(d.card.limit)).toFixed(1)}%</b>${wc(d.card.owed)*100/wc(d.card.limit)>30?' · conviene mantenerlo abajo de 30%':''}` : 'Escribe el límite para ver el uso.'}</div>`;
  }
  if(st===3){
    return `${wField('Fecha de corte de estos saldos', wDate('date', d.date), 'Los movimientos se cuentan a partir de aquí.')}
      <div class="form-row">${wField(`Plata · saldo al ${escapeHTML(wizDate())}`, wMoney('balances.plata', d.balances.plata))}${wField(`NU ahorro · saldo al ${escapeHTML(wizDate())}`, wMoney('balances.nu', d.balances.nu))}</div>
      <div class="task-group-label fin-section-label"><span>Fondos en GBM · valor al ${escapeHTML(wizDate())}</span></div>
      ${d.funds.map((f,k)=>`<div class="wiz-item">
        <div class="form-row">${wField('Fondo', wText(`funds.${k}.name`, f.name, 'Nombre del fondo'))}${wField('Clave GBM (opcional)', wText(`funds.${k}.key`, f.key))}</div>
        <div class="form-row">${wField('Valor actual', wMoney(`funds.${k}.value`, f.value))}${wField('Aportado en total', wMoney(`funds.${k}.cost`, f.cost))}</div>
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">${wSelect(`funds.${k}.origin`, f.origin, [['heredado','Heredado'],['propio','Propio']])}<button type="button" class="fin-icon-btn" data-wdel="funds.${k}">Quitar</button></div>
      </div>`).join('')}
      <button type="button" class="btn btn-ghost fin-small-btn" data-wadd="funds">+ Agregar fondo propio</button>
      <div class="fin-hint">Las filas sin nombre se ignoran.</div>`;
  }
  if(st===4){
    const cats = activeCats('expense');
    const total = wizBudgetTotal(), diff = 1200000 - total;
    return `<p class="fin-hint" style="margin:0 0 14px">Tus límites actuales ya vienen puestos. Cámbialos si quieres; vacío = sin presupuesto.</p>
      ${cats.map(c=>`<div class="form-row" style="align-items:end">${wField(escapeHTML(c.name), wMoney(`budget.${c.id}`, d.budget[c.id], WIZ_SUGGESTED[c.name.trim().toLowerCase().split(' ')[0]] ? 'Sugerido '+WIZ_SUGGESTED[c.name.trim().toLowerCase().split(' ')[0]] : '0.00'))}<div></div></div>`).join('')}
      <div class="wiz-sum" id="wizLive">Total: <b>${fmtMoney(total)}</b> · ${diff>=0 ? `te quedan ${fmtMoney(diff)} contra $12,000` : `te pasas ${fmtMoney(-diff)} de $12,000`}</div>`;
  }
  if(st===5){
    const t = wizIncomeTotals();
    d.savings.monthlyBy = d.savings.monthlyBy || {nu:'', viaje:'', futuro:'', gbm:''};
    if(!d.savings.monthly && t.total) d.savings.monthly = centsToInput(Math.round(t.total/2/10000)*10000);
    const pct = t.total ? wc(d.savings.monthly)*100/t.total : 0;
    const mb = d.savings.monthlyBy, plan = wc(mb.nu)+wc(mb.viaje)+wc(mb.futuro)+wc(mb.gbm), goalM = wc(d.savings.monthly);
    return `${wField('Meta de ahorro mensual (monto fijo)', wMoney('savings.monthly', d.savings.monthly), `Tus ingresos totales: ${fmtMoney(t.total)}/mes. Debe quedar entre 30% y 70%.`)}
      <div class="wiz-sum" id="wizLive">Equivale a <b>${pct.toFixed(0)}%</b> de tus ingresos.<br>¿Cuánto va a cada cubeta al mes? <b>${fmtMoney(plan)}</b> de ${fmtMoney(goalM)}${plan===goalM?' ✓':plan<goalM?` · faltan ${fmtMoney(goalM-plan)} por asignar`:` · te pasas ${fmtMoney(plan-goalM)}`}</div>
      <div class="task-group-label fin-section-label"><span>Cubetas</span></div>
      <p class="fin-hint" style="margin:-2px 0 10px">El monto al mes es lo que piensas apartar cada mes. La meta total es opcional. Los ahorros que ya tienes los separas después con "Repartir ahorros".</p>
      <div class="wiz-item"><b>Colchón</b> · vive en NU ahorro. Su meta total se calcula en el paso siguiente.
        <div class="form-row">${wField('Al mes', wMoney('savings.monthlyBy.nu', d.savings.monthlyBy.nu))}<div></div></div></div>
      <div class="wiz-item"><b>Viaje</b> · cajita propia
        <div class="form-row">${wField('Al mes', wMoney('savings.monthlyBy.viaje', d.savings.monthlyBy.viaje))}<div></div></div>
        ${wField(`Saldo al ${escapeHTML(wizDate())}`, wMoney('savings.viaje.balance', d.savings.viaje.balance))}
        ${d.savings.viaje.trips.map((tr,k)=>`<div class="form-row">${wField(k<2?'Viaje grande':'Viaje pequeño', wText(`savings.viaje.trips.${k}.name`, tr.name))}<div class="form-row" style="gap:8px">${wField('Monto', wMoney(`savings.viaje.trips.${k}.amount`, tr.amount))}${wField('Fecha', wDate(`savings.viaje.trips.${k}.date`, tr.date))}</div></div>`).join('')}
        <div class="fin-hint">El saldo de Viaje se reparte entre los viajes por fecha: el más cercano se llena primero.</div></div>
      <div class="wiz-item"><b>Futuro</b> (boda y casa) · cajita propia
        <div class="form-row">${wField(`Saldo al ${escapeHTML(wizDate())}`, wMoney('savings.futuro.balance', d.savings.futuro.balance))}${wField('Al mes', wMoney('savings.monthlyBy.futuro', d.savings.monthlyBy.futuro))}</div>
        <div class="form-row">${wField('Meta total (opcional)', wMoney('savings.futuro.amount', d.savings.futuro.amount))}${wField('Fecha (opcional)', wDate('savings.futuro.date', d.savings.futuro.date))}</div></div>
      <div class="wiz-item"><b>Largo plazo</b> · GBM (cuenta solo lo que tú aportas, no la herencia)
        <div class="form-row">${wField('Al mes', wMoney('savings.monthlyBy.gbm', d.savings.monthlyBy.gbm))}<div></div></div>
        <div class="form-row">${wField('Meta total (opcional)', wMoney('savings.largo.amount', d.savings.largo.amount))}${wField('Fecha (opcional)', wDate('savings.largo.date', d.savings.largo.date))}</div></div>`;
  }
  if(st===6){
    const goal = wizColchonGoal(), have = wc(d.balances.nu);
    const pct = goal ? Math.min(100, have*100/goal) : 0;
    return `<p class="fin-hint" style="margin:0 0 14px">Meta = 3 × (gastos variables ${fmtMoney(wizBudgetTotal())} + fijos ${fmtMoney(wizSubsTotal())}).</p>
      <div class="fin-card"><div class="fin-label">Meta del colchón</div><div class="fin-big">${fmtMoney(goal)}</div>
      <div class="fin-bar"><div class="${pct>=100?'ok':'goal'}" style="width:${pct.toFixed(1)}%"></div></div>
      <div class="fin-sub" id="wizLive">Llevas ${fmtMoney(have)} (${pct.toFixed(0)}%)${goal>have?` · faltan ${fmtMoney(goal-have)}`:' · ¡completo!'}</div></div>
      <div style="margin-top:14px">${wField(`Saldo líquido en NU ahorro al ${escapeHTML(wizDate())}`, wMoney('balances.nu', d.balances.nu), 'Es el mismo saldo del paso 4; si lo cambias aquí, se actualiza allá.')}</div>`;
  }
  if(st===7){
    return `<p class="fin-hint" style="margin:0 0 14px">Son <b>supuestos</b> para proyecciones, no datos reales. Deja vacío lo que no sepas; los puedes cambiar después.</p>
      <div class="form-row">${wField('Inflación anual (%)', wMoney('assume.inflation', d.assume.inflation, 'Ej. 4'))}${wField('Rendimiento esperado anual (%)', wMoney('assume.expected_return', d.assume.expected_return, 'Supuesto'))}</div>
      <div class="form-row">${wField('Edad de retiro', wNum('assume.retirement_age', d.assume.retirement_age, 'Ej. 60'))}${wField('Años para el retiro', wNum('assume.years_to_retirement', d.assume.years_to_retirement, 'Ej. 35'))}</div>`;
  }
  const sm = wizSummary();
  return `<div class="fin-card fin-card-hero"><div class="fin-label">Patrimonio neto al ${escapeHTML(wizDate())}</div><div class="fin-big">${fmtMoney(sm.total)}</div></div>
    <div class="fin-acc-grid" style="margin-top:12px">
      <div class="fin-card"><div class="fin-label">Herencia</div><div class="fin-big">${fmtMoney(sm.her)}</div><div class="fin-sub">Fondos heredados en GBM</div></div>
      <div class="fin-card"><div class="fin-label">Ahorro propio</div><div class="fin-big ${sm.prop<0?'neg':''}">${fmtMoney(sm.prop)}</div><div class="fin-sub">Plata + NU + Viaje + Futuro + fondos propios − tarjeta${sm.loansNet?` ${sm.loansNet>0?'+':'−'} préstamos`:''}</div></div>
    </div>
    <p class="fin-hint" style="margin-top:14px">Al terminar se guardan tus ingresos, fijos, tarjeta, saldos, fondos, presupuesto, metas y supuestos. Puedes volver a este asistente desde ⚙ Configurar.</p>`;
}
function wizValidate(){
  const d = wiz.d, st = wiz.step;
  const money = (v, label, req)=>{ if(v===''||v===null||v===undefined) return req ? `Falta: ${label}` : ''; return parseCents(v)===null ? `Monto inválido: ${label}` : ''; };
  const day = (v, label, req)=>{ if(v===''||v===null||v===undefined) return req ? `Falta: ${label}` : ''; const n=Number(v); return Number.isInteger(n)&&n>=1&&n<=31 ? '' : `${label} debe ser entre 1 y 31`; };
  const errs = [];
  if(st===0){
    if(!d.incomes.length) errs.push('Agrega al menos un ingreso');
    d.incomes.forEach(i=>{ if(!i.name.trim()) errs.push('Falta el nombre de un ingreso'); errs.push(money(i.amount, i.name||'ingreso', true)); if(i.frequency==='mensual'||i.frequency==='quincenal') errs.push(day(i.pay_day, `Día de ${i.name}`, false)); });
    if(!d.incomes.some(i=>i.counts)) errs.push('Marca al menos un ingreso como base para el presupuesto');
  }
  if(st===1) d.recurring.forEach(r=>{ if(!r.name.trim()) errs.push('Falta el nombre de un gasto fijo'); errs.push(money(r.amount, r.name, true)); errs.push(day(r.day, `Día de ${r.name}`, false)); });
  if(st===2 && wizAcc(a=>a.kind==='credit')){ errs.push(money(d.card.limit,'límite de crédito',true)); errs.push(money(d.card.owed,'lo que debes',false)); errs.push(day(d.card.cut,'Día de corte',true)); errs.push(day(d.card.pay,'Día de pago',true)); }
  if(st===3){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(d.date)) errs.push('Elige la fecha de corte');
    errs.push(money(d.balances.plata,'Plata',false)); errs.push(money(d.balances.nu,'NU ahorro',false));
    d.funds.filter(f=>f.name.trim()).forEach(f=>{ errs.push(money(f.value, `valor de ${f.name}`, true)); errs.push(money(f.cost, `aportado de ${f.name}`, false)); });
  }
  if(st===4) Object.values(d.budget).forEach(v=>errs.push(money(v,'presupuesto',false)));
  if(st===5){
    const t = wizIncomeTotals().total;
    const e = money(d.savings.monthly,'meta de ahorro mensual',true); errs.push(e);
    if(!e && t){ const pct = wc(d.savings.monthly)*100/t; if(pct<30||pct>70) errs.push(`La meta debe estar entre 30% y 70% de tus ingresos: entre ${fmtMoney(t*0.3)} y ${fmtMoney(t*0.7)}`); }
    [d.savings.viaje.balance, d.savings.futuro.balance, d.savings.futuro.amount, d.savings.largo.amount, ...d.savings.viaje.trips.map(x=>x.amount), ...Object.values(d.savings.monthlyBy||{})].forEach(v=>errs.push(money(v,'monto',false)));
  }
  if(st===6) errs.push(money(d.balances.nu,'saldo de NU',false));
  if(st===7){
    const num = (v,label,min,max)=>{ if(v==='') return ''; const n=Number(String(v).replace(',','.')); return isFinite(n)&&n>=min&&n<=max ? '' : `${label} fuera de rango`; };
    errs.push(num(d.assume.inflation,'Inflación',0,100)); errs.push(num(d.assume.expected_return,'Rendimiento esperado',-50,100));
    errs.push(num(d.assume.retirement_age,'Edad de retiro',18,100)); errs.push(num(d.assume.years_to_retirement,'Años para el retiro',0,80));
  }
  return errs.filter(Boolean)[0] || '';
}
function renderWizard(){
  const st = wiz.step, last = WIZ_TITLES.length-1;
  document.getElementById('finWizTitle').textContent = WIZ_TITLES[st];
  document.getElementById('finWizStep').textContent = `Paso ${st+1} de ${WIZ_TITLES.length}`;
  const body = document.getElementById('finWizBody');
  body.innerHTML = wizStepHTML();
  body.scrollTop = 0;
  document.getElementById('finWizFooter').innerHTML = `${st>0?'<button type="button" class="btn btn-ghost" id="wizBack">Atrás</button>':''}<span style="flex:1"></span><button type="button" class="btn btn-primary" id="wizNext">${st===last?'Terminar':'Siguiente'}</button>`;
  if(st>0) document.getElementById('wizBack').onclick = ()=>{ wiz.step--; wizSave(); renderWizard(); };
  document.getElementById('wizNext').onclick = async ()=>{
    const err = wizValidate(); if(err){ showToast(err,'error'); return; }
    if(st===last){ await wizFinish(); return; }
    wiz.step++; wizSave(); renderWizard();
  };
}
function wizSetPath(path, val){ const ks=path.split('.'); let o=wiz.d; for(let i=0;i<ks.length-1;i++) o=o[ks[i]]; o[ks[ks.length-1]]=val; wizSave(); }
(function bindWizard(){
  const body = document.getElementById('finWizBody');
  const onInput = e=>{
    const el = e.target; if(!el.dataset || !el.dataset.w) return;
    wizSetPath(el.dataset.w, el.type==='checkbox' ? el.checked : el.value);
    if(el.hasAttribute('data-wrender') || el.dataset.w==='date'){ if(e.type==='change') renderWizard(); return; }
    const live = document.getElementById('wizLive');
    if(live){ const tmp=document.createElement('div'); tmp.innerHTML=wizStepHTML(); const nl=tmp.querySelector('#wizLive'); if(nl) live.innerHTML=nl.innerHTML; }
  };
  body.addEventListener('input', onInput);
  body.addEventListener('change', onInput);
  body.addEventListener('click', e=>{
    const add = e.target.closest('[data-wadd]'), del = e.target.closest('[data-wdel]');
    if(add){
      const k = add.dataset.wadd;
      const blank = {incomes:{name:'', amount:'', frequency:'mensual', counts:false, pay_weekday:'', pay_day:'', account_id:(wizAcc(a=>a.kind==='debit')||{}).id||''},
        recurring:{name:'', amount:'', day:'', kind:'suscripcion', account_id:(wizAcc(a=>a.kind==='credit')||{}).id||''},
        funds:{name:'', key:'', origin:'propio', value:'', cost:''}}[k];
      wiz.d[k].push(blank); wizSave(); renderWizard();
    }
    if(del){
      const [k, i] = del.dataset.wdel.split('.');
      const row = wiz.d[k][Number(i)];
      if(row && row.id) wiz.d.removed[k].push(row.id);
      wiz.d[k].splice(Number(i),1); wizSave(); renderWizard();
    }
  });
  document.getElementById('finWizClose').addEventListener('click', closeWizard);
})();
async function wizFinish(){
  const d = wiz.d;
  const btn = document.getElementById('wizNext'); btn.disabled = true; btn.textContent = 'Guardando…';
  try{
    // 1) Ingresos
    for(const i of d.incomes){
      const cat = await ensureCategory(i.name.trim(), 'income');
      const payload = {name:i.name.trim(), amount_cents:wc(i.amount), frequency:i.frequency, counts_for_budget:!!i.counts,
        pay_weekday: i.frequency==='semanal' && i.pay_weekday!=='' ? Number(i.pay_weekday) : null,
        pay_day: (i.frequency==='mensual'||i.frequency==='quincenal') && i.pay_day ? Number(i.pay_day) : null,
        account_id: i.account_id||null, category_id: cat.id, active:true};
      const row = await upsertRow('income_sources', i.id && fin.incomes.find(x=>x.id===i.id), payload, fin.incomes); i.id = row.id; wizSave();
    }
    for(const id of d.removed.incomes){ await dbPatch('income_sources',{active:false},`?id=eq.${id}`); const x=fin.incomes.find(r=>r.id===id); if(x) x.active=false; }
    // 2) Fijos y suscripciones
    const subsCat = await ensureCategory('Suscripciones','expense');
    for(const r of d.recurring){
      const payload = {name:r.name.trim(), amount_cents:wc(r.amount), day_of_month: r.day?Number(r.day):null, kind:r.kind, account_id:r.account_id||null, category_id: r.kind==='suscripcion'?subsCat.id:null};
      const row = await upsertRow('recurring_items', r.id && fin.recurring.find(x=>x.id===r.id), payload, fin.recurring); r.id = row.id; wizSave();
    }
    for(const id of d.removed.recurring){ await dbDelete('recurring_items',`?id=eq.${id}`); fin.recurring = fin.recurring.filter(x=>x.id!==id); }
    // 3) Tarjeta
    const credit = wizAcc(a=>a.kind==='credit');
    if(credit){
      await upsertRow('card_settings', fin.cards.find(c=>c.account_id===credit.id), {account_id:credit.id, credit_limit_cents:wc(d.card.limit), cut_day:Number(d.card.cut), pay_day:Number(d.card.pay), updated_at:new Date().toISOString()}, fin.cards);
      await setBalanceTo(credit, -wc(d.card.owed));
    }
    // 4) Saldos y fondos
    const plata = wizAcc(a=>a.name==='Plata') || wizAcc(a=>a.kind==='debit');
    const nu = wizAcc(a=>a.name==='NU ahorro');
    if(plata) await setBalanceTo(plata, wc(d.balances.plata));
    if(nu) await setBalanceTo(nu, wc(d.balances.nu));
    const gbm = wizAcc(a=>a.kind==='investment');
    const ms = monthStartStr(0);
    for(const f of d.funds.filter(x=>x.name.trim())){
      const pos = await upsertRow('investment_positions', f.id && fin.positions.find(p=>p.id===f.id), {account_id:gbm?gbm.id:null, fund_name:f.name.trim(), fund_key:f.key.trim()||null, origin:f.origin, cost_basis_cents:wc(f.cost)}, fin.positions);
      f.id = pos.id; wizSave();
      await upsertRow('position_valuations', fin.valuations.find(v=>v.position_id===pos.id && v.month===ms), {position_id:pos.id, month:ms, value_cents:wc(f.value)}, fin.valuations);
    }
    for(const id of d.removed.funds){ await dbPatch('investment_positions',{archived:true},`?id=eq.${id}`); const p=fin.positions.find(x=>x.id===id); if(p) p.archived=true; }
    // 5) Presupuesto
    for(const [catId, v] of Object.entries(d.budget)) await saveBudget(catId, String(v||'').trim());
    // 6) Ahorro: meta mensual, cajitas y metas
    const ahorro = activeCats('savings')[0] || await ensureCategory('Ahorro','savings');
    await saveBudget(ahorro.id, d.savings.monthly);
    const viaje = await ensureAccount('Viaje','savings','NU');
    const futuro = await ensureAccount('Futuro','savings','NU');
    await setBalanceTo(viaje, wc(d.savings.viaje.balance));
    await setBalanceTo(futuro, wc(d.savings.futuro.balance));
    for(const tr of d.savings.viaje.trips){
      if(!wc(tr.amount) || !tr.name.trim()) continue;
      const g = await upsertRow('money_goals', tr.id && fin.goals.find(x=>x.id===tr.id), {name:tr.name.trim(), account_id:viaje.id, target_cents:wc(tr.amount), due_date:tr.date||null}, fin.goals);
      tr.id = g.id; wizSave();
    }
    await upsertGoal('Boda y casa', futuro.id, wc(d.savings.futuro.amount), d.savings.futuro.date);
    const mb = d.savings.monthlyBy || {};
    for(const [acc, v] of [[nu, mb.nu], [viaje, mb.viaje], [futuro, mb.futuro], [gbm, mb.gbm]]){
      if(!acc) continue; const c = wc(v||'');
      if(c!==Number(acc.monthly_target_cents||0)){ await dbPatch('accounts', {monthly_target_cents:c}, `?id=eq.${acc.id}`); acc.monthly_target_cents = c; }
    }
    if(gbm) await upsertGoal('Largo plazo', gbm.id, wc(d.savings.largo.amount), d.savings.largo.date);
    // 7) Colchón
    if(nu) await upsertGoal('Colchón', nu.id, wizColchonGoal(), null);
    // 8) Supuestos
    for(const k of ['inflation','expected_return','retirement_age','years_to_retirement']){
      const v = String(d.assume[k]||'').replace(',','.').trim();
      await setAssumption(k, v==='' ? null : Number(v));
    }
    await setAssumption('setup_completed', Number(localDate().replace(/-/g,'')));
    await setAssumption('start_date', Number(d.date.replace(/-/g,'')));
    try{ localStorage.removeItem(WIZ_KEY); }catch(e){}
    document.getElementById('finWizard').classList.remove('open');
    wiz = null;
    await loadFinance();
    finView = 'home'; renderContent();
    showToast('¡Listo! Tus finanzas quedaron configuradas','success');
  }catch(e){
    btn.disabled = false; btn.textContent = 'Terminar';
    showToast('No se pudo guardar todo: '+finErr(e)+'. Tu avance sigue guardado; intenta de nuevo.','error');
  }
}

// ── FINANZAS v2 (entrega 2): tarjeta, recurrentes, alertas, revisión mensual, CSV ──
let finReviewOffset = 0;
function todayMidnight(){ const t=new Date(); t.setHours(0,0,0,0); return t; }
// Próxima fecha (hoy o después) con ese día del mes; si el mes es más corto, usa su último día.
function nextDateForDay(day, from){
  const f = from || todayMidnight();
  for(let k=0;k<3;k++){
    const d = new Date(f.getFullYear(), f.getMonth()+k, 1);
    const len = new Date(d.getFullYear(), d.getMonth()+1, 0).getDate();
    d.setDate(Math.min(Number(day), len));
    if(d>=f) return d;
  }
  return null;
}
function daysUntil(d){ return Math.round((d - todayMidnight())/86400000); }
function fmtDay(d){ return d.toLocaleDateString('es-MX',{day:'numeric', month:'short'}); }
function inDaysTxt(n){ return n===0 ? 'hoy' : n===1 ? 'mañana' : `en ${n} días`; }
function cardFor(accId){ return fin.cards.find(c=>c.account_id===accId); }
function cardDebt(accId){ return Math.max(0, -accBalance(accId)); }

// Tarjeta dentro de Cuentas
function cardInfoHTML(a){
  const c = cardFor(a.id);
  if(!c) return `<div class="fin-sub">Sin límite ni fechas. <button type="button" class="btn btn-ghost fin-small-btn" data-card-edit="${escapeAttr(a.id)}">Agregar datos</button></div>`;
  const debt = cardDebt(a.id), lim = Number(c.credit_limit_cents)||0, pct = lim ? debt*100/lim : 0;
  const cut = nextDateForDay(c.cut_day), pay = nextDateForDay(c.pay_day);
  return `<div class="fin-bar"><div class="${pct>30?'over':'ok'}" style="width:${Math.min(100,pct).toFixed(1)}%"></div></div>
    <div class="fin-budget-txt ${pct>30?'over':''}">Uso ${pct.toFixed(1)}% de ${fmtMoney(lim)}${pct>30?' · ⚠ arriba de 30%':''}</div>
    <div class="fin-sub">Corte: ${fmtDay(cut)} (día ${c.cut_day}) · Pago: ${fmtDay(pay)} (día ${c.pay_day}, ${inDaysTxt(daysUntil(pay))})</div>`;
}
function openCardModal(accId){
  const a = fin.accounts.find(x=>x.id===accId); if(!a) return;
  const c = cardFor(accId);
  openFinModal(`Tarjeta · ${a.name}`, `
    <div class="form-group"><label class="form-label" for="cardLimit">Límite de crédito</label><input class="form-input fin-money" id="cardLimit" inputmode="decimal" value="${c?centsToInput(c.credit_limit_cents):''}" placeholder="0.00"></div>
    <div class="form-row">
      <div class="form-group"><label class="form-label" for="cardCut">Día de corte</label><input class="form-input fin-money" id="cardCut" inputmode="numeric" maxlength="2" value="${c?c.cut_day:''}" placeholder="1–31"></div>
      <div class="form-group"><label class="form-label" for="cardPay">Día límite de pago</label><input class="form-input fin-money" id="cardPay" inputmode="numeric" maxlength="2" value="${c?c.pay_day:''}" placeholder="1–31"></div>
    </div>
    <div class="fin-hint">Lo que debes se cambia con "Deuda inicial" o con tus movimientos.</div>`,
    `<button type="button" class="btn btn-primary" id="cardSave">Guardar</button>`);
  document.getElementById('cardSave').onclick = async ()=>{
    const lim = parseCents(finVal('cardLimit')), cut = Number(finVal('cardCut')), pay = Number(finVal('cardPay'));
    if(lim===null){ showToast('Escribe el límite','error'); return; }
    if(!(Number.isInteger(cut)&&cut>=1&&cut<=31) || !(Number.isInteger(pay)&&pay>=1&&pay<=31)){ showToast('Los días deben ser entre 1 y 31','error'); return; }
    try{ await upsertRow('card_settings', c, {account_id:accId, credit_limit_cents:lim, cut_day:cut, pay_day:pay, updated_at:new Date().toISOString()}, fin.cards); closeFinModal(); renderContent(); showToast('Tarjeta guardada','success'); }
    catch(e){ showToast('No se pudo guardar: '+finErr(e),'error'); }
  };
}

// Recurrentes
const REC_KIND = {suscripcion:'Suscripción', pago_tarjeta:'Pago de tarjeta', otro:'Gasto fijo'};
function recChargedThisMonth(r){ return fin.tx.some(t=>t.type==='expense' && txInMonth(t,0) && t.note===`Cobro · ${r.name}`); }
function finRecurrentesHTML(){
  const items = fin.recurring.slice().sort((a,b)=>{
    if(!!a.paused!==!!b.paused) return a.paused?1:-1;
    const da = a.day_of_month ? nextDateForDay(a.day_of_month) : null, db = b.day_of_month ? nextDateForDay(b.day_of_month) : null;
    if(!da||!db) return da?-1:db?1:0; return da-db;
  });
  const total = fin.recurring.filter(r=>!r.paused).reduce((s,r)=>s+(Number(r.amount_cents)||0),0);
  return `<div class="fin-month-sum">Total fijo activo: ${fmtMoney(total)} al mes</div>
    <div class="fin-list">${items.length ? items.map(r=>{
      const next = r.day_of_month ? nextDateForDay(r.day_of_month) : null;
      const charged = recChargedThisMonth(r);
      return `<div class="fin-budget-row" style="${r.paused?'opacity:.55':''}">
        <div class="fin-budget-top">
          <div class="fin-budget-name">${escapeHTML(r.name)} <span class="fin-kind">${escapeHTML(REC_KIND[r.kind]||r.kind)}</span></div>
          <span class="fin-tx-amt">${fmtMoney(r.amount_cents)}</span>
        </div>
        <div class="fin-budget-txt">${r.paused ? 'En pausa' : next ? `Próximo cobro: ${fmtDay(next)} (${inDaysTxt(daysUntil(next))})` : 'Día de cobro por confirmar'}${r.account_id?` · ${escapeHTML(accName(r.account_id))}`:''}${charged?' · ✓ registrado este mes':''}</div>
        <div class="fin-acc-actions">
          ${!r.paused && !charged ? `<button type="button" class="btn btn-primary fin-small-btn" data-rec-charge="${escapeAttr(r.id)}">Registrar cobro</button>` : ''}
          <button type="button" class="btn btn-ghost fin-small-btn" data-rec-edit="${escapeAttr(r.id)}">Editar</button>
          <button type="button" class="btn btn-ghost fin-small-btn" data-rec-pause="${escapeAttr(r.id)}">${r.paused?'Reanudar':'Pausar'}</button>
        </div>
      </div>`;
    }).join('') : '<div class="empty"><p>No tienes gastos fijos registrados.</p></div>'}</div>
    <button type="button" class="btn btn-ghost fin-add-btn" id="finNewRec">+ Nuevo gasto fijo</button>`;
}
function openRecurringModal(id){
  const r = id ? fin.recurring.find(x=>x.id===id) : null;
  const v = r || {name:'', amount_cents:0, day_of_month:null, kind:'suscripcion', account_id:(bankAccounts().find(a=>a.kind==='credit')||{}).id, category_id:(activeCats('expense').find(c=>/suscrip/i.test(c.name))||{}).id};
  openFinModal(r ? 'Editar gasto fijo' : 'Nuevo gasto fijo', `
    <div class="form-row">
      <div class="form-group"><label class="form-label" for="recName">Nombre</label><input class="form-input" id="recName" maxlength="40" style="font-size:16px" value="${escapeAttr(v.name)}"></div>
      <div class="form-group"><label class="form-label" for="recAmount">Monto</label><input class="form-input fin-money" id="recAmount" inputmode="decimal" value="${v.amount_cents?centsToInput(v.amount_cents):''}" placeholder="0.00"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label" for="recDay">Día de cobro</label><input class="form-input fin-money" id="recDay" inputmode="numeric" maxlength="2" value="${v.day_of_month||''}" placeholder="1–31 (vacío = por confirmar)"></div>
      <div class="form-group"><label class="form-label" for="recKind">Tipo</label><select class="form-input form-select fin-field" id="recKind">${Object.entries(REC_KIND).map(([k,l])=>`<option value="${k}" ${v.kind===k?'selected':''}>${l}</option>`).join('')}</select></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label" for="recAcc">Se cobra en</label><select class="form-input form-select fin-field" id="recAcc">${optionList(bankAccounts(), v.account_id)}</select></div>
      <div class="form-group"><label class="form-label" for="recCat">Categoría</label><select class="form-input form-select fin-field" id="recCat"><option value="">—</option>${optionList(activeCats('expense'), v.category_id)}</select></div>
    </div>`,
    `${r?'<button type="button" class="btn btn-ghost fin-modal-del" id="recDelete">Eliminar</button>':''}<button type="button" class="btn btn-primary" id="recSave">Guardar</button>`);
  document.getElementById('recSave').onclick = async ()=>{
    const name = finVal('recName'), amount = parseCents(finVal('recAmount')), day = finVal('recDay');
    if(!name){ showToast('Escribe el nombre','error'); return; }
    if(amount===null){ showToast('Escribe un monto válido','error'); return; }
    if(day && !(Number.isInteger(Number(day)) && Number(day)>=1 && Number(day)<=31)){ showToast('El día debe ser entre 1 y 31','error'); return; }
    try{ await upsertRow('recurring_items', r, {name, amount_cents:amount, day_of_month:day?Number(day):null, kind:finVal('recKind'), account_id:finVal('recAcc')||null, category_id:finVal('recCat')||null}, fin.recurring); closeFinModal(); renderContent(); showToast('Guardado','success'); }
    catch(e){ showToast('No se pudo guardar: '+finErr(e),'error'); }
  };
  if(r) document.getElementById('recDelete').onclick = async ()=>{
    if(!confirm(`¿Eliminar "${r.name}"? Los cobros ya registrados no se borran.`)) return;
    try{ await dbDelete('recurring_items', `?id=eq.${r.id}`); fin.recurring = fin.recurring.filter(x=>x!==r); closeFinModal(); renderContent(); }
    catch(e){ showToast('No se pudo eliminar: '+finErr(e),'error'); }
  };
}
async function toggleRecurringPause(id){
  const r = fin.recurring.find(x=>x.id===id); if(!r) return;
  try{ await dbPatch('recurring_items', {paused:!r.paused}, `?id=eq.${id}`); r.paused = !r.paused; renderContent(); }
  catch(e){ showToast('No se pudo actualizar: '+finErr(e),'error'); }
}
function chargeRecurring(id){
  const r = fin.recurring.find(x=>x.id===id); if(!r) return;
  openTxModal(null, {type:'expense', amount:Number(r.amount_cents)||0, category_id:r.category_id, account_id:r.account_id, note:`Cobro · ${r.name}`, title:`Cobro de ${r.name}`});
}

// Próximos pagos (suscripciones y tarjeta)
function upcomingPayments(days){
  const out = [];
  fin.recurring.filter(r=>!r.paused && r.day_of_month && r.kind!=='pago_tarjeta').forEach(r=>{
    const d = nextDateForDay(r.day_of_month); if(d && daysUntil(d)<=days) out.push({name:r.name, amount:Number(r.amount_cents)||0, date:d, sub:accName(r.account_id)});
  });
  fin.cards.forEach(c=>{
    const a = fin.accounts.find(x=>x.id===c.account_id); if(!a || a.archived) return;
    const debt = cardDebt(a.id); const d = nextDateForDay(c.pay_day);
    if(debt>0 && d && daysUntil(d)<=days) out.push({name:`Pago ${a.name}`, amount:debt, date:d, sub:'Deuda actual'});
  });
  return out.sort((a,b)=>a.date-b.date);
}

// Alertas (solo dentro de la app). Se pueden ocultar por el mes.
const ALERTS_KEY = 'finAlertsOff';
function alertsOff(){ try{ const o=JSON.parse(localStorage.getItem(ALERTS_KEY)||'{}'); return o[monthStartStr(0)] || []; }catch(e){ return []; } }
function hideAlert(id){ try{ const o=JSON.parse(localStorage.getItem(ALERTS_KEY)||'{}'); const k=monthStartStr(0); o[k]=[...(o[k]||[]), id]; localStorage.setItem(ALERTS_KEY, JSON.stringify({[k]:o[k]})); }catch(e){} }
// Lo que ya debió llegar de una fuente de ingreso este mes (pagos cuya fecha ya pasó)
function expectedSoFar(s){
  const n = paydaysFrom(s, countFrom(), todayMidnight());
  return n===null ? 0 : n;
}
function expectedSoFarOld(s){
  const a = Number(s.amount_cents)||0, today = todayMidnight();
  if(s.frequency==='semanal'){
    if(s.pay_weekday===null || s.pay_weekday===undefined) return 0;
    let n=0; const d=new Date(today.getFullYear(), today.getMonth(), 1);
    while(d<today){ if(d.getDay()===Number(s.pay_weekday)) n++; d.setDate(d.getDate()+1); }
    return n*a;
  }
  if(!s.pay_day) return 0;
  if(s.frequency==='mensual') return today.getDate()>s.pay_day ? a : 0;
  if(s.frequency==='quincenal') return ((today.getDate()>s.pay_day)?1:0) + ((today.getDate()>s.pay_day+15)?1:0) > 0 ? a*(((today.getDate()>s.pay_day)?1:0)+((today.getDate()>s.pay_day+15)?1:0)) : 0;
  return 0;
}
function finAlerts(){
  const out = [];
  activeCats('expense').forEach(c=>{
    const b = currentBudget(c.id); if(!b) return;
    const lim = Number(b.amount_cents)||0; if(!lim) return;
    const spent = fin.tx.filter(t=>t.type==='expense' && t.category_id===c.id && txInMonth(t,0)).reduce((s,t)=>s+(Number(t.amount_cents)||0),0);
    const pct = spent*100/lim;
    if(pct>=100) out.push({id:`cat100-${c.id}`, level:'over', text:`${c.name}: llegaste al ${Math.round(pct)}% del presupuesto (${fmtMoney(spent)} de ${fmtMoney(lim)})`});
    else if(pct>=80) out.push({id:`cat80-${c.id}`, level:'warn', text:`${c.name}: vas en ${Math.round(pct)}% del presupuesto (${fmtMoney(spent)} de ${fmtMoney(lim)})`});
  });
  fin.cards.forEach(c=>{
    const a = fin.accounts.find(x=>x.id===c.account_id); if(!a || a.archived) return;
    const debt = cardDebt(a.id); if(!debt) return;
    const pay = nextDateForDay(c.pay_day), n = daysUntil(pay);
    if(n<5) out.push({id:`card-${a.id}-${localDate(pay)}`, level:'over', text:`Pago de ${a.name} ${inDaysTxt(n)} (${fmtDay(pay)}): debes ${fmtMoney(debt)}`});
  });
  fin.incomes.filter(s=>s.active && s.counts_for_budget && s.category_id).forEach(s=>{
    const due = expectedSoFar(s), rec = receivedInMonth(s.category_id);
    if(due>rec) out.push({id:`inc-${s.id}-${due}`, level:'warn', text:`${s.name}: ya debió llegar ${fmtMoney(due)} este mes y has registrado ${fmtMoney(rec)}. Si ya te pagaron, usa "Ya lo recibí".`});
  });
  const off = alertsOff();
  return out.filter(a=>!off.includes(a.id));
}
function alertsHTML(){
  const al = finAlerts();
  if(!al.length) return '';
  return `<div class="fin-alerts">${al.map(a=>`<div class="fin-alert ${a.level}"><span>${escapeHTML(a.text)}</span><button type="button" class="fin-icon-btn" data-alert-hide="${escapeAttr(a.id)}" title="Ocultar este mes" aria-label="Ocultar este mes">✕</button></div>`).join('')}</div>`;
}

// Hoy: ingreso base contra gasto, excedente, tasa de ahorro real y próximos pagos
function homeExtraHTML(){
  const {inc, exp} = monthTotals(0);
  const base = fin.incomes.filter(s=>s.active && s.counts_for_budget).reduce((t,s)=>t+sourceMonthly(s,false),0);
  const saved = savedInMonth(0);
  const rate = inc>0 ? saved*100/inc : null;
  const stats = base ? `<div class="fin-card" style="margin-top:12px"><div class="fin-stats">
      <div><div class="fin-label">Ingreso base</div><div class="fin-mid">${fmtMoney(base)}</div><div class="fin-sub">al mes</div></div>
      <div><div class="fin-label">Gasto del mes</div><div class="fin-mid">${fmtMoney(exp)}</div><div class="fin-sub">${base?Math.round(exp*100/base)+'% del ingreso base':''}</div></div>
      <div><div class="fin-label">Excedente</div><div class="fin-mid ${base-exp<0?'neg':'pos'}">${fmtMoney(base-exp)}</div><div class="fin-sub">base − gastos</div></div>
      <div><div class="fin-label">Tasa de ahorro real</div><div class="fin-mid">${rate===null?'—':rate.toFixed(0)+'%'}</div><div class="fin-sub">${fmtMoney(saved)} ahorrado de ${fmtMoney(inc)} recibido</div></div>
    </div></div>` : '';
  const up = upcomingPayments(7);
  const upHTML = up.length ? `<div class="task-group-label fin-section-label"><span>Próximos pagos (7 días)</span></div>
    <div class="fin-list">${up.map(p=>`<div class="fin-tx" style="cursor:default"><div class="fin-tx-main"><div class="fin-tx-title">${escapeHTML(p.name)}</div><div class="fin-tx-sub">${fmtDay(p.date)} · ${inDaysTxt(daysUntil(p.date))} · ${escapeHTML(p.sub)}</div></div><div class="fin-tx-amt expense">${fmtMoney(p.amount)}</div></div>`).join('')}</div>` : '';
  return stats + upHTML;
}

// Revisión mensual: capturar saldos reales del cierre y valores de fondos
function accBalanceBefore(id, endExclusive){
  const a = fin.accounts.find(x=>x.id===id);
  let b = Number(a && a.opening_balance_cents)||0;
  for(const t of fin.tx){
    if(t.occurred_on >= endExclusive) continue;
    const amt = Number(t.amount_cents)||0;
    if(t.account_id===id) b += t.type==='income' ? amt : -amt;
    if(t.type==='transfer' && t.to_account_id===id) b += amt;
  }
  return b;
}
function netDepositsInMonth(accId, offset){
  let n = 0;
  for(const t of fin.tx){ if(t.type!=='transfer' || !txInMonth(t,offset)) continue; if(t.to_account_id===accId) n += Number(t.amount_cents)||0; if(t.account_id===accId) n -= Number(t.amount_cents)||0; }
  return n;
}
function monthStats(off){
  const {inc, exp} = monthTotals(off); const saved = savedInMonth(off);
  return {inc, exp, saved, rate: inc>0 ? saved*100/inc : null};
}
function finRevisionHTML(){
  const off = finReviewOffset, ms = monthStartStr(off), end = monthStartStr(off+1);
  const accs = bankAccounts().filter(a=>!accPositions(a.id).length);
  const funds = fin.positions.filter(p=>!p.archived);
  const cur = monthStats(off), prev = monthStats(off-1);
  const cmp = (a,b,fmt,goodUp=true)=>{ if(a===null||b===null) return '<span class="fin-sub">—</span>'; const d=a-b; const good = goodUp ? d>=0 : d<=0; return `<span style="color:${d===0?'var(--text3)':good?'var(--green)':'var(--red)'}">${d>0?'▲':d<0?'▼':'='} ${fmt(Math.abs(d))}</span>`; };
  const pctF = v=>v.toFixed(0)+' pts';
  const snapFor = id=>fin.snapshots.find(s=>s.account_id===id && s.month===ms);
  const valFor = p=>fin.valuations.find(v=>v.position_id===p.id && v.month===ms);
  return `<div class="fin-month-nav">
      <button type="button" class="btn btn-ghost" data-rev-month="-1" aria-label="Mes anterior">‹</button>
      <span>Revisión · ${escapeHTML(monthLabel(off))}</span>
      <button type="button" class="btn btn-ghost" data-rev-month="1" aria-label="Mes siguiente" ${off>=0?'disabled':''}>›</button>
    </div>
    <div class="fin-card"><div class="fin-stats">
      <div><div class="fin-label">Ingresos</div><div class="fin-mid">${fmtMoney(cur.inc)}</div><div class="fin-sub">${cmp(cur.inc, prev.inc, fmtMoney)} vs mes anterior</div></div>
      <div><div class="fin-label">Gastos</div><div class="fin-mid">${fmtMoney(cur.exp)}</div><div class="fin-sub">${cmp(cur.exp, prev.exp, fmtMoney, false)} vs mes anterior</div></div>
      <div><div class="fin-label">Ahorrado</div><div class="fin-mid">${fmtMoney(cur.saved)}</div><div class="fin-sub">${cmp(cur.saved, prev.saved, fmtMoney)} vs mes anterior</div></div>
      <div><div class="fin-label">Tasa de ahorro</div><div class="fin-mid">${cur.rate===null?'—':cur.rate.toFixed(0)+'%'}</div><div class="fin-sub">${cmp(cur.rate, prev.rate, pctF)} vs mes anterior</div></div>
    </div></div>
    <div class="task-group-label fin-section-label"><span>Saldos reales al cierre</span></div>
    <div class="fin-hint" style="margin:-2px 0 10px">Copia el saldo de la app de cada banco. Si no coincide con el calculado, te falta registrar algún movimiento.</div>
    <div class="fin-list">${accs.map(a=>{
      const calc = accBalanceBefore(a.id, end), credit = a.kind==='credit', s = snapFor(a.id);
      const val = s ? (credit ? -Number(s.balance_cents) : Number(s.balance_cents)) : (credit ? Math.max(0,-calc) : calc);
      const diff = s ? Number(s.balance_cents) - calc : null;
      return `<div class="fin-budget-row"><div class="fin-budget-top">
          <div class="fin-budget-name">${escapeHTML(a.name)} <span class="fin-kind">${credit?'Deuda':escapeHTML(ACC_KIND[a.kind]||a.kind)}</span></div>
          <input class="form-input fin-money fin-rev-input" data-rev-acc="${escapeAttr(a.id)}" inputmode="decimal" autocomplete="off" value="${centsToInput(val)}">
        </div>
        <div class="fin-budget-txt">Calculado: ${fmtMoney(credit?Math.max(0,-calc):calc)}${diff===null?'':diff===0?' · ✓ cuadra':` · <span style="color:var(--amber)">diferencia ${fmtMoney(credit?-diff:diff)}</span>`}${s?' · guardado':''}</div></div>`;
    }).join('')}</div>
    ${funds.length ? `<div class="task-group-label fin-section-label"><span>Fondos (valor al cierre)</span></div>
    <div class="fin-list">${funds.map(p=>{ const v=valFor(p); const prevV=positionValue(p, off-1); const shown = v ? Number(v.value_cents) : (positionValue(p, off) || 0);
      return `<div class="fin-budget-row"><div class="fin-budget-top">
          <div class="fin-budget-name">${escapeHTML(p.fund_name)} <span class="fin-kind">${p.origin==='heredado'?'Heredado':'Propio'}</span></div>
          <input class="form-input fin-money fin-rev-input" data-rev-pos="${escapeAttr(p.id)}" inputmode="decimal" autocomplete="off" value="${centsToInput(shown)}">
        </div><div class="fin-budget-txt">${prevV===null?'Sin valor del mes anterior':`Mes anterior: ${fmtMoney(prevV)}`}${v?' · guardado':''}</div></div>`; }).join('')}</div>` : ''}
    <button type="button" class="btn btn-primary fin-add-btn" id="finSaveReview">Guardar revisión de ${escapeHTML(monthLabel(off))}</button>`;
}
async function saveReview(){
  const off = finReviewOffset, ms = monthStartStr(off);
  const btn = document.getElementById('finSaveReview'); btn.disabled = true;
  try{
    for(const inp of document.querySelectorAll('[data-rev-acc]')){
      const a = fin.accounts.find(x=>x.id===inp.dataset.revAcc); const c = parseCents(inp.value.trim()||'0');
      if(c===null){ showToast(`Monto inválido en ${a.name}`,'error'); btn.disabled=false; return; }
      const value = a.kind==='credit' ? -c : c;
      await upsertRow('balance_snapshots', fin.snapshots.find(s=>s.account_id===a.id && s.month===ms), {account_id:a.id, month:ms, balance_cents:value, net_deposits_cents:netDepositsInMonth(a.id, off)}, fin.snapshots);
    }
    for(const inp of document.querySelectorAll('[data-rev-pos]')){
      const p = fin.positions.find(x=>x.id===inp.dataset.revPos); const c = parseCents(inp.value.trim()||'0');
      if(c===null){ showToast(`Monto inválido en ${p.fund_name}`,'error'); btn.disabled=false; return; }
      await upsertRow('position_valuations', fin.valuations.find(v=>v.position_id===p.id && v.month===ms), {position_id:p.id, month:ms, value_cents:c}, fin.valuations);
    }
    // cuentas de inversión con fondos: guardar también su total del mes para el historial
    for(const a of bankAccounts().filter(x=>accPositions(x.id).length)){
      const total = accPositions(a.id).reduce((s,p)=>{ const v=fin.valuations.find(x=>x.position_id===p.id && x.month===ms); return s + (v?Number(v.value_cents):0); },0);
      await upsertRow('balance_snapshots', fin.snapshots.find(s=>s.account_id===a.id && s.month===ms), {account_id:a.id, month:ms, balance_cents:total, net_deposits_cents:netDepositsInMonth(a.id, off)}, fin.snapshots);
    }
    renderContent(); showToast('Revisión guardada','success');
  }catch(e){ btn.disabled = false; showToast('No se pudo guardar: '+finErr(e),'error'); }
}

// Exportar CSV (UTF-8 con BOM para Excel)
function downloadCSV(filename, rows){
  const esc = v=>{ let s = v===null||v===undefined ? '' : String(v); if(/^[=+@\t\r]/.test(s)) s = "'"+s; return /[",\r\n;]/.test(s) ? '"'+s.replace(/"/g,'""')+'"' : s; };
  const csv = '﻿' + rows.map(r=>r.map(esc).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], {type:'text/csv;charset=utf-8'}));
  const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 2000);
  return csv;
}
const csvNum = c=>((Number(c)||0)/100).toFixed(2);
function exportMovsCSV(){
  const list = fin.tx.filter(t=>txInMonth(t, finMonthOffset)).slice().sort((a,b)=>a.occurred_on<b.occurred_on?-1:1);
  const rows = [['Fecha','Tipo','Categoría','Cuenta','Cuenta destino','Monto (MXN)','Nota']];
  list.forEach(t=>rows.push([t.occurred_on, TX_TYPES[t.type]||t.type, t.type==='transfer'?'':catName(t.category_id), accName(t.account_id), t.to_account_id?accName(t.to_account_id):'', (t.type==='expense'?'-':'')+csvNum(t.amount_cents), t.note||'']));
  return downloadCSV(`movimientos-${monthStartStr(finMonthOffset).slice(0,7)}.csv`, rows);
}
function exportPatrimonioCSV(){
  const rows = [['Sección','Concepto','Tipo','Valor (MXN)','Aportado (MXN)','Rendimiento (MXN)']];
  let her=0, prop=0;
  fin.positions.filter(p=>!p.archived).forEach(p=>{ const v=positionValue(p)||0, c=Number(p.cost_basis_cents)||0; if(p.origin==='heredado') her+=v; else prop+=v;
    rows.push([p.origin==='heredado'?'Herencia':'Ahorro propio', p.fund_name, 'Fondo'+(p.fund_key?' '+p.fund_key:''), csvNum(v), csvNum(c), csvNum(v-c)]); });
  bankAccounts().filter(a=>!accPositions(a.id).length).forEach(a=>{ const v=accBalance(a.id); prop+=v; rows.push(['Ahorro propio', a.name, ACC_KIND[a.kind]||a.kind, csvNum(v), '', '']); });
  activeAccounts().filter(isLoan).forEach(l=>{ const o=loanStats(l).owed; if(o>0){ const v=l.kind==='lent'?o:-o; prop+=v; rows.push(['Ahorro propio', l.name, l.kind==='lent'?'Te debe':'Le debes', csvNum(v), '', '']); } });
  rows.push([]); rows.push(['Total','Herencia','',csvNum(her)]); rows.push(['Total','Ahorro propio','',csvNum(prop)]); rows.push(['Total','Patrimonio neto','',csvNum(her+prop)]);
  return downloadCSV(`patrimonio-${localDate()}.csv`, rows);
}

// ── Cubetas de ahorro y reparto de ahorros ya existentes ──
function bucketAccounts(){ return bankAccounts().filter(a=>a.kind==='savings' || a.kind==='investment'); }
// Lo que le metiste este mes a una cuenta (sin contar repartos de ahorro que ya tenías)
function bucketInMonth(accId, offset=0){
  let n = 0;
  for(const t of fin.tx){
    if(t.type!=='transfer' || t.is_allocation || !txInMonth(t,offset)) continue;
    if(t.to_account_id===accId) n += Number(t.amount_cents)||0;
    if(t.account_id===accId) n -= Number(t.amount_cents)||0;
  }
  return n;
}
function bucketsHTML(){
  const bs = bucketAccounts();
  if(!bs.length) return '';
  const plan = bs.reduce((s,a)=>s+(Number(a.monthly_target_cents)||0),0);
  const goal = savingsGoal();
  return `<div class="task-group-label fin-section-label" style="margin-top:0"><span>Cubetas · este mes</span><button type="button" class="btn btn-primary fin-small-btn" data-fin-allocate>Repartir ahorros</button></div>
    <div class="fin-list">${bs.map(a=>{
      const target = Number(a.monthly_target_cents)||0, inM = bucketInMonth(a.id);
      const pct = target>0 ? inM*100/target : 0;
      const inv = a.kind==='investment' && accPositions(a.id).length;
      return `<div class="fin-budget-row"><div class="fin-budget-top">
          <div class="fin-budget-name">${escapeHTML(a.name)}</div>
          <button type="button" class="fin-limit ${target?'':'empty'}" data-acc-monthly="${escapeAttr(a.id)}" title="Cuánto al mes">${target?fmtMoney(target)+'/mes':'Sin monto al mes'}</button>
        </div>
        ${target ? `<div class="fin-bar"><div class="${savingsClass(pct)}" style="width:${Math.max(0,Math.min(100,pct)).toFixed(1)}%"></div></div>` : ''}
        <div class="fin-budget-txt">Este mes: ${fmtMoney(inM)}${target?` de ${fmtMoney(target)} (${Math.round(pct)}%)${pct>=100?' · ✓':''}`:''} · ${inv ? `aportado propio ${fmtMoney(Math.max(0,accBalance(a.id)))}` : `saldo ${fmtMoney(accountValue(a.id))}`}</div>
      </div>`;
    }).join('')}</div>
    <div class="fin-hint">${goal ? `Suma de cubetas: ${fmtMoney(plan)}/mes · meta de ahorro mensual: ${fmtMoney(goal)}${plan!==goal?` (${plan<goal?'faltan '+fmtMoney(goal-plan)+' por asignar':'te pasas '+fmtMoney(plan-goal)})`:' ✓'}` : `Suma de cubetas: ${fmtMoney(plan)}/mes`}. "Repartir ahorros" mueve dinero que ya tenías y no cuenta como ahorro del mes.</div>`;
}
function editAccMonthlyInline(btn){
  const a = fin.accounts.find(x=>x.id===btn.dataset.accMonthly); if(!a) return;
  const inp = document.createElement('input');
  inp.className = 'form-input fin-limit-input'; inp.inputMode = 'decimal'; inp.placeholder = 'Al mes'; inp.autocomplete = 'off';
  inp.value = Number(a.monthly_target_cents) ? centsToInput(a.monthly_target_cents) : '';
  btn.replaceWith(inp); inp.focus(); inp.select();
  let done = false;
  const commit = async (save)=>{
    if(done) return; done = true;
    if(save){
      const c = inp.value.trim()==='' ? 0 : parseCents(inp.value.trim());
      if(c===null) showToast('Escribe un monto válido','error');
      else if(c!==Number(a.monthly_target_cents)){
        try{ await dbPatch('accounts', {monthly_target_cents:c}, `?id=eq.${a.id}`); a.monthly_target_cents = c; }
        catch(e){ showToast('No se pudo guardar: '+finErr(e),'error'); }
      }
    }
    renderContent();
  };
  inp.addEventListener('keydown', e=>{ if(e.key==='Enter'){ e.preventDefault(); commit(true); } else if(e.key==='Escape') commit(false); });
  inp.addEventListener('blur', ()=>commit(true));
}
function openAllocateModal(){
  const sources = bankAccounts().filter(a=>a.kind!=='credit');
  const from0 = (sources.find(a=>a.name==='Plata') || sources.find(a=>a.kind==='debit') || sources[0] || {}).id;
  const nuId = (fin.accounts.find(a=>a.name==='NU ahorro')||{}).id;
  const colchon = fin.goals.find(g=>g.name==='Colchón');
  const rowsHTML = from=>bucketAccounts().filter(a=>a.id!==from).map(a=>{
    const hint = a.id===nuId && colchon && Number(colchon.target_cents) ? ` · al colchón le faltan ${fmtMoney(Math.max(0, Number(colchon.target_cents)-goalCurrent(colchon)))}` : '';
    return `<div class="form-group"><label class="form-label" for="alloc-${escapeAttr(a.id)}">${escapeHTML(a.name)} <span style="color:var(--text3)">· tiene ${fmtMoney(a.kind==='investment'&&accPositions(a.id).length?Math.max(0,accBalance(a.id)):accountValue(a.id))}${escapeHTML(hint)}</span></label>
      <input class="form-input fin-money" id="alloc-${escapeAttr(a.id)}" data-alloc="${escapeAttr(a.id)}" inputmode="decimal" autocomplete="off" placeholder="0.00"></div>`;
  }).join('');
  openFinModal('Repartir ahorros', `
    <p class="fin-hint" style="margin:0 0 14px">Para separar dinero que <b>ya tenías</b> en tus cubetas. Haz lo mismo en tus bancos (por ejemplo, pasar de Plata a la cajita Viaje). No cuenta como ahorro del mes.</p>
    <div class="form-row">
      <div class="form-group"><label class="form-label" for="allocFrom">Sale de</label><select class="form-input form-select fin-field" id="allocFrom">${optionList(sources, from0)}</select></div>
      <div class="form-group"><label class="form-label" for="allocDate">Fecha</label><input type="date" class="form-input" id="allocDate" value="${localDate()}"></div>
    </div>
    <div id="allocRows">${rowsHTML(from0)}</div>
    <div class="wiz-sum" id="allocSum"></div>`,
    `<button type="button" class="btn btn-primary" id="allocSave">Repartir</button>`);
  const sum = ()=>{
    const from = finVal('allocFrom');
    let total = 0, bad = false;
    document.querySelectorAll('[data-alloc]').forEach(i=>{ const v=i.value.trim(); if(!v) return; const c=parseCents(v); if(c===null) bad=true; else total+=c; });
    const left = accountValue(from) - total;
    document.getElementById('allocSum').innerHTML = bad ? 'Revisa los montos.' : `Total a repartir: <b>${fmtMoney(total)}</b> · ${escapeHTML(accName(from))} queda en <b style="color:${left<0?'var(--red)':'inherit'}">${fmtMoney(left)}</b>`;
    return {total, bad, left};
  };
  document.getElementById('allocFrom').onchange = ()=>{ document.getElementById('allocRows').innerHTML = rowsHTML(finVal('allocFrom')); sum(); };
  document.getElementById('finModalBody').addEventListener('input', sum);
  sum();
  document.getElementById('allocSave').onclick = async ()=>{
    const from = finVal('allocFrom'), date = finVal('allocDate'), st = sum();
    if(st.bad){ showToast('Revisa los montos','error'); return; }
    if(!st.total){ showToast('Escribe cuánto va a cada cubeta','error'); return; }
    if(st.left<0 && !confirm(`${accName(from)} quedaría en ${fmtMoney(st.left)}. ¿Repartir de todos modos?`)) return;
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date)){ showToast('Elige la fecha','error'); return; }
    const btn = document.getElementById('allocSave'); btn.disabled = true;
    try{
      for(const i of document.querySelectorAll('[data-alloc]')){
        const c = i.value.trim() ? parseCents(i.value.trim()) : 0; if(!c) continue;
        const [row] = await dbPost('transactions', {type:'transfer', amount_cents:c, account_id:from, to_account_id:i.dataset.alloc, occurred_on:date, note:'Reparto de ahorro', category_id:null, is_allocation:true});
        fin.tx.push(row);
      }
      sortTx(); closeFinModal(); renderContent(); showToast('Ahorros repartidos','success');
    }catch(e){ btn.disabled = false; showToast('No se pudo guardar: '+finErr(e),'error'); }
  };
}


// ── Montaje en la app nueva ──
// view: home | movs | accounts | patrimonio | recurrentes | loans | budget | goals | revision
export async function mount(el, view, isCurrent = () => true) {
  mountEl = el;
  if (view && FIN_TABS[view]) finView = view;
  el.innerHTML = '<div class="loading"><div class="spinner"></div><p>Cargando finanzas...</p></div>';
  await loadFinance();
  if (!isCurrent()) return;
  renderFinance(el);
}
export function unmount() { mountEl = null; const f = document.getElementById('finFab'); if (f) f.classList.remove('show'); }
export function openSetup() { openWizard(); }
export { FIN_TABS };
