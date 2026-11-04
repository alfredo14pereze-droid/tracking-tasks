// Hábitos: marcar un día de la semana (compartido entre Inicio y Objetivos y hábitos).
// Igual que toggleHabitDay de la versión clásica: habit_weeks.days (0=lunes…6=domingo) + count.
import { dbPost, dbPatch } from './db.js?v=202611041440';
import { weekKey, showToast } from './util.js?v=202611041440';

export const habitCount = w => !w ? 0 : Array.isArray(w.days) ? w.days.length : (w.count || 0);

// data = { weeks: [...] } (se modifica en el lugar). again() vuelve a pintar.
export async function toggleHabitDay(data, habitId, dayIdx, again) {
  const wk = weekKey();
  data.weeks = data.weeks || [];
  let row = data.weeks.find(w => String(w.habit_id) === String(habitId) && w.week_key === wk);
  const prevDays = row && Array.isArray(row.days) ? [...row.days] : [];
  const days = prevDays.includes(dayIdx) ? prevDays.filter(d => d !== dayIdx) : [...prevDays, dayIdx].sort((a, b) => a - b);
  if (row) {
    const prev = { days: row.days, count: row.count };
    row.days = days; row.count = days.length; again();
    if (String(row.id).startsWith('temp-')) return;
    try { await dbPatch('habit_weeks', { days, count: days.length }, `?id=eq.${row.id}`); }
    catch { row.days = prev.days; row.count = prev.count; again(); showToast('No se pudo actualizar el hábito', 'error'); }
  } else {
    row = { id: 'temp-' + Date.now(), habit_id: habitId, week_key: wk, days, count: days.length };
    data.weeks.push(row); again();
    try { const [c] = await dbPost('habit_weeks', { habit_id: habitId, week_key: wk, days, count: days.length }); Object.assign(row, c); }
    catch { data.weeks = data.weeks.filter(w => w !== row); again(); showToast('No se pudo guardar el hábito', 'error'); }
  }
}
