# Genera v2/js/finclasica.js y v2/css/finclasica.css a partir de clasica/index.html (sección FINANZAS).
# Uso: python3 build_finclasica.py <repo>
import re, sys, os
repo = sys.argv[1]
src = open(os.path.join(repo, 'clasica/index.html'), encoding='utf-8').read()
lines = src.split('\n')

def find(prefix):
    for i, l in enumerate(lines):
        if l.startswith(prefix): return i
    raise SystemExit('no encontré ' + prefix)

start = find('// ── FINANZAS ──')
end = find('// ── AUTH ──')
code = '\n'.join(lines[start:end])

# --- quitar lo que solo aplica a la página clásica ---
drop = [
    "document.querySelectorAll('[data-section]').forEach(b=>b.addEventListener('click', ()=>setSection(b.dataset.section)));",
]
for d in drop:
    assert code.count(d) == 1, d
    code = code.replace(d, '// (v2) selector Tareas/Finanzas de la clásica: no aplica')
# El tab "home" se llama "Este mes" en la app nueva (el Resumen nuevo es la portada).
assert "home:'Hoy'," in code
code = code.replace("home:'Hoy',", "home:'Este mes',")

# --- cuentas que no son (todo) tuyas: accounts.owned_pct (B-Project 50, Carro 0) ---
def sub(old, new):
    global code
    assert code.count(old) == 1, old
    code = code.replace(old, new)
sub("""    if(accPositions(a.id).length) return; // sus fondos se listan aparte
    const v = accBalance(a.id);
    if(v!==0 || a.kind!=='investment') rows.push({name:a.name, sub:ACC_KIND[a.kind]||a.kind, v});""",
"""    if(accPositions(a.id).length) return; // sus fondos se listan aparte
    const pct = ownedPct(a); if(pct===0) return; // (v2) dinero que cuidas: no es tuyo
    const v = Math.round(accBalance(a.id)*pct/100);
    if(v!==0 || a.kind!=='investment') rows.push({name:a.name, sub:(ACC_KIND[a.kind]||a.kind)+(pct<100?` · tu ${pct}%`:''), v});""")
sub("""function monthTotals(offset=0){
  let inc=0, exp=0;
  for(const t of fin.tx){
    if(!txInMonth(t,offset)) continue;""",
"""function ownedPct(a){ return a && a.owned_pct!==undefined && a.owned_pct!==null ? Number(a.owned_pct) : 100; } // (v2)
function monthTotals(offset=0){
  let inc=0, exp=0;
  for(const t of fin.tx){
    if(!txInMonth(t,offset) || ownedPct(fin.accounts.find(a=>a.id===t.account_id))<100) continue;""")

# --- tarjetas: pago para no generar intereses (corte), no la deuda total; usa cardStatus de fin.js ---
sub("""    const debt = cardDebt(a.id); const d = nextDateForDay(c.pay_day);
    if(debt>0 && d && daysUntil(d)<=days) out.push({name:`Pago ${a.name}`, amount:debt, date:d, sub:'Deuda actual'});""",
"""    const st = v2CardStatus(fin, a); const debt = st ? st.toPay : cardDebt(a.id); const d = st ? st.due : nextDateForDay(c.pay_day);
    if(debt>0 && d && daysUntil(d)<=days) out.push({name:`Pago ${a.name}`, amount:debt, date:d, sub:'Pago para no generar intereses'});""")
sub("""    const debt = cardDebt(a.id); if(!debt) return;
    const pay = nextDateForDay(c.pay_day), n = daysUntil(pay);
    if(n<5) out.push({id:`card-${a.id}-${localDate(pay)}`, level:'over', text:`Pago de ${a.name} ${inDaysTxt(n)} (${fmtDay(pay)}): debes ${fmtMoney(debt)}`});""",
"""    const st = v2CardStatus(fin, a); const debt = st ? st.toPay : cardDebt(a.id); if(!debt) return;
    const pay = st ? st.due : nextDateForDay(c.pay_day), n = daysUntil(pay);
    if(n<5) out.push({id:`card-${a.id}-${localDate(pay)}`, level:'over', text:`Pago de ${a.name} ${inDaysTxt(n)} (${fmtDay(pay)}): paga ${fmtMoney(debt)} para no generar intereses`});""")
