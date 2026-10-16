-- Client apps table: maps Firebase app UUIDs to bilingual display names.
-- Used by the "Link Client App" dropdown in TaskDetailModal.

create table if not exists public.client_apps (
  id          uuid        primary key default gen_random_uuid(),
  app_id      text        not null,
  app_name    text        not null,
  app_name_en text        not null,
  created_at  timestamptz not null default now()
);

alter table public.client_apps enable row level security;

-- Dashboard members (authenticated) can read; writes are migration-only
create policy "client_apps_select" on public.client_apps
  for select to authenticated using (true);

-- Seed all known client app IDs with Hebrew + English names
insert into public.client_apps (app_id, app_name, app_name_en) values
  ('9c8cde47-0edf-4b64-beb2-0def32fc9532', 'אהלא וסהלא',          'Ahlan Wasahlan'),
  ('8309101e-85e1-4057-a8cc-b8da82508580', 'Aliza Goldberg',        'Aliza Goldberg'),
  ('bb20e1bf-6ae4-406b-b0bf-925dd3ea0095', 'Cognetica Ex',          'Cognetica Ex'),
  ('d251fe9a-7b17-400e-b8f9-87041ae5615b', 'קורסילנד',              'Course Land'),
  ('25480d4b-21b6-4904-91f8-426033bb2297', 'DBT Academy',           'DBT Academy'),
  ('c0c9f9fa-5510-4469-ac6f-210000934026', 'אשמן היום השמיני',      'Eight Day (Ashman)'),
  ('b2dfcee0-5ae1-43d8-84ee-ae89bcf75d81', 'Excellent Training',    'Excellent Training'),
  ('842560c3-3418-44a9-b231-935e21360a7f', 'תנ"ך ישראלי',           'Israeli Bible'),
  ('25b5a434-eb59-4aec-b9cd-36825f5e8537', 'מדרש ישראלי',           'Israeli Midrash'),
  ('1ddd4f75-1cb5-4e3a-9f53-74839979ad33', 'נשמת חיים',             'Living Soul'),
  ('f2e70e68-40a4-4958-9752-224cea7d74ad', 'קהילה לומדת',           'Learning Community'),
  ('57bdd7e4-862a-4e51-ac32-63b59dd403f7', 'DYO APP',               'DYO App (Light Sync)'),
  ('5b7b2c22-cb0f-473b-9558-cfebd3376f56', 'One Heart',             'One Heart'),
  ('9765feab-63b5-4a79-a57a-88f58b7c7d1d', 'הכריש הורוד',           'Pink Shark'),
  ('9765feab-63b5-4a79-a57a-88f58b7c7d1d', 'אלפא. בוא להיות.',      'Springer Teaching'),
  ('6a2046cc-dd00-4d6b-af91-127952a5894e', 'רואי גרין',             'Roi Green'),
  ('dc06d5f3-be42-4133-a48e-1193b83d8d2d', 'סער בר-און',            'Saar Bar-On'),
  ('7839a934-bbab-48fa-a103-5e6ed6f5c871', 'סטודיו שני',            'Shani Studio'),
  ('2269cff3-1fea-486a-bd29-47e7cd3539e4', 'דרך הבטן',              'Through the Belly'),
  ('2579192d-521a-4f1a-80ec-9577d8d18adb', 'אילמה',                 'Why (Elima)');
