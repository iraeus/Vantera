ALTER TABLE public.drivers
  ADD COLUMN IF NOT EXISTS driver_type text NOT NULL DEFAULT 'owner_operator';

COMMENT ON COLUMN public.drivers.driver_type IS 'Whether the driver is a company driver or an owner operator.';

NOTIFY pgrst, 'reload schema';
