ALTER TABLE public.drivers
  ADD COLUMN IF NOT EXISTS current_location text,
  ADD COLUMN IF NOT EXISTS last_location_update timestamptz;

-- Seed each driver's latest confirmed location from their check-in history.
WITH latest_driver_location AS (
  SELECT DISTINCT ON (driver_id)
    driver_id,
    current_location,
    last_location_update
  FROM public.loads
  WHERE driver_id IS NOT NULL
    AND current_location IS NOT NULL
    AND last_location_update IS NOT NULL
  ORDER BY driver_id, last_location_update DESC
)
UPDATE public.drivers AS driver
SET current_location = latest_driver_location.current_location,
    last_location_update = latest_driver_location.last_location_update
FROM latest_driver_location
WHERE driver.id = latest_driver_location.driver_id
  AND driver.current_location IS NULL;

NOTIFY pgrst, 'reload schema';
