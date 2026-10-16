alter table tasks
  add column if not exists title_en       text,
  add column if not exists description_en text;