# --- ahorro = ingresos − gastos del mes (igual que F.savingsOf de fin.js; no se guarda en ninguna tabla).
# Las transferencias entre tus cuentas (pago de tarjeta, Plata → NU/GBM) no cuentan; lo de crédito cuenta al comprar.
sub("""function savedInMonth(offset=0){
  let s = 0;
  for(const t of fin.tx){
    if(t.type!=='transfer' || t.is_allocation || !txInMonth(t,offset)) continue;
    const from = isSavingsAcc(t.account_id), to = isSavingsAcc(t.to_account_id);
    if(to && !from) s += Number(t.amount_cents)||0;
    else if(from && !to) s -= Number(t.amount_cents)||0;
  }
  return s;
}""", """function savedInMonth(offset=0){ const {inc, exp} = monthTotals(offset); return inc - exp; } // (v2) ahorro = ingresos − gastos""")
sub("""    <div class="fin-label">Ahorrado este mes</div>
    <div class="fin-big ${goal>0&&pct>=100?'pos':''}">${fmtMoney(saved)}</div>""",
"""    <div class="fin-label">${saved<0?'Déficit':'Ahorrado'} en ${escapeHTML(monthLabel(0))}</div>
    <div class="fin-big ${saved<0?'neg':goal>0&&pct>=100?'pos':''}">${fmtMoney(Math.abs(saved))}</div>""")
# --- metas sin cuenta: se llenan con un % del ahorro de cada mes (fin.js) ---
sub("""  if(!g.account_id) return Number(g.saved_cents)||0;
  const acc = fin.accounts.find(a=>a.id===g.account_id);""",
"""  if(!g.account_id) return v2GoalCurrent(fin, g); // (v2) saved_cents + su % del ahorro de cada mes
  const acc = fin.accounts.find(a=>a.id===g.account_id);""")
assert code.count("'Progreso capturado a mano'") == 2
code = code.replace("'Progreso capturado a mano'", "goalAllocTxt(g)")
sub("""<option value="">Ninguna cuenta (lo capturo a mano)</option>""",
"""<option value="">Ninguna cuenta (se llena con un % de mi ahorro)</option>""")
sub("""      <div class="form-group"><label class="form-label" for="goalMonthly">Aportación mensual</label>""",
"""      <div class="form-group"><label class="form-label" for="goalMonthly">Quiero juntar al mes (plan)</label>""")
sub("""      <div class="form-group" id="goalSavedWrap"><label class="form-label" for="goalSaved">Llevo ahorrado</label>
        <input class="form-input fin-money" id="goalSaved" inputmode="decimal" autocomplete="off" placeholder="0.00" value="${g&&Number(g.saved_cents)?centsToInput(g.saved_cents):''}"></div>""",
"""      <div class="form-group" id="goalSavedWrap"><label class="form-label" for="goalPct">% de mi ahorro de cada mes</label>
        <input class="form-input" id="goalPct" inputmode="decimal" autocomplete="off" style="font-size:16px" placeholder="0" value="${g&&v2GoalPct(g)?v2GoalPct(g):''}"></div>""")
sub("""    document.getElementById('goalHint').textContent = hasAcc ? 'El progreso es el saldo de esa cuenta.' : 'El progreso es lo que captures en "Llevo ahorrado".';""",
"""    const free = Math.max(0, 100 - v2PctTaken(fin, g ? g.id : null));
    document.getElementById('goalHint').textContent = hasAcc ? 'El progreso es el saldo de esa cuenta.' : `Cada mes recibe ese % de lo que ahorras (ingresos − gastos); los meses con déficit no le quitan. Libre: ${v2FmtPct(free)}.`;""")
