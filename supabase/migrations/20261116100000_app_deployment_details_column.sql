alter table public.tasks add column if not exists deployment_details jsonb;

comment on column public.tasks.deployment_details is
  'Structured app store submission data for tasks on the app_deployment_request board. '
  'Written only by the create-app-deployment-request edge function; never overwritten by the dashboard.';
