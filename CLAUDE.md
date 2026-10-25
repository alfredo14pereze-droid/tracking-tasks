# TaskTracker — contexto del proyecto

App personal de tareas de Alfredo (idioma de la UI y del trato: **español**). Un solo usuario, con login por enlace mágico (Supabase Auth).
Producción: https://alfredo14pereze-droid.github.io/tracking-tasks/ · Repo: `alfredo14pereze-droid/tracking-tasks` (rama `main`).

## 1. Qué es
Gestor de tareas diario con: Hoy / Orden del día / Mañana / Todas / Próximas / Sin completar / Calendario / Estadísticas / Completadas, más Objetivos (semana/mes/año), Hábitos (7 botones por día), Tareas rápidas, Recordatorios y Notas. Se usa mucho **desde iPhone (PWA instalada en Safari)** y desde un app de escritorio, así que móvil es prioridad.

## 2. Stack
- **Frontend:** un solo `index.html` (HTML + CSS + JS vanilla, sin build). Única dependencia: `supabase-js@2.45.4` (jsdelivr), usada **solo para la sesión**; los datos siguen con `fetch`. Fuentes: Syne (títulos), DM Sans. Tema oscuro con variables CSS (`--bg…--bg4`, `--accent`, `--teal`, `--purple`, `--red/--amber/--green/--blue` y variantes `-bg`).
- **Backend/DB:** Supabase (Postgres vía PostgREST) llamado directo desde el navegador. Sin servidor propio.
- **Auth (oct-2026):** Supabase Auth por enlace mágico (`signInWithOtp`, flujo implícito) + código opcional (`verifyOtp`). Sin sesión solo se ve `#loginScreen` (`body.auth-locked`). `api()` manda `Authorization: Bearer <access_token>`; la anon key va solo en `apikey`. Todas las tablas tienen `user_id default auth.uid()`; RLS por usuario con la política `"own rows"` (ver `migrations/2026-10-24-auth-*.sql`). Nunca poner service_role en el frontend. Botón "Cerrar sesión" abajo del sidebar. El correo integrado de Supabase tiene límite de pocos envíos por hora.
- **Deploy:** GitHub Pages sirviendo la raíz de `main`. Deploy = `git push`.
- **PWA:** `manifest.json` + `service-worker.js` + `icons/` (ícono con `?v=3` para romper caché de iOS).

## 3. Archivos
| Archivo | Qué hace |
|---|---|
| `index.html` | Toda la app (~2800 líneas): CSS → HTML (sidebar, modales) → JS. El JS está por secciones marcadas con `// ── NOMBRE ──`. |
| `service-worker.js` | Caché `tasktracker-cache-v1`; red primero para GET del mismo origen, cae a caché offline. Ignora no-GET y cross-origin (Supabase nunca pasa por caché). |
| `manifest.json` | Config PWA (standalone, tema `#7c6af7`). |
| `icons/` | `icon-192.png`, `icon-512.png`, `apple-touch-icon.png`. |
| `README.md` | Solo el título. |

**Credenciales:** `SUPABASE_URL` y `SUPABASE_KEY` (anon) están como constantes en `index.html` (~línea 845). No copiarlas a docs ni commits nuevos; si se separa a config, tratarlas como variables de entorno/config externa. La anon key es pública por diseño, pero la seguridad real depende del RLS (hoy abierto).