sub("""    const monthlyRaw = finVal('goalMonthly'), savedRaw = finVal('goalSaved');
    const monthly = monthlyRaw==='' ? 0 : parseCents(monthlyRaw);
    const saved = savedRaw==='' ? 0 : parseCents(savedRaw);""",
"""    const monthlyRaw = finVal('goalMonthly'), pctRaw = finVal('goalPct').replace('%','').replace(',','.').trim();
    const monthly = monthlyRaw==='' ? 0 : parseCents(monthlyRaw);
    const accountId = finVal('goalAccount') || null;
    const pct = accountId || pctRaw==='' ? 0 : Math.round(Number(pctRaw)*100)/100;
    if(!(pct>=0 && pct<=100)){ showToast('El % va de 0 a 100','error'); return; }
    if(pct + v2PctTaken(fin, g ? g.id : null) > 100){ showToast(`Entre todas las metas pasan de 100%: te queda ${v2FmtPct(Math.max(0, 100 - v2PctTaken(fin, g ? g.id : null)))}`,'error'); return; }
    const saved = 0;""")
sub("""    const payload = {name, target_cents:target, due_date: finVal('goalDue') || null, account_id: finVal('goalAccount') || null, monthly_contribution_cents:monthly, saved_cents:saved};""",
"""    const payload = {name, target_cents:target, due_date: finVal('goalDue') || null, account_id: accountId, monthly_contribution_cents:monthly, ...v2AllocPatch(fin, g, pct, accountId)};""")

# --- ingresos: los que no tienen día fijo se esperan completos; siempre hay botón para registrar ---
sub("""    if(st && st>first && src.frequency!=='semanal') return 0; // sin día conocido y empezaste este mes: ya estaba en tus saldos
""", "")
sub("""          <div class="fin-tx-sub">${rem>0 ? (x.received>0 ? `Recibido ${fmtMoney(x.received)} · faltan ${fmtMoney(rem)}` : `Esperado ${fmtMoney(x.expected)}`) : `✓ Recibido ${fmtMoney(x.received)}`}</div></div>
        ${rem>0 ? `<button type="button" class="btn btn-primary fin-small-btn" data-income-receive="${escapeAttr(x.cat.id)}">Ya lo recibí</button>` : '<span class="fin-tx-amt income">✓</span>'}""",
"""          <div class="fin-tx-sub">${!x.expected && !x.received ? 'Monto variable · regístralo cuando llegue' : rem>0 ? (x.received>0 ? `Recibido ${fmtMoney(x.received)} · faltan ${fmtMoney(rem)}` : `Esperado ${fmtMoney(x.expected)}`) : `✓ Recibido ${fmtMoney(x.received)}`}</div></div>
        <button type="button" class="btn ${rem>0 || !x.expected ? 'btn-primary' : 'btn-ghost'} fin-small-btn" data-income-receive="${escapeAttr(x.cat.id)}">${rem>0 ? 'Ya lo recibí' : !x.expected ? 'Registrar pago' : 'Otro pago'}</button>""")

sub("""function receivedInMonth(catId, offset=0){ return fin.tx.filter(t=>t.type==='income' && t.category_id===catId && txInMonth(t,offset)).reduce((s,t)=>s+(Number(t.amount_cents)||0),0); }""",
"""function receivedInMonth(catId, offset=0){ return fin.tx.filter(t=>t.type==='income' && t.category_id===catId && (/^income:/.test(t.auto_key||'') ? t.auto_key.slice(-7)===monthStartStr(offset).slice(0,7) : txInMonth(t,offset))).reduce((s,t)=>s+(Number(t.amount_cents)||0),0); } // (v2) mensualidad de varios meses: cuenta en el mes que cubre""")

sub("""function expectedIncomes(){
  const srcs = fin.incomes.filter(x=>x.active);""", """function expectedIncomes(){
  const srcs = fin.incomes.filter(x=>x.active && ownedPct(fin.accounts.find(a=>a.id===x.account_id))===100); // (v2) el pago del carro no es ingreso tuyo""")

sub("""function fmtMoney(c){ return moneyFmt.format((Number(c)||0)/100); }""",
"""function fmtMoney(c){ if(document.documentElement.classList.contains('privacy')) return '$ •••••'; return moneyFmt.format((Number(c)||0)/100); } // (v2) modo privado""")

