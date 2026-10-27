-- Remove the duplicate Pink Shark entry that shared Springer's app_id,
-- causing the UI to auto-select Pink Shark when Springer was linked.
-- Rename Springer Teaching → Alpha with the correct Hebrew name.

delete from public.client_apps
where app_id = '9765feab-63b5-4a79-a57a-88f58b7c7d1d'
  and app_name_en = 'Pink Shark';

update public.client_apps
set app_name    = 'אלפא',
    app_name_en = 'Alpha'
where app_id = '9765feab-63b5-4a79-a57a-88f58b7c7d1d'
  and app_name_en = 'Springer Teaching';
