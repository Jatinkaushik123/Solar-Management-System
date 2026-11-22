-- Trusted project-operator rehearsal only. In the same SQL request, set
-- solar.qa_quotes to a Postgres UUID array containing exactly two fresh quotes
-- created by checkout-hosted.mjs with a site starting "M4 synthetic fulfilment "
-- or "M5 synthetic service ".
-- Run only after the HTTP check confirms the gateway is unavailable.
do $test$
declare ids uuid[] := current_setting('solar.qa_quotes')::uuid[];
    f record; a jsonb; synthetic_id text;
begin
    if cardinality(ids)<>2 or ids[1]=ids[2] or (
        select count(*) from solar_private.quotes q join solar_private.enquiries e on e.id=q.enquiry_id
        join solar_private.sites s on s.id=e.site_id join auth.users u on u.id=e.customer_id
        where q.id=any(ids) and q.state='accepted' and e.requirements='QA accepted rooftop'
        and (s.address like 'M4 synthetic fulfilment %' or s.address like 'M5 synthetic service %')
        and u.email like '%@identity.sunpower.test'
        and not exists(select 1 from solar_private.checkout_attempts c where c.quote_id=q.id)
        and exists(select 1 from solar_private.order_lines(q) l where l.item_id='DEMO-INVERTER' and l.quantity=1)
    )<>2 then raise exception 'Expected two unused synthetic fixture quotes'; end if;
    for f in select q.id,e.customer_id from solar_private.quotes q join solar_private.enquiries e on e.id=q.enquiry_id
        where q.id=any(ids) order by q.id loop
        a:=public.solar_checkout_begin(f.customer_id,f.id,'advance',gen_random_uuid());
        synthetic_id:='FULFILQA'||replace((a->>'id'),'-','');
        perform public.solar_checkout_bind((a->>'id')::uuid,'order_'||synthetic_id,'rzp_test_fixture');
        perform public.solar_payment_observe((a->>'id')::uuid,null,jsonb_build_object(
            'orderId','order_'||synthetic_id,'paymentId','pay_'||synthetic_id,'amountPaise',(a->>'amount_paise')::bigint,
            'currency','INR','status','captured'));
        if not exists(select 1 from solar_private.sales_orders o where o.quote_id=f.id) then
            raise exception 'Synthetic capture did not confirm an order';
        end if;
    end loop;
end $test$;
select e.serial_no as enquiry_number, e.customer_id, o.id as order_id, p.id as pick_list_id, w.id as work_order_id
from solar_private.sales_orders o join solar_private.quotes q on q.id=o.quote_id
join solar_private.enquiries e on e.id=q.enquiry_id join solar_private.pick_lists p on p.order_id=o.id
join solar_private.installation_work_orders w on w.order_id=o.id
where q.id=any(current_setting('solar.qa_quotes')::uuid[])
order by e.serial_no;