## 4. Convenciones y decisiones técnicas
- **Acceso a datos:** helpers `api / dbGet / dbPost / dbPatch / dbDelete` sobre PostgREST (`Prefer: return=representation`). Solo CRUD de filas: **el DDL (ALTER/CREATE) lo corre el usuario a mano en el SQL Editor de Supabase**; entregarle el `.sql` listo para pegar. No pedirle ni aceptar cadenas de conexión/credenciales.
- **Actualizaciones optimistas** con rollback + `showToast(...)` en error es el patrón de toda la app. Las cargas de tablas nuevas van en `try/catch` para que la app no se caiga si la tabla aún no existe (`loadGoals`, `loadReminders`, `loadQuickTasks`…).
- **Navegación:** `setView(view)` + `renderContent()`. Vistas "especiales" (calendar, stats, missed, goals, habits, order, quick, reminders, notes) ocultan la barra de filtros. Cada grupo del sidebar tiene su `<nav id="...Nav">` con listener propio.
- **Tareas recurrentes (decisión sept-2026):** se guardan **una fila por ocurrencia**. `checkRecurring()` rellena 7 días hacia adelante al cargar. Hay índice único parcial `tasks_recurring_unique_occurrence (title, due_date) where is_recurring`. `dedupeRecurring()` colapsa series en Todas/Próximas/categorías (NO en Hoy/Mañana/Sin completar). Recurrencia: `daily|weekly|weekdays|monthly` (legado) y `custom:0,2,4` (días de semana).
- **Estados de tarea:** `todo | in_progress | done | missed` (CHECK `tasks_status_check`). Prioridad: `critical | high | medium | low` (CHECK `tasks_priority_check`); se muestra como insignia pequeña (no pinta toda la tarjeta); orden por `PRIORITY_RANK`.
- **Hoy:** criterio en `isTodayTask()`. Las recurrentes van en su propia sección "🔄 Tareas recurrentes" (arriba de "Sin fecha"); la sección desplegable "⚡ Tareas rápidas" va hasta arriba.
- **Orden del día (oct-2026):** solo tareas con `due_date === hoy`; orden manual en `tasks.day_order`; arrastre con **Pointer Events** (funciona en iPhone). Regla clave: **no reinsertar en el DOM el nodo arrastrado** (el navegador suelta el pointer capture); se mueven los vecinos y los listeners van en `document`.
- **Hábitos:** `habit_weeks.days int[]` (0=lunes…6=domingo) + `count` sincronizado; filas viejas solo tienen `count`. Semana = lunes (`weekKey()`).
- **Objetivos:** vencimiento por `created_at` vs. periodo actual (`goalExpired`); "renovar" reescribe `created_at`; archivo de completados con un botón (sin pestaña nueva).
- **Notas:** mosaico en JS (`layoutNotes`, máx. 2 columnas, 1 en móvil); cada nota recuerda su columna (`noteColOf`) para no saltar al editar. Edición en el lugar (textarea sin caja, autoajustable).
- **Calendario:** vista Mes (cuadrícula desde domingo) y Semana, con "Incluir completadas" y día saturado (≥5 pendientes).
- **Móvil (lecciones):** `html/body{overflow-x:hidden}`; hijos de flex/grid con `min-width:0`; inputs ≥16px (iOS hace zoom si no); inputs `date/time` con alto explícito (42px); acciones de tarjeta con hover-reveal; el modal de tarea va centrado.
- **UI:** cambios pequeños y quirúrgicos; no rediseñar sin que se pida. Fecha/Hora apilados con el mismo ancho que Título.
- Siempre escapar texto de usuario con `escapeHTML` / `escapeAttr` al armar HTML.
- **Finanzas (oct-2026):** sección aparte con selector Tareas/Finanzas (`currentSection`, `setSection`, `syncSectionUI`; barra inferior en móvil, `.section-switch` arriba en escritorio). `renderContent()` desvía a `renderFinance()` si `currentSection==='finance'`; `setView()` regresa a Tareas. Vistas en `finView`: `home|movs|accounts|budget|goals` (pestañas `.fin-tabs`). Datos en el objeto `fin` (`loadFinance()` carga cada tabla en try/catch). Montos en centavos: `parseCents()` (sin flotantes) / `fmtMoney()` (`Intl` es-MX MXN). Saldo = `opening_balance_cents` + ingresos − gastos − transf. salientes + transf. entrantes (`accBalance`); en crédito la deuda = −saldo y la deuda inicial se guarda negativa. Un modal genérico `#finModal` (`openFinModal`). Categorías se archivan (`archived`), no se borran. **Préstamos:** cada préstamo es una cuenta `kind` `lent` (te deben) o `borrowed` (debes); prestar/cobrar/abonar = transferencias con la cuenta real (no cuentan como gasto); "solo registrar" usa `opening_balance_cents`; perdonar = gasto/ingreso sin categoría en la cuenta del préstamo; liquidar = `archived`. `loanStats()` calcula prestado/pagado/falta. `bankAccounts()` excluye préstamos. **Meta de ahorro:** categorías `kind='savings'` (p. ej. "Ahorro"); su budget es una meta mensual con colores invertidos (rojo <80%, amarillo 80–99%, verde ≥100%). Ahorrado = transferencias hacia cuentas savings/investment desde otras − las que salen (`savedInMonth`); rendimientos y movimientos NU↔GBM no cuentan. Tarjeta "Ahorrado este mes" en Hoy. **Historial de inversiones:** `balance_snapshots` (month día 1, balance_cents, net_deposits_cents); rendimiento del mes = valor − valor anterior − depósitos netos (`snapshotRows`).

