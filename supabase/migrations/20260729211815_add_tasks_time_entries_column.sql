alter table public.tasks add column if not exists time_entries jsonb not null default '[]'::jsonb;;
