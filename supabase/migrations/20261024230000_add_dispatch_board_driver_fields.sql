ALTER TABLE public.drivers
  ADD COLUMN IF NOT EXISTS dispatch_note text,
  ADD COLUMN IF NOT EXISTS dispatch_status text;

UPDATE public.drivers
SET dispatch_status = CASE
  WHEN status = 'available' THEN 'ready'
  WHEN status = 'on_load' THEN 'in_transit'
  WHEN status IN ('home', 'off_duty', 'vacation') THEN 'rest_home'
  ELSE 'no_update'
END
WHERE dispatch_status IS NULL;

ALTER TABLE public.drivers
  ALTER COLUMN dispatch_status SET DEFAULT 'no_update',
  ALTER COLUMN dispatch_status SET NOT NULL;

COMMENT ON COLUMN public.drivers.dispatch_note IS 'Dispatch-only note displayed on the Dispatch Board.';
COMMENT ON COLUMN public.drivers.dispatch_status IS 'Operational driver status selected by dispatch.';

NOTIFY pgrst, 'reload schema';
