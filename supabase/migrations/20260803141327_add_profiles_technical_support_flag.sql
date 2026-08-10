alter table public.profiles
  add column if not exists is_technical_support boolean not null default false;

comment on column public.profiles.is_technical_support is
  'When true, unclaimed support tickets appear on this user''s personal board.';;
