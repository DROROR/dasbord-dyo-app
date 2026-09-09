insert into public.boards (id, name, is_default, access, statuses, priorities, created_at)
select
  'app_deployment_request',
  'App Deployment Request',
  true,
  jsonb_object_agg(id::text, 'full'),
  '[]'::jsonb,
  '[]'::jsonb,
  now()
from public.profiles
on conflict (id) do nothing;

update public.boards
set statuses = jsonb_build_array(
  jsonb_build_object(
    'id', 'to_ask',
    'label', 'To Ask',
    'pillCls', 'bg-indigo-100 text-indigo-700',
    'leftBorderCls', 'border-l-indigo-400',
    'canDelete', false,
    'order', 0
  ),
  jsonb_build_object(
    'id', 'in_progress',
    'label', 'In Progress',
    'pillCls', 'bg-blue-100 text-blue-700',
    'leftBorderCls', 'border-l-blue-400',
    'canDelete', true,
    'order', 1
  ),
  jsonb_build_object(
    'id', 'done',
    'label', 'Done',
    'pillCls', 'bg-green-100 text-green-700',
    'leftBorderCls', 'border-l-green-500',
    'canDelete', false,
    'order', 2
  ),
  jsonb_build_object(
    'id', 'archived',
    'label', 'Archive',
    'pillCls', 'bg-gray-100 text-gray-400',
    'leftBorderCls', 'border-l-gray-200',
    'canDelete', false,
    'order', 3
  )
)
where id = 'app_deployment_request';

update public.boards
set priorities = jsonb_build_array(
  jsonb_build_object(
    'id', 'critical', 'label', 'Critical',
    'textCls', 'text-red-600', 'bgCls', 'bg-red-50',
    'dotCls', 'bg-red-500', 'borderCls', 'border-red-200',
    'showInSupportQueue', false
  ),
  jsonb_build_object(
    'id', 'high', 'label', 'High',
    'textCls', 'text-orange-600', 'bgCls', 'bg-orange-50',
    'dotCls', 'bg-orange-500', 'borderCls', 'border-orange-200',
    'showInSupportQueue', false
  ),
  jsonb_build_object(
    'id', 'medium', 'label', 'Medium',
    'textCls', 'text-amber-600', 'bgCls', 'bg-amber-50',
    'dotCls', 'bg-amber-500', 'borderCls', 'border-amber-200',
    'showInSupportQueue', false
  ),
  jsonb_build_object(
    'id', 'low', 'label', 'Low',
    'textCls', 'text-blue-600', 'bgCls', 'bg-blue-50',
    'dotCls', 'bg-blue-400', 'borderCls', 'border-blue-200',
    'showInSupportQueue', false
  )
)
where id = 'app_deployment_request';
