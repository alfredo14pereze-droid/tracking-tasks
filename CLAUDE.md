# TaskTracker — contexto del proyecto

App personal de tareas de Alfredo (idioma de la UI y del trato: **español**). Un solo usuario, sin login.
Producción: https://alfredo14pereze-droid.github.io/tracking-tasks/ · Repo: `alfredo14pereze-droid/tracking-tasks` (rama `main`).

## 1. Qué es
Gestor de tareas diario con: Hoy / Orden del día / Mañana / Todas / Próximas / Sin completar / Calendario / Estadísticas / Completadas, más Objetivos (semana/mes/año), Hábitos (7 botones por día), Tareas rápidas, Recordatorios y Notas. Se usa mucho **desde iPhone (PWA instalada en Safari)** y desde un app de escritorio, así que móvil es prioridad.

## 2. Stack
- **Frontend:** un solo `index.html` (HTML + CSS + JS vanilla, sin build, sin dependencias). Fuentes: Syne (títulos), DM Sans. Tema oscuro con variables CSS (`--bg…--bg4`, `--accent`, `--teal`, `--purple`, `--red/--amber/--green/--blue` y variantes `-bg`).
- **Backend/DB:** Supabase (Postgres vía PostgREST) llamado directo desde el navegador. Sin servidor propio.
- **Auth:** ninguna. Se usa la *anon key* y las tablas tienen RLS abierto (política `"public access"`).
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

### Tablas Supabase
`tasks` (title, priority, status, due_date, due_time, end_date, category, is_recurring, recurrence, estimated_minutes, position, completed_at, **day_order**), `subtasks`, `projects` (categorías), `goals` (title, period, status, is_critical, completed_at, position), `habits` (title, target_per_week), `habit_weeks` (habit_id FK cascade, week_key, count, **days**, unique(habit_id, week_key)), `reminders`, `notes` (title, content), `quick_tasks` (title, done, completed_at). Todas las migraciones pendientes ya fueron aplicadas por el usuario (verificado 2026-10-24). Los `.sql` de migración **no están en el repo** (se entregaron en el chat); si se agrega una migración nueva, considerar guardarla en `/sql`.

## 5. Estado
**Hecho:** todas las vistas listadas arriba; PWA con ícono; recurrentes personalizadas; hábitos por día; calendario mes/semana; tareas rápidas (sección en Hoy + vista propia); Orden del día con arrastre; notas en mosaico con edición en el lugar; "Duplicar para mañana"; "No completada" vs "Pasar a mañana"; objetivos críticos/archivo.
**En progreso:** nada abierto.
**Pendiente / ideas:** que "Orden del día" incluya o no tareas vencidas (hoy se excluyen; pendiente de confirmar con el usuario); guardar migraciones SQL en el repo; textos legales/privacidad (se pidió una vez, quedó sin ejecutar al no aclarar el sitio).

## 6. Problemas conocidos
- **Seguridad:** sin auth + RLS abierto → cualquiera con la anon key (pública en el JS) puede leer/escribir. Aceptable para uso personal; endurecer si se comparte.
- `taskCardHTML` inserta `t.title` **sin escapar** (riesgo de HTML inyectado desde datos propios); el resto de vistas sí escapa.
- Llamada a `rpc/add_end_date_if_missing` en el init es un resto: falla en silencio (`.catch`), se puede quitar.
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
