alter table public.boards
  add column if not exists priorities jsonb not null default '[]'::jsonb;

comment on column public.boards.priorities is
  'Priority definitions for this board, edited in Board Settings.';;
