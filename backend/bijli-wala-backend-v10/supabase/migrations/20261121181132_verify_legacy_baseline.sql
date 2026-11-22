-- Verify the existing installation before recording its four historical versions.
-- On a fresh database, the four preceding migrations create these objects.
do $baseline$
declare
    expected text;
begin
    foreach expected in array array[
        'advances', 'catalogue_packages', 'catalogue_parts', 'commissioning',
        'crew_assignments', 'crew_jobs', 'job_costs', 'jobs', 'orders',
        'pick_lists', 'quote_parts', 'quotes', 'serialized_units',
        'service_tickets', 'shipments'
    ] loop
        if to_regclass(format('solar_app.%I', expected)) is null then
            raise exception 'Legacy baseline is missing solar_app.%', expected;
        end if;
    end loop;
    if to_regclass('solar_app.orders_confirmed_at_idx') is null
        or to_regprocedure('solar_app.protect_closed_ticket()') is null then
        raise exception 'Legacy reporting migration is incomplete';
    end if;
end
$baseline$;
