UPDATE public.drivers
SET dispatch_status = CASE
  WHEN status = 'off_duty' THEN 'rest'
  ELSE 'home'
END
WHERE dispatch_status = 'rest_home';

COMMENT ON COLUMN public.drivers.dispatch_status IS
  'Dispatch board status: ready, prebook, covered, in_transit, issue, home, rest, off_duty, shop, or no_update.';

NOTIFY pgrst, 'reload schema';
