-- Recordatorio el día anterior: la tarea aparece en Hoy, en "🔔 Mañana", un día antes de su fecha.
alter table tasks add column if not exists remind_day_before boolean not null default false;
