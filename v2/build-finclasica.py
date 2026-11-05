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
# --- ahorro: pagar una tarjeta desde tu ahorro no es "desahorrar" (el gasto ya contó al comprar) ---
sub("""    if(t.type!=='transfer' || t.is_allocation || !txInMonth(t,offset)) continue;
    const from = isSavingsAcc(t.account_id), to = isSavingsAcc(t.to_account_id);""",
"""    if(t.type!=='transfer' || t.is_allocation || !txInMonth(t,offset)) continue;
    if(fin.accounts.some(a=>(a.id===t.to_account_id || a.id===t.account_id) && (a.kind==='credit' || isLoan(a)))) continue; // (v2)
    const from = isSavingsAcc(t.account_id), to = isSavingsAcc(t.to_account_id);""")
# --- ingresos: los que no tienen día fijo se esperan completos; siempre hay botón para registrar ---
sub("""    if(st && st>first && src.frequency!=='semanal') return 0; // sin día conocido y empezaste este mes: ya estaba en tus saldos
""", "")
sub("""          <div class="fin-tx-sub">${rem>0 ? (x.received>0 ? `Recibido ${fmtMoney(x.received)} · faltan ${fmtMoney(rem)}` : `Esperado ${fmtMoney(x.expected)}`) : `✓ Recibido ${fmtMoney(x.received)}`}</div></div>
        ${rem>0 ? `<button type="button" class="btn btn-primary fin-small-btn" data-income-receive="${escapeAttr(x.cat.id)}">Ya lo recibí</button>` : '<span class="fin-tx-amt income">✓</span>'}""",
"""          <div class="fin-tx-sub">${!x.expected && !x.received ? 'Monto variable · regístralo cuando llegue' : rem>0 ? (x.received>0 ? `Recibido ${fmtMoney(x.received)} · faltan ${fmtMoney(rem)}` : `Esperado ${fmtMoney(x.expected)}`) : `✓ Recibido ${fmtMoney(x.received)}`}</div></div>
        <button type="button" class="btn ${rem>0 || !x.expected ? 'btn-primary' : 'btn-ghost'} fin-small-btn" data-income-receive="${escapeAttr(x.cat.id)}">${rem>0 ? 'Ya lo recibí' : !x.expected ? 'Registrar pago' : 'Otro pago'}</button>""")

sub("""function expectedIncomes(){
  const srcs = fin.incomes.filter(x=>x.active);""", """function expectedIncomes(){
  const srcs = fin.incomes.filter(x=>x.active && ownedPct(fin.accounts.find(a=>a.id===x.account_id))===100); // (v2) el pago del carro no es ingreso tuyo""")

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
import { cardStatus as v2CardStatus } from './fin.js';

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