# --- markup de los modales (igual que la clásica) ---
def block(id_):
    i = next(k for k, l in enumerate(lines) if f'id="{id_}"' in l and 'modal-overlay' in l)
    depth, out = 0, []
    for l in lines[i:]:
        out.append(l)
        depth += l.count('<div') - l.count('</div')
        if depth <= 0: break
    return '\n'.join(out)
markup = block('finWizard') + '\n' + block('finModal')
markup += '\n<button type="button" class="fin-fab" id="finFab" aria-label="Agregar movimiento">+</button>'

prelude = r'''// GENERADO por build_finclasica.py desde clasica/index.html (sección FINANZAS). No editar a mano:
// cambia la clásica o el script y vuelve a generar. Es la misma lógica de la clásica (saldos, tarjetas,
// préstamos, fondos, recurrentes, revisión mensual, asistente) con un adaptador mínimo para la app nueva.
import { dbGet, dbPost, dbPatch, dbDelete } from './db.js';
import { escapeHTML, localDate, showToast as toast } from './util.js';
import { cardStatus as v2CardStatus, goalCurrent as v2GoalCurrent, goalPct as v2GoalPct, fmtPct as v2FmtPct, pctTaken as v2PctTaken, allocPatch as v2AllocPatch, allocThisMonth as v2AllocThisMonth } from './fin.js';
const goalAllocTxt = g => v2GoalPct(g) ? `${v2FmtPct(v2GoalPct(g))} de tu ahorro de cada mes · este mes +${fmtMoney(v2AllocThisMonth(fin, g))}` : 'Sin % de tu ahorro: edítala para que avance';

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
  wrap.innerHTML = MARKUP;
  document.body.appendChild(wrap);
})();
'''.replace('MARKUP', '`' + markup.replace('`', '\\`').replace('${', '\\${') + '`')

epilogue = r'''

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
'''
out = prelude + '\n' + code + epilogue
open(os.path.join(repo, 'v2/js/finclasica.js'), 'w', encoding='utf-8').write(out)

# --- CSS: solo reglas que usan clases presentes en finanzas, con alcance .fc ---
css_start = src.index('<style>') + len('<style>')
css = src[css_start:src.index('</style>', css_start)]
classes = set(re.findall(r'class="([^"$]*)', code + markup))
names = set()
for c in classes:
    names.update(x for x in c.split() if re.match(r'^[a-zA-Z][\w-]*$', x))
names.update(['modal-overlay', 'open', 'show', 'active', 'fin-fab'])

def parse(s):
    """Devuelve lista de (prelude, body) de nivel superior; body es str."""
    out, i, n = [], 0, len(s)
    while i < n:
        j = s.find('{', i)
        if j < 0: break
        pre = s[i:j].strip()
        depth, k = 1, j + 1
        while k < n and depth:
            if s[k] == '{': depth += 1
            elif s[k] == '}': depth -= 1
            k += 1
        out.append((pre, s[j + 1:k - 1]))
        i = k
    return out

def uses(sel):
    toks = set(re.findall(r'\.([a-zA-Z][\w-]*)', sel))
    return bool(toks & names) and not (toks - names - {'done', 'checked', 'neg', 'pos', 'ok', 'warn', 'over', 'goal', 'income', 'expense', 'transfer', 'disabled'}) - names == set() or bool(toks & names)

def scope(sel):
    parts = []
    for p in sel.split(','):
        p = p.strip()
        if not p: continue
        if p.startswith(':root') or p.startswith('html') or p.startswith('body') or p == '*': return None
        parts.append('.fc ' + p)
    return ', '.join(parts)

