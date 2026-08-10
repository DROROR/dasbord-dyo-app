-- Temporary circuit breaker. A workflow is stuck in a loop writing this log
-- over and over; making the insert fail stops the execution. Removed as soon
-- as the run is dead.
create or replace function public.block_runaway_logs()
returns trigger
language plpgsql
as $$
begin
  if new.agent_id = 'monthly-request-verification' then
    raise exception 'blocked: runaway loop';
  end if;
  return new;
end;
$$;

drop trigger if exists block_runaway_logs_trg on public.agent_logs;
create trigger block_runaway_logs_trg
  before insert on public.agent_logs
  for each row execute function public.block_runaway_logs();;
