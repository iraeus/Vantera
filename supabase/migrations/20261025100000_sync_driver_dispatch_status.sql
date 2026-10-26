ALTER TABLE public.drivers
  ALTER COLUMN dispatch_status SET DEFAULT 'covered';

CREATE OR REPLACE FUNCTION public.sync_driver_dispatch_from_loads(p_driver_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  has_transit boolean;
  has_booked boolean;
BEGIN
  IF p_driver_id IS NULL THEN
    RETURN;
  END IF;

  SELECT
    EXISTS (
      SELECT 1
      FROM public.loads
      WHERE driver_id = p_driver_id
        AND deleted_at IS NULL
        AND status IN ('picked_up', 'in_transit', 'at_delivery', 'unloading')
    ),
    EXISTS (
      SELECT 1
      FROM public.loads
      WHERE driver_id = p_driver_id
        AND deleted_at IS NULL
        AND status IN ('booked', 'upcoming', 'assigned', 'dispatched', 'at_pickup', 'loading')
    )
  INTO has_transit, has_booked;

  UPDATE public.drivers
  SET dispatch_status = CASE
        WHEN has_transit AND has_booked THEN 'prebook'
        WHEN has_transit THEN 'in_transit'
        ELSE 'covered'
      END,
      status = CASE WHEN has_transit THEN 'on_load' ELSE 'available' END
  WHERE id = p_driver_id;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_driver_dispatch_from_loads(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_driver_dispatch_after_load_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.sync_driver_dispatch_from_loads(OLD.driver_id);
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.driver_id IS DISTINCT FROM NEW.driver_id THEN
    PERFORM public.sync_driver_dispatch_from_loads(OLD.driver_id);
  END IF;

  PERFORM public.sync_driver_dispatch_from_loads(NEW.driver_id);
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_driver_dispatch_after_load_change() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS sync_driver_dispatch_after_load_change ON public.loads;
CREATE TRIGGER sync_driver_dispatch_after_load_change
AFTER INSERT OR UPDATE OR DELETE ON public.loads
FOR EACH ROW
EXECUTE FUNCTION public.sync_driver_dispatch_after_load_change();

UPDATE public.drivers AS d
SET dispatch_status = CASE
  WHEN EXISTS (
    SELECT 1 FROM public.loads AS l
    WHERE l.driver_id = d.id AND l.deleted_at IS NULL
      AND l.status IN ('picked_up', 'in_transit', 'at_delivery', 'unloading')
  ) AND EXISTS (
    SELECT 1 FROM public.loads AS l
    WHERE l.driver_id = d.id AND l.deleted_at IS NULL
      AND l.status IN ('booked', 'upcoming', 'assigned', 'dispatched', 'at_pickup', 'loading')
  ) THEN 'prebook'
  WHEN EXISTS (
    SELECT 1 FROM public.loads AS l
    WHERE l.driver_id = d.id AND l.deleted_at IS NULL
      AND l.status IN ('picked_up', 'in_transit', 'at_delivery', 'unloading')
  ) THEN 'in_transit'
  ELSE 'covered'
END;

NOTIFY pgrst, 'reload schema';
