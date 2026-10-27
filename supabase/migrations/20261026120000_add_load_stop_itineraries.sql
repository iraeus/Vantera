ALTER TABLE public.loads
  ADD COLUMN stops jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.loads
  ADD CONSTRAINT loads_stops_array_check
  CHECK (jsonb_typeof(stops) = 'array');

-- Preserve existing route information as the initial pickup and delivery stops.
UPDATE public.loads AS l
SET stops = COALESCE((
  SELECT jsonb_agg(
    jsonb_strip_nulls(jsonb_build_object(
      'id', gen_random_uuid()::text,
      'sequence_number', r.sequence_number,
      'stop_type', r.stop_type,
      'facility_name', r.facility_name,
      'street_address', r.street_address,
      'city', r.city,
      'state', r.state,
      'postal_code', r.postal_code,
      'country', 'United States',
      'appointment_date', r.appointment_date,
      'appointment_time', r.appointment_time,
      'timezone', 'America/New_York',
      'appointment_number', NULL,
      'bol_number', NULL,
      'contact_name', NULL,
      'contact_phone', NULL,
      'contact_email', NULL,
      'instructions', NULL,
      'status', 'scheduled'
    )) ORDER BY r.sequence_number
  )
  FROM (VALUES
    (1, 'pickup', l.shipper, l.pickup_address, l.pickup_location, l.pickup_date::text, l.pickup_time),
    (2, 'delivery', l.consignee, l.delivery_address, l.delivery_location, l.delivery_date::text, l.delivery_time)
  ) AS r(sequence_number, stop_type, facility_name, street_address, city, appointment_date, appointment_time)
  WHERE COALESCE(r.facility_name, r.street_address, r.city, r.appointment_date, r.appointment_time) IS NOT NULL
), '[]'::jsonb)
WHERE l.stops = '[]'::jsonb;

COMMENT ON COLUMN public.loads.stops IS
  'Ordered load itinerary. Stop IDs remain stable through edits; all stop details are optional while drafting.';

NOTIFY pgrst, 'reload schema';
