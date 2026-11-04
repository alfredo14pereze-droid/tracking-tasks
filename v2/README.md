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
3. Ejercicio · 4. Whoop · 5. Claude (ver plan).

Las migraciones de `sql/` las corre Alfredo a mano en el SQL Editor de Supabase.
