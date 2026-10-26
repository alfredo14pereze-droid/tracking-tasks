-- "Avancé hoy": días en que trabajaste en una tarea con fecha límite (sin darla por terminada).
alter table tasks add column if not exists worked_dates date[] not null default '{}';