### Tablas Supabase
`tasks` (title, priority, status, due_date, due_time, end_date, category, is_recurring, recurrence, estimated_minutes, position, completed_at, **day_order**), `subtasks`, `projects` (categorías), `goals` (title, period, status, is_critical, completed_at, position), `habits` (title, target_per_week), `habit_weeks` (habit_id FK cascade, week_key, count, **days**, unique(habit_id, week_key)), `reminders`, `notes` (title, content), `quick_tasks` (title, done, completed_at). Todas las migraciones pendientes ya fueron aplicadas por el usuario (verificado 2026-10-24). Finanzas: `accounts` (name, kind debit|credit|savings|investment|cash, institution, opening_balance_cents, sort_order, archived), `categories` (name, kind expense|income, color, archived), `transactions` (type expense|income|transfer, amount_cents>0, account_id, to_account_id solo en transfer, category_id, occurred_on, note), `budgets` (category_id, month = día 1, amount_cents; unique(category_id, month)), `money_goals` (name, target_cents, due_date, account_id, monthly_contribution_cents, saved_cents, archived), `balance_snapshots` (historial mensual de inversiones). `accounts` también tiene `due_date` y `note` (para préstamos). El `.sql` original de finanzas no está en el repo; `migrations/2026-10-24-finanzas-verificacion.sql` muestra el esquema. Migraciones nuevas van en `migrations/AAAA-MM-DD-nombre.sql` y las corre el usuario a mano.

## 5. Estado
**Hecho:** todas las vistas listadas arriba; PWA con ícono; recurrentes personalizadas; hábitos por día; calendario mes/semana; tareas rápidas (sección en Hoy + vista propia); Orden del día con arrastre; notas en mosaico con edición en el lugar; "Duplicar para mañana"; "No completada" vs "Pasar a mañana"; objetivos críticos/archivo.
**En progreso:** nada abierto.
**Pendiente / ideas:** que "Orden del día" incluya o no tareas vencidas (hoy se excluyen; pendiente de confirmar con el usuario); guardar migraciones SQL en el repo; textos legales/privacidad (se pidió una vez, quedó sin ejecutar al no aclarar el sitio).

## 6. Problemas conocidos
- **PWA en iPhone:** la PWA instalada no comparte sesión con Safari; el enlace del correo abre en Safari. Para entrar desde la PWA usar el código (`{{ .Token }}` en las plantillas de correo de Supabase).
- Al probar en el navegador del panel, cada navegador tiene su propia sesión; los enlaces mágicos son de un solo uso.
- Al probar en local, el navegador integrado puede servir `index.html` en caché: recargar con `?nocache=N` antes de concluir que un arreglo falló.
- Tras desplegar hay retraso de ~30–60 s en GitHub Pages; un re-dupe de recurrentes ocurrió una vez por probar antes de que el deploy estuviera vivo.
- Service workers no registran en el navegador de pruebas; el simulador de iOS no está disponible (sin Xcode completo): la verificación en iPhone real la hace el usuario.
- Probar arrastre con eventos sintéticos no ejercita el *pointer capture*; usar arrastre real del mouse.

## 7. Comandos
```bash
git pull                                   # antes de editar
python3 -m http.server 8765                # servir local → http://localhost:8765/index.html?nocache=1
git add -A && git commit -m "..." && git push origin main   # deploy (GitHub Pages)
# verificar que el deploy ya está vivo (cambiar el texto buscado):
curl -s https://alfredo14pereze-droid.github.io/tracking-tasks/ | grep -c "texto_nuevo"
```
No hay instalación, build ni tests automatizados. Verificación habitual: servidor local + navegador (escritorio y móvil 375×812), comprobar `document.documentElement.scrollWidth === clientWidth` (sin desborde horizontal) y probar contra la DB real **creando filas de prueba y borrándolas** (o restaurando valores) al terminar.
Cuando una función necesite cambio de esquema: entregar el `.sql` al usuario y esperar a que confirme que lo corrió antes de probar contra la DB.
