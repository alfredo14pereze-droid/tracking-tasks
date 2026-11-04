# TaskTracker v2

Rediseño con tema claro en `/v2/`. **No modifica** `index.html`, `service-worker.js` ni las tablas
existentes. Mockup aprobado: https://claude.ai/artifact/MF6JxKFjrLfreUh93XYZCz

- Sin build, ES modules. `js/app.js` = sesión + router por hash (`#inicio #tareas #finanzas #salud #mas`…).
- `js/db.js` = mismo proyecto de Supabase y misma sesión que v1 (misma clave en localStorage).
- `js/fin.js` = cálculos de finanzas **portados de v1** (saldo, patrimonio, ahorro, presupuesto que se
  repite, metas). Si cambia una fórmula en v1, cambiarla aquí también.
- Patrones de v1: optimista + rollback + toast, `escapeHTML`, inputs ≥16px, `min-width:0`, sin desborde a 375px.
- v2 no registra service worker.

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
5. Claude: sugerencias y análisis (ver plan).

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
