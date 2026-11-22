-- Run with project-operator privileges after the hosted single-inverter rehearsal.
-- Every synthetic gateway fact and business write below is rolled back before commit.
do $test$
declare
    fixture record;
    first_attempt jsonb;
    later_attempt jsonb;
    result jsonb;
    original_order uuid;
    synthetic_id text := replace(gen_random_uuid()::text,'-','');
    facts jsonb;
begin
    select q.id as quote, e.customer_id as owner into strict fixture
    from solar_private.quotes q join solar_private.enquiries e on e.id=q.enquiry_id
    join solar_private.sites s on s.id=e.site_id join auth.users u on u.id=e.customer_id
    where q.state='accepted' and e.requirements='QA accepted rooftop' and s.address='M3 synthetic checkout rehearsal'
      and u.email like '%@identity.sunpower.test' and q.total_paise=16500000 and q.advance_paise=3300000
      and exists(select 1 from solar_private.order_lines(q) l where l.item_id like 'M3-QA-INVERTER-%')
      and not exists(select 1 from solar_private.checkout_attempts c where c.quote_id=q.id)
    order by e.serial_no limit 1;

    begin
        first_attempt:=public.solar_checkout_begin(fixture.owner,fixture.quote,'advance',gen_random_uuid());
        if (first_attempt->>'amount_paise')::bigint<>3300000 then raise exception 'Unexpected advance'; end if;
        perform public.solar_checkout_bind((first_attempt->>'id')::uuid,'order_'||synthetic_id,'rzp_test_qa');
        facts:=jsonb_build_object('paymentId','pay_'||synthetic_id,'orderId','order_'||synthetic_id,'amountPaise',3300000,'currency','INR','status','captured');
        result:=public.solar_payment_observe(null,'qa-'||synthetic_id,facts);
        perform public.solar_payment_observe(null,'qa-'||synthetic_id,facts);
        original_order:=(result#>>'{order,id}')::uuid;
        if result->>'state' is distinct from 'confirmed' or original_order is null or (result->>'remaining_paise')::bigint<>13200000
            or (result#>>'{order,pick_list_id}') is null or (result#>>'{order,work_order_id}') is null then raise exception 'Incomplete fulfilment'; end if;
        later_attempt:=public.solar_checkout_begin(fixture.owner,fixture.quote,'full',gen_random_uuid());
        if (later_attempt->>'amount_paise')::bigint<>13200000 then raise exception 'Unexpected balance'; end if;
        perform public.solar_checkout_bind((later_attempt->>'id')::uuid,'order_b'||synthetic_id,'rzp_test_qa');
        result:=public.solar_payment_observe((later_attempt->>'id')::uuid,null,
            facts||jsonb_build_object('paymentId','pay_b'||synthetic_id,'orderId','order_b'||synthetic_id,'amountPaise',13200000));
        if result->>'state' is distinct from 'confirmed' or (result->>'remaining_paise')::bigint<>0
            or jsonb_array_length(result->'receipts')<>2 or (result#>>'{order,id}')::uuid is distinct from original_order then
            raise exception 'Incorrect balance payment';
        end if;
        raise exception using errcode='ZX003',message='rollback verified synthetic transaction';
    exception when sqlstate 'ZX003' then null;
    end;
    if exists(select 1 from solar_private.checkout_attempts c where c.quote_id=fixture.quote) then raise exception 'Fixture cleanup failed'; end if;
end $test$;
