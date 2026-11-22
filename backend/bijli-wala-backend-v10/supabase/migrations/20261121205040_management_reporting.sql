create table solar_private.subsidy_events (
    id bigint generated always as identity primary key,
    order_id uuid not null references solar_private.sales_orders,
    status text not null check (status in ('applied','approved','received','rejected')),
    amount_paise bigint not null check (amount_paise between 0 and 1000000000),
    reference text not null,
    actor_id uuid not null references public.solar_profiles,
    recorded_at timestamptz not null default clock_timestamp(),
    check ((amount_paise>0)=(status in ('approved','received'))),
    unique (order_id,status)
);
create index subsidy_events_by_date on solar_private.subsidy_events(recorded_at);
alter table solar_private.subsidy_events enable row level security;
revoke all on solar_private.subsidy_events from public,anon,authenticated,service_role;
create index confirmed_projects_by_date on solar_private.sales_orders(confirmed_at);
create index installation_signoffs_by_date on solar_private.installation_signoffs(signed_at);
create index project_payment_receipts_by_date on solar_private.payment_receipts(credited_at);
create index stock_issues_by_date on solar_private.stock_movements(occurred_at)
    where kind in ('dispatch','service_issue');

create function solar_private.set_material_rate(actor uuid,body jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare item text; cost bigint; result jsonb;
begin
    perform solar_private.fields(body,array['item_id','unit_cost_paise']);
    item:=solar_private.text_field(body,'item_id',120);
    cost:=solar_private.amount(body,'unit_cost_paise',0,1000000000);
    perform 1 from solar_private.stock_items s where s.item_id=item for update;
    if not found then raise sqlstate 'PT404' using message='item_not_found'; end if;
    insert into solar_private.material_rates values(item,cost,actor,clock_timestamp())
    on conflict(item_id) do update set unit_cost_paise=excluded.unit_cost_paise,set_by=excluded.set_by,updated_at=excluded.updated_at
        where material_rates.unit_cost_paise<>excluded.unit_cost_paise;
    select to_jsonb(r) into result from solar_private.material_rates r where r.item_id=item;
    return result;
end $$;
create function solar_private.set_technician_rate(actor uuid,body jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare tech uuid; cost bigint; result jsonb;
begin
    perform solar_private.fields(body,array['technician_id','hourly_paise']);
    tech:=solar_private.text_field(body,'technician_id',36)::uuid;
    cost:=solar_private.amount(body,'hourly_paise',0,1000000000);
    if not solar_private.current_technician(tech) then raise sqlstate 'PT409' using message='technician_unavailable'; end if;
    insert into solar_private.technician_rates values(tech,cost,actor,clock_timestamp())
    on conflict(technician_id) do update set hourly_paise=excluded.hourly_paise,set_by=excluded.set_by,updated_at=excluded.updated_at
        where technician_rates.hourly_paise<>excluded.hourly_paise;
    select to_jsonb(r) into result from solar_private.technician_rates r where r.technician_id=tech;
    return result;
end $$;
create function solar_private.record_material_cost(actor uuid,body jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare target uuid; cost bigint; saved solar_private.movement_costs;
begin
    perform solar_private.fields(body,array['movement_id','unit_cost_paise']);
    target:=solar_private.text_field(body,'movement_id',36)::uuid;
    cost:=solar_private.amount(body,'unit_cost_paise',0,1000000000);
    perform 1 from solar_private.stock_movements m where m.id=target and m.kind in ('dispatch','service_issue') for update;
    if not found then raise sqlstate 'PT404' using message='movement_not_found'; end if;
    insert into solar_private.movement_costs values(target,cost,'recorded_actual',actor,clock_timestamp())
    on conflict do nothing;
    select * into strict saved from solar_private.movement_costs m where m.movement_id=target;
    if saved.unit_cost_paise<>cost then raise sqlstate 'PT409' using message='material_cost_locked'; end if;
    return to_jsonb(saved);
end $$;

create function solar_private.time_view(entry solar_private.technician_time) returns jsonb
language sql stable set search_path='' as $$
    select to_jsonb(entry)||jsonb_build_object('paid_paise',v.paid,'unpaid_paise',entry.earned_paise-v.paid,'currency','INR')
    from (select coalesce(sum(p.amount_paise),0) paid from solar_private.technician_payments p where p.time_id=entry.id) v
$$;
create function solar_private.record_installation_time(actor uuid,target uuid,body jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare report solar_private.installation_reports; entry solar_private.technician_time; minutes integer; day date;
begin
    perform solar_private.fields(body,array['worked_on','minutes']);
    select r.* into report from solar_private.installation_signoffs s
        join solar_private.installation_reports r on r.id=s.report_id where s.work_id=target and r.technician_id=actor;
    if not found then raise sqlstate 'PT409' using message='signed_installation_required'; end if;
    day:=solar_private.case_date(body,'worked_on',solar_private.india_date(report.started_at));
    minutes:=solar_private.amount(body,'minutes',1,10080);
    if day>solar_private.india_date(report.ended_at) then raise sqlstate 'PT400' using message='invalid_date'; end if;
    select * into entry from solar_private.technician_time t where t.installation_report_id=report.id;
    if found then
        if (entry.minutes,entry.worked_on) is distinct from (minutes,day) then raise sqlstate 'PT409' using message='time_locked'; end if;
    else
        entry:=solar_private.log_technician_time(actor,null,report.id,day,minutes);
    end if;
    return solar_private.time_view(entry);
end $$;
create function solar_private.record_technician_pay(actor uuid,body jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare entry solar_private.technician_time; saved solar_private.technician_payments;
    target uuid; amount bigint; ref text; day date; paid bigint;
begin
    perform solar_private.fields(body,array['time_id','amount_paise','reference','paid_on']);
    target:=solar_private.text_field(body,'time_id',36)::uuid;
    amount:=solar_private.amount(body,'amount_paise',1,168000000000);
    ref:=solar_private.text_field(body,'reference',100);
    select * into entry from solar_private.technician_time t where t.id=target for update;
    if not found then raise sqlstate 'PT404' using message='time_not_found'; end if;
    day:=solar_private.case_date(body,'paid_on',entry.worked_on);
    select * into saved from solar_private.technician_payments p where p.time_id=target and p.reference=ref;
    if found then
        if (saved.amount_paise,saved.paid_on) is distinct from (amount,day) then
            raise sqlstate 'PT409' using message='payment_reference_conflict';
        end if;
    else
        select coalesce(sum(p.amount_paise),0) into paid from solar_private.technician_payments p where p.time_id=target;
        if amount>entry.earned_paise-paid then raise sqlstate 'PT409' using message='payment_exceeds_balance'; end if;
        insert into solar_private.technician_payments(time_id,amount_paise,reference,paid_on,recorded_by)
        values(target,amount,ref,day,actor) returning * into saved;
    end if;
    return jsonb_build_object('payment',to_jsonb(saved),'time',solar_private.time_view(entry));
end $$;
create function solar_private.record_subsidy(actor uuid,target uuid,body jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare status_label text; prior solar_private.subsidy_events; saved solar_private.subsidy_events; amount bigint; ref text;
begin
    perform solar_private.fields(body,array['status','amount_paise','reference']);
    status_label:=solar_private.text_field(body,'status',12);
    amount:=solar_private.amount(body,'amount_paise',0,1000000000);
    ref:=solar_private.text_field(body,'reference',100);
    if status_label not in ('applied','approved','received','rejected')
        or (amount>0)<>(status_label in ('approved','received')) then
        raise sqlstate 'PT400' using message='invalid_subsidy';
    end if;
    perform 1 from solar_private.sales_orders o where o.id=target for update;
    if not found then raise sqlstate 'PT404' using message='project_not_found'; end if;
    select * into prior from solar_private.subsidy_events e where e.order_id=target order by e.id desc limit 1;
    if (prior.status,prior.amount_paise,prior.reference)=(status_label,amount,ref) then return to_jsonb(prior); end if;
    if not (case coalesce(prior.status,'not_started') when 'not_started' then status_label='applied'
        when 'applied' then status_label in ('approved','rejected') when 'approved' then status_label='received' else false end) then
        raise sqlstate 'PT409' using message='subsidy_transition_invalid';
    end if;
    insert into solar_private.subsidy_events(order_id,status,amount_paise,reference,actor_id)
    values(target,status_label,amount,ref,actor) returning * into saved;
    return to_jsonb(saved);
end $$;

create function solar_private.management_cmd(cmd text,target uuid,k uuid,body jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid; result jsonb; command_name text:='management_'||cmd;
begin
    if cmd='installation_time' then
        actor:=solar_private.require_role(array['technician']);
        perform 1 from solar_private.installation_work_orders w where w.id=target and w.technician_id=actor for update;
        if not found then raise sqlstate 'PT404' using message='work_order_not_found'; end if;
    else
        actor:=solar_private.require_role(array['admin']);
    end if;
    result:=solar_private.replay(actor,k,command_name,target,body);
    if result is not null then return result; end if;
    case cmd
        when 'material_rate' then result:=solar_private.set_material_rate(actor,body);
        when 'technician_rate' then result:=solar_private.set_technician_rate(actor,body);
        when 'material_cost' then result:=solar_private.record_material_cost(actor,body);
        when 'technician_pay' then result:=solar_private.record_technician_pay(actor,body);
        when 'subsidy' then result:=solar_private.record_subsidy(actor,target,body);
        when 'installation_time' then result:=solar_private.record_installation_time(actor,target,body);
        else raise sqlstate 'PT404' using message='not_found';
    end case;
    return solar_private.remember(actor,k,command_name,target,body,result);
end $$;

create function solar_private.management_report(from_day date,to_day date) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare lo timestamptz; hi timestamptz; metrics jsonb;
begin
    perform solar_private.require_role(array['admin']);
    if from_day is null or to_day is null or not isfinite(from_day) or not isfinite(to_day)
        or from_day>to_day or to_day>'9999-12-31'::date or from_day<'0001-01-01'::date then
        raise sqlstate 'PT400' using message='invalid_period';
    end if;
    lo:=from_day::timestamp at time zone 'Asia/Kolkata';
    hi:=(to_day+1)::timestamp at time zone 'Asia/Kolkata';
    with project_cohort as materialized (
        select o.id,o.quote_id,o.confirmed_at,q.total_paise,s.signed_at,s.report_id
        from solar_private.sales_orders o join solar_private.quotes q on q.id=o.quote_id
        left join solar_private.installation_work_orders w on w.order_id=o.id
        left join solar_private.installation_signoffs s on s.work_id=w.id
        where o.confirmed_at<hi
    ), project_receipts as materialized (
        select a.quote_id,sum(r.amount_paise) total,sum(r.amount_paise) filter(where r.credited_at>=lo) in_period
        from solar_private.payment_receipts r join solar_private.checkout_attempts a on a.id=r.attempt_id
        where r.credited_at<hi group by a.quote_id
    ), project_totals as (
        select count(*) filter(where p.confirmed_at>=lo) jobs_confirmed,
            count(*) filter(where p.signed_at>=lo and p.signed_at<hi) jobs_completed,
            count(*) filter(where p.signed_at is null or p.signed_at>=hi) jobs_unfinished,
            count(*) filter(where p.signed_at>=lo and p.signed_at<hi and not exists(
                select 1 from solar_private.technician_time t where t.installation_report_id=p.report_id)) completed_jobs_without_time,
            coalesce(sum(p.total_paise) filter(where p.confirmed_at>=lo),0) contract_value,
            coalesce(sum(p.total_paise) filter(where p.signed_at>=lo and p.signed_at<hi),0) completed_contract,
            coalesce(sum(p.total_paise-coalesce(r.total,0)),0) outstanding
        from project_cohort p left join project_receipts r on r.quote_id=p.quote_id
    ), invoice_receipts as materialized (
        select c.invoice_id,sum(c.amount_paise) total,sum(c.amount_paise) filter(where c.collected_on>=from_day) in_period
        from solar_private.service_collections c where c.collected_on<=to_day group by c.invoice_id
    ), invoices as (
        select count(*) filter(where i.posted_at>=lo) service_invoices,
            coalesce(sum(i.parts_paise+i.labour_paise) filter(where i.posted_at>=lo),0) billed,
            coalesce(sum(i.parts_paise+i.labour_paise-coalesce(r.total,0)),0) outstanding
        from solar_private.service_invoices i left join invoice_receipts r on r.invoice_id=i.id where i.posted_at<hi
    ), material as (
        select coalesce(sum(-m.delta::numeric*c.unit_cost_paise),0) cost
        from solar_private.movement_costs c join solar_private.stock_movements m on m.id=c.movement_id
        where c.recorded_at>=lo and c.recorded_at<hi
    ), payroll_collections as materialized (
        select p.time_id,sum(p.amount_paise) total,sum(p.amount_paise) filter(where p.paid_on>=from_day) in_period
        from solar_private.technician_payments p where p.paid_on<=to_day group by p.time_id
    ), labour as (
        select coalesce(sum(t.minutes) filter(where t.worked_on>=from_day),0) minutes,
            coalesce(sum(t.earned_paise) filter(where t.worked_on>=from_day),0) cost,
            coalesce(sum(t.earned_paise-coalesce(p.total,0)),0) unpaid
        from solar_private.technician_time t left join payroll_collections p on p.time_id=t.id where t.worked_on<=to_day
    ), subsidy_snapshot as (
        select coalesce(e.status,'not_started') status,count(*) qty from project_cohort p
        left join lateral (select z.status from solar_private.subsidy_events z where z.order_id=p.id and z.recorded_at<hi
            order by z.id desc limit 1) e on true group by coalesce(e.status,'not_started')
    ), subsidy_totals as (
        select coalesce(jsonb_object_agg(status,qty),'{}') stats from subsidy_snapshot
    ), cash as (
        select (select coalesce(sum(in_period),0) from project_receipts) project,
            (select coalesce(sum(in_period),0) from invoice_receipts) service,
            (select coalesce(sum(in_period),0) from payroll_collections) payroll
    )
    select jsonb_build_object(
        'jobs_confirmed',p.jobs_confirmed,'jobs_completed',p.jobs_completed,'jobs_unfinished',p.jobs_unfinished,
        'completed_jobs_without_time',p.completed_jobs_without_time,
        'open_service_tickets',(select count(*) from solar_private.service_tickets t where t.opened_at<hi and (t.closed_at is null or t.closed_at>=hi)),
        'service_invoices',i.service_invoices,
        'contract_value_paise',p.contract_value::text,'completed_contract_value_paise',p.completed_contract::text,
        'billed_service_paise',i.billed::text,'collected_project_paise',c.project::text,
        'collected_service_paise',c.service::text,'collected_paise',(c.project+c.service)::text,
        'outstanding_project_paise',p.outstanding::text,'outstanding_service_paise',i.outstanding::text,
        'outstanding_paise',(p.outstanding+i.outstanding)::text,
        'material_cost_paise',m.cost::text,'labour_cost_paise',l.cost::text,
        'margin_paise',(p.completed_contract+i.billed-m.cost-l.cost)::text,
        'technician_minutes',l.minutes,'technician_paid_paise',c.payroll::text,'technician_unpaid_paise',l.unpaid::text,
        'unpriced_material_movements',(select count(*) from solar_private.stock_movements sm
            left join solar_private.movement_costs mc on mc.movement_id=sm.id and mc.recorded_at<hi
            where sm.kind in ('dispatch','service_issue') and sm.occurred_at>=lo and sm.occurred_at<hi and mc.movement_id is null),
        'subsidy_not_started',coalesce(z.stats->'not_started','0'),
        'subsidy_applied',coalesce(z.stats->'applied','0'),
        'subsidy_approved',coalesce(z.stats->'approved','0'),
        'subsidy_received',coalesce(z.stats->'received','0'),
        'subsidy_rejected',coalesce(z.stats->'rejected','0'),
        'subsidy_received_paise',(select coalesce(sum(z0.amount_paise),0)::text from solar_private.subsidy_events z0
            where z0.status='received' and z0.recorded_at>=lo and z0.recorded_at<hi)
    ) into metrics from project_totals p cross join invoices i cross join material m cross join labour l
        cross join subsidy_totals z cross join cash c;
    return jsonb_build_object('from',from_day,'to',to_day,'timezone','Asia/Kolkata','currency','INR','metrics',metrics);
end $$;

create function solar_private.management_read(resource text,target uuid,after_id uuid,from_day date,to_day date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor uuid; result jsonb; order_key uuid;
begin
    if resource in ('time','own_time') then
        actor:=solar_private.require_role(case when resource='own_time' then array['technician'] else array['admin'] end);
        if (from_day is not null and not isfinite(from_day)) or (to_day is not null and not isfinite(to_day)) or from_day>to_day then
            raise sqlstate 'PT400' using message='invalid_period';
        end if;
        return (select jsonb_build_object('items',coalesce(jsonb_agg(solar_private.time_view(rows.entry) order by rows.id),'[]'))
            from (select t.id,t as entry from solar_private.technician_time t
                where (resource='time' or t.technician_id=actor) and (after_id is null or t.id>after_id)
                and (from_day is null or t.worked_on>=from_day) and (to_day is null or t.worked_on<=to_day)
                order by t.id limit 50) rows);
    end if;
    perform solar_private.require_role(array['admin']);
    if resource='rates' then
        return jsonb_build_object(
            'material_rates',(select coalesce(jsonb_agg(to_jsonb(m) order by m.item_id),'[]') from solar_private.material_rates m),
            'technician_rates',(select coalesce(jsonb_agg(to_jsonb(r) order by r.technician_id),'[]') from solar_private.technician_rates r));
    end if;
    select o.id into order_key from solar_private.sales_orders o where o.id=target and resource='project';
    if not found then raise sqlstate 'PT404' using message='project_not_found'; end if;
    select jsonb_build_object('order_id',p.id,'order_reference','ORD-'||p.id,
        'subsidy',coalesce((select to_jsonb(z) from solar_private.subsidy_events z where z.order_id=p.id order by z.id desc limit 1),
            '{"status":"not_started","amount_paise":0}'::jsonb),
        'subsidy_history',(select coalesce(jsonb_agg(to_jsonb(e) order by e.id),'[]') from solar_private.subsidy_events e where e.order_id=p.id),
        'stock_issues',(select coalesce(jsonb_agg(jsonb_build_object('movement_id',m.id,'item_id',m.item_id,'kind',m.kind,
            'quantity',-m.delta,'occurred_at',m.occurred_at,'service_ticket_id',m.service_ticket_id,
            'cost',case when c.movement_id is not null then to_jsonb(c)||jsonb_build_object('total_paise',-m.delta::bigint*c.unit_cost_paise) end)
            order by m.occurred_at,m.id),'[]') from solar_private.stock_movements m
            left join solar_private.movement_costs c on c.movement_id=m.id
            where m.shipment_id=p.shipment_id or exists(select 1 from solar_private.service_tickets t where t.id=m.service_ticket_id and t.order_id=p.id)),
        'technician_time',(select coalesce(jsonb_agg(solar_private.time_view(x) order by x.worked_on,x.id),'[]')
            from solar_private.technician_time x
            where exists (select 1 from solar_private.installation_reports r where r.id=x.installation_report_id and r.work_id=p.work_id)
                or exists(select 1 from solar_private.service_resolutions r join solar_private.service_tickets t on t.id=r.ticket_id
                    where r.id=x.service_resolution_id and t.order_id=p.id)))
        into result from solar_private.fulfilment_projects p where p.id=order_key;
    return result;
end $$;

revoke all on function solar_private.set_material_rate(uuid,jsonb),solar_private.set_technician_rate(uuid,jsonb),
    solar_private.record_material_cost(uuid,jsonb),solar_private.time_view(solar_private.technician_time),
    solar_private.record_installation_time(uuid,uuid,jsonb),solar_private.record_technician_pay(uuid,jsonb),
    solar_private.record_subsidy(uuid,uuid,jsonb) from public,anon,authenticated,service_role;

create function public.solar_management_report(from_day date,to_day date) returns jsonb
language sql stable security invoker set search_path='' as $$ select solar_private.management_report($1,$2) $$;
create function public.solar_management_read(resource text,target uuid,after_id uuid,from_day date,to_day date) returns jsonb
language sql stable security invoker set search_path='' as $$ select solar_private.management_read($1,$2,$3,$4,$5) $$;
create function public.solar_management_command(cmd text,target uuid,k uuid,body jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select solar_private.management_cmd($1,$2,$3,$4) $$;
revoke all on function public.solar_management_report(date,date),solar_private.management_report(date,date),
    public.solar_management_read(text,uuid,uuid,date,date),solar_private.management_read(text,uuid,uuid,date,date),
    public.solar_management_command(text,uuid,uuid,jsonb),solar_private.management_cmd(text,uuid,uuid,jsonb)
from public,anon,authenticated,service_role;
grant execute on function public.solar_management_report(date,date),solar_private.management_report(date,date),
    public.solar_management_read(text,uuid,uuid,date,date),solar_private.management_read(text,uuid,uuid,date,date),
    public.solar_management_command(text,uuid,uuid,jsonb),solar_private.management_cmd(text,uuid,uuid,jsonb) to authenticated;
