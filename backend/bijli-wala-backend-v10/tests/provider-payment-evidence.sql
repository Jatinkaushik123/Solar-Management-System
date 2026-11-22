-- Operator read-only evidence. Set solar.qa_success_quote and
-- solar.qa_decline_quote to two fresh Test Mode quote UUIDs in this request.
with targets(label,quote_id) as (
    values ('success',current_setting('solar.qa_success_quote')::uuid),
           ('decline',current_setting('solar.qa_decline_quote')::uuid)
)
select t.label,'ENQ-'||e.serial_no as enquiry,q.id as quote_id,
    (select jsonb_agg(jsonb_build_object('attempt_id',a.id,'provider_order_id',a.provider_order_id,
        'amount_paise',a.amount_paise,'currency',a.currency) order by a.created_at)
     from solar_private.checkout_attempts a where a.quote_id=q.id) as attempts,
    (select jsonb_agg(jsonb_build_object('event_id',v.event_id,'payment_id',v.facts->>'paymentId','status',v.facts->>'status',
         'observed_at',v.observed_at) order by v.observed_at)
     from solar_private.gateway_events v
     join solar_private.checkout_attempts a on a.provider_order_id=v.facts->>'orderId' where a.quote_id=q.id) as verified_webhooks,
    (select count(*) from solar_private.payment_receipts r
     join solar_private.checkout_attempts a on a.id=r.attempt_id where a.quote_id=q.id) as receipts,
    (select count(*) from solar_private.sales_orders o where o.quote_id=q.id) as orders
from targets t join solar_private.quotes q on q.id=t.quote_id join solar_private.enquiries e on e.id=q.enquiry_id
order by t.label;
