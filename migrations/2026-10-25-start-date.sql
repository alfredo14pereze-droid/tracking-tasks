-- Tareas a futuro: fecha de inicio para tareas de rango (start_date + due_date como fecha límite).
alter table tasks add column if not exists start_date date;
create index if not exists tasks_start_date_idx on tasks (start_date);