rules = []
for pre, body in parse(css):
    if pre.startswith('@media') or pre.startswith('@supports'):
        inner = []
        for p2, b2 in parse(body):
            if any(f'.{x}' in p2 for x in names if re.search(r'\.' + re.escape(x) + r'(?![\w-])', p2)):
                sc = scope(p2)
                if sc: inner.append(f'  {sc}{{{b2.strip()}}}')
        if inner: rules.append(pre + '{\n' + '\n'.join(inner) + '\n}')
    elif pre.startswith('@'):
        if pre.startswith('@keyframes'): rules.append(pre + '{' + body + '}')
    else:
        if any(re.search(r'\.' + re.escape(x) + r'(?![\w-])', pre) for x in names):
            sc = scope(pre)
            if sc: rules.append(f'{sc}{{{body.strip()}}}')

theme = '''/* GENERADO por build_finclasica.py: estilos de Finanzas de la clásica con el tema claro. */
.fc{
  --bg:#F4F2EC; --bg2:#FFFFFF; --bg3:#F4F2EC; --bg4:#E6E3DB;
  --border:#EEECE6; --border2:#E6E3DB;
  --text:#17181A; --text2:#5E6066; --text3:#6B6D73;
  --accent:#1F4D3A; --accent2:#1F4D3A; --accent-bg:#DCE8DF;
  --teal:#2E6B4F; --teal-bg:#DCE8DF;
  --green:#2E6B4F; --green-bg:#DCE8DF;
  --amber:#8A6D1A; --amber-bg:#FBF1D6;
  --red:#9A3412; --red-bg:#FCE9DD;
  --blue:#1D4F91; --blue-bg:#E3ECF8;
  --purple:#6B3FA0; --purple-bg:#EEE6F7;
  --radius:16px; --radius-sm:12px;
}
.fc, .fc *{font-family:'Inter Tight', system-ui, -apple-system, sans-serif !important}
'''
tail = '''
/* Ajustes de la app nueva */
.fc .fin-card{background:#fff;border:none;border-radius:20px}
.fc .fin-card-hero{background:var(--accent);color:#fff}
.fc .fin-card-hero .fin-label,.fc .fin-card-hero .fin-sub{color:#CFE0D5}
.fc .fin-card-hero .fin-big{color:#fff}
.fc .fin-tabs{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none;margin:0 -16px 16px;padding:2px 16px}
.fc .fin-tabs::-webkit-scrollbar{display:none}
@media (min-width:900px){.fc .fin-tabs{flex-wrap:wrap;margin:0 0 16px;padding:0}}
.fc .filter-chip{flex:0 0 auto;min-height:40px;padding:0 14px;border-radius:999px;border:1px solid var(--border2);background:#fff;color:var(--text2);font-size:14px;font-weight:500;cursor:pointer;white-space:nowrap}
.fc .filter-chip.active{background:#17181A;border-color:#17181A;color:#fff}
.fc .btn{min-height:44px}
.fc .btn-primary{background:var(--accent);color:#fff;border:none}
.fc .btn-ghost{background:#fff;border:1px solid var(--border2);color:var(--text)}
.fc .form-input{background:var(--bg3);border:1px solid var(--border2);color:var(--text);font-size:16px}
.fc .form-input:focus{border-color:var(--accent);background:#fff}
.fc .modal-overlay{background:rgba(23,24,26,.45)}
.fc .modal{background:#fff;border:none;border-radius:24px;color:var(--text)}
.fc .modal-title{font-size:18px;font-weight:600}
.fc input[type="date"].form-input,.fc input[type="month"].form-input{height:46px}
.fin-fab{display:none;position:fixed;right:16px;bottom:calc(var(--nav-h) + env(safe-area-inset-bottom) + 16px);width:56px;height:56px;border-radius:28px;border:none;background:#17181A;color:#fff;font-size:28px;line-height:1;z-index:40;box-shadow:0 8px 24px rgba(0,0,0,.2);cursor:pointer}
.fin-fab.show{display:block}
@media (min-width:900px){.fin-fab{bottom:24px;right:24px}}
'''
open(os.path.join(repo, 'v2/css/finclasica.css'), 'w', encoding='utf-8').write(theme + '\n'.join(rules) + tail)
print('js', len(out.splitlines()), 'líneas · css', len(rules), 'reglas · clases', len(names))
