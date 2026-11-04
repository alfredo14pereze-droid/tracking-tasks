# TaskTracker v2

Rediseño con tema claro en `/v2/`. **Desde el 3-nov-2026 es la página oficial:** la raíz (`index.html`)
redirige aquí y la versión anterior quedó en `clasica/` (enlace "Versión clásica" en la barra lateral y en Más).
Mockup aprobado: https://claude.ai/artifact/MF6JxKFjrLfreUh93XYZCz

- Sin build, ES modules. `js/app.js` = sesión + router por hash (`#inicio #tareas #finanzas #salud #mas`…).
- `js/db.js` = mismo proyecto de Supabase y misma sesión que v1 (misma clave en localStorage).
- `js/fin.js` = cálculos de finanzas **portados de v1** (saldo, patrimonio, ahorro, presupuesto que se
  repite, metas). Si cambia una fórmula en v1, cambiarla aquí también.
- Patrones de v1: optimista + rollback + toast, `escapeHTML`, inputs ≥16px, `min-width:0`, sin desborde a 375px.
- v2 no registra service worker.
- **Antes de cada commit de v2:** `sh v2/bump-version.sh` (pone el mismo `?v=` en todos los imports e index.html;
  sin esto el navegador mezcla archivos viejos y nuevos durante los 10 min de caché de GitHub Pages).

## Fases
1. ✅ Shell + Inicio (tareas y hábitos en solo lectura).
2. ✅ Finanzas sobre las **tablas de v1** (decisión 2026-11-03: no se crean `fin_*`).
   Captura de Apple Pay: `sql/2026-11-03-captura-wallet.sql` crea `capture_tokens`, `wallet_captures`
   y la función `capture_wallet_tx(p_token, p_amount, p_merchant, p_card)` (security definer, valida
   el hash del token). El Atajo de iOS la llama con la anon key. La cuenta se elige buscando el
   nombre/institución de la cuenta dentro del nombre de la tarjeta; si no hay coincidencia, la
   captura queda "por revisar" en Finanzas.
   `sql/2026-11-03-captura-tarjetas.sql` agrega `capture_card_accounts`: al elegir la cuenta de un pago
   por revisar, la app guarda tarjeta → cuenta y la función la usa primero en los siguientes pagos.
3. ✅ Ejercicio + metas de actividad + Whoop (`sql/2026-11-03-ejercicio-whoop.sql`).
   - Tablas `ex_exercises`, `ex_routines`, `ex_routine_items` (series/reps/descanso por lugar),
     `ex_item_options` (varias opciones de ejercicio por lugar; position 0 = principal), `ex_workouts`,
     `ex_sets`, `body_metrics`, `activity_goals`. Rutinas base (Push/Pull/Pierna/Full) y catálogo se crean
     desde la app (`seedRoutines` en `js/salud.js`), no en el SQL.
   - Progresión (`suggestion`): completó todas las series al máximo del rango → +2.5 kg; dos fallas seguidas
     con el mismo peso → −10 % (redondeado a 2.5). "Hoy toca" = siguiente rutina en el orden, tras la última terminada.
   - Whoop: Edge Function `supabase/functions/whoop/index.ts` (OAuth + sync a `whoop_daily` y `whoop_workouts`).
     Los tokens viven en `whoop_tokens` sin políticas RLS (solo la función con service role). La app
     sincroniza al abrir Salud si pasaron más de 2 h. Metas semanales combinan entrenos de v2 + entrenos de
     Whoop que no se traslapan (±15 min).
4. ✅ Tareas (`js/tareas.js` + `js/views/tareas.js`): port fiel de v1 — Hoy (grupos de v1), Orden del día
   (Pointer Events + flechas), Mañana, Próximas, Sin completar, Todas, Pasadas y categorías; formulario con
   día exacto / fecha límite, recordatorio, "ciertos días" (custom:) y 'monthly' viejo se conserva.
   `checkRecurring()` corre una vez por sesión al abrir Inicio o Tareas (igual que v1; el índice único evita
   duplicados si v1 y v2 corren a la vez). Inicio permite marcar tareas y días de hábitos.
5. ✅ Comidas (pestaña de Salud; `sql/2026-11-04-comidas.sql`): `meals` (día, tiempo desayuno/comida/cena/snack,
   kcal y macros), `diet_goals` (kcal/proteína/carbs/grasa diarias) y columnas nuevas en `body_metrics`
   (cadera, pecho, brazo, muslo). Recetario fijo en `js/recetas.js` (29 ideas con ingredientes, pasos y macros
   aproximados; "Ideas para hoy" rota por día y prioriza proteína si falta). Calorías quemadas = kJ de Whoop ÷ 4.184.
6. ✅ Resto de la clásica (4-nov-2026): Objetivos y hábitos (`views/objetivos.js`, `habitos.js`), Recordatorios,
   Notas, Calendario, Estadísticas y "Agregar a Google Calendar" en tareas. Finanzas avanzada (`#finanzas/<tab>`:
   movs, accounts, patrimonio, recurrentes, loans, budget, goals, revision + asistente) = `js/finclasica.js`,
   GENERADO con `python3 v2/build-finclasica.py .` desde la sección FINANZAS de `clasica/index.html` (misma lógica,
   adaptador mínimo; estilos en `css/finclasica.css` con alcance `.fc`). No editar finclasica.js a mano.
   La clásica ya no está en el menú; `clasica/` queda como respaldo.
7. ✅ Estimar comidas con IA (4-nov-2026): en Comidas › Agregar escribes o dictas (Web Speech, es-MX) lo que comiste;
   la Edge Function `supabase/functions/nutricion` llama a Claude (`claude-opus-5-5`, effort low, salida JSON con
   esquema, `fallbacks: "default"`) y regresa hasta 3 preguntas con opciones o el estimado por alimento + total.
   Secrets: `ANTHROPIC_API_KEY` y `ALLOWED_EMAILS`. Probada con cliente simulado (Node).
8. Claude: sugerencias del gym y análisis de estados de cuenta (pendiente).

## Conectar Whoop (una vez)
1. Corre `sql/2026-11-03-ejercicio-whoop.sql`.
2. En https://developer-dashboard.whoop.com crea una app con los scopes `read:recovery`, `read:cycles`,
   `read:sleep`, `read:workout` (y `offline` si aparece) y el Redirect URL
   `https://citlxgjcshjckxybgist.supabase.co/functions/v1/whoop/callback`.
3. Supabase › Edge Functions › crear función **whoop** pegando `supabase/functions/whoop/index.ts`.
   En su configuración, **apagar "Verify JWT"** (Whoop llama /callback sin sesión; la función valida sola).
4. Supabase › Edge Functions › Secrets: `WHOOP_CLIENT_ID`, `WHOOP_CLIENT_SECRET`,
   `APP_URL` = `https://alfredo14pereze-droid.github.io/tracking-tasks/v2/`. (Opcional `CRON_SECRET` para un cron.)
5. En v2 › Salud › Actividad › **Conectar Whoop**.

Las migraciones de `sql/` las corre Alfredo a mano en el SQL Editor de Supabase.
