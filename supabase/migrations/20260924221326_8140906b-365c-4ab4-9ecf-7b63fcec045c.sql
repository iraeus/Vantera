
CREATE TYPE public.app_role AS ENUM ('super_admin','admin','dispatcher','updater','accounting','safety','fleet_manager','maintenance','viewer');

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text,
  full_name text,
  phone text,
  job_title text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

CREATE OR REPLACE FUNCTION public.can_write(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id
      AND role IN ('super_admin','admin','dispatcher','updater','accounting','fleet_manager','maintenance','safety')
  );
$$;

CREATE OR REPLACE FUNCTION public.is_admin(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role IN ('super_admin','admin')
  );
$$;

CREATE POLICY "profiles_select" ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "profiles_update_self" ON public.profiles FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());
CREATE POLICY "profiles_admin_all" ON public.profiles FOR ALL TO authenticated USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "user_roles_select" ON public.user_roles FOR SELECT TO authenticated USING (true);
CREATE POLICY "user_roles_admin_write" ON public.user_roles FOR ALL TO authenticated USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE first_user boolean;
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email,'@',1)));
  SELECT NOT EXISTS (SELECT 1 FROM public.user_roles) INTO first_user;
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, CASE WHEN first_user THEN 'super_admin'::public.app_role ELSE 'viewer'::public.app_role END);
  RETURN NEW;
END; $$;

CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- BROKERS
CREATE TABLE public.brokers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  contact_name text,
  phone text,
  email text,
  mc_number text,
  address text,
  payment_terms text,
  credit_rating text,
  is_customer boolean NOT NULL DEFAULT false,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- DRIVERS
CREATE TABLE public.drivers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_code text,
  full_name text NOT NULL,
  phone text,
  email text,
  cdl_number text,
  cdl_state text,
  cdl_expiration date,
  medical_card_expiration date,
  hire_date date,
  status text NOT NULL DEFAULT 'available',
  pay_type text,
  pay_rate numeric(10,2),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- TRUCKS
CREATE TABLE public.trucks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  truck_number text NOT NULL,
  vin text,
  make text,
  model text,
  year int,
  plate text,
  plate_state text,
  mileage int,
  status text NOT NULL DEFAULT 'available',
  ownership text,
  insurance_expiration date,
  registration_expiration date,
  inspection_due date,
  assigned_driver_id uuid REFERENCES public.drivers(id) ON DELETE SET NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- TRAILERS
CREATE TABLE public.trailers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trailer_number text NOT NULL,
  vin text,
  trailer_type text,
  make text,
  model text,
  year int,
  plate text,
  plate_state text,
  status text NOT NULL DEFAULT 'available',
  assigned_truck_id uuid REFERENCES public.trucks(id) ON DELETE SET NULL,
  registration_expiration date,
  insurance_expiration date,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- LOADS
CREATE TABLE public.loads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  load_number text NOT NULL,
  broker_id uuid REFERENCES public.brokers(id) ON DELETE SET NULL,
  customer_name text,
  shipper text,
  consignee text,
  pickup_location text,
  pickup_address text,
  pickup_date date,
  pickup_time text,
  delivery_location text,
  delivery_address text,
  delivery_date date,
  delivery_time text,
  commodity text,
  weight numeric(10,2),
  pieces int,
  equipment_type text,
  miles numeric(10,1),
  rate numeric(12,2) NOT NULL DEFAULT 0,
  fuel_surcharge numeric(12,2) NOT NULL DEFAULT 0,
  detention numeric(12,2) NOT NULL DEFAULT 0,
  layover numeric(12,2) NOT NULL DEFAULT 0,
  other_charges numeric(12,2) NOT NULL DEFAULT 0,
  driver_pay numeric(12,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'new',
  driver_id uuid REFERENCES public.drivers(id) ON DELETE SET NULL,
  truck_id uuid REFERENCES public.trucks(id) ON DELETE SET NULL,
  trailer_id uuid REFERENCES public.trailers(id) ON DELETE SET NULL,
  dispatcher_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  current_location text,
  last_location_update timestamptz,
  eta timestamptz,
  is_problem boolean NOT NULL DEFAULT false,
  problem_note text,
  notes text,
  special_instructions text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX loads_status_idx ON public.loads(status);
CREATE INDEX loads_driver_idx ON public.loads(driver_id);

-- LOAD EVENTS
CREATE TABLE public.load_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  load_id uuid NOT NULL REFERENCES public.loads(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  description text,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX load_events_load_idx ON public.load_events(load_id);

-- LOAD DOCUMENTS
CREATE TABLE public.load_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  load_id uuid NOT NULL REFERENCES public.loads(id) ON DELETE CASCADE,
  doc_type text NOT NULL,
  file_name text NOT NULL,
  file_path text NOT NULL,
  uploaded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.brokers, public.drivers, public.trucks, public.trailers, public.loads, public.load_events, public.load_documents TO authenticated;
GRANT ALL ON public.brokers, public.drivers, public.trucks, public.trailers, public.loads, public.load_events, public.load_documents TO service_role;

ALTER TABLE public.brokers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.drivers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trucks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trailers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.load_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.load_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "brokers_read" ON public.brokers FOR SELECT TO authenticated USING (true);
CREATE POLICY "brokers_insert" ON public.brokers FOR INSERT TO authenticated WITH CHECK (public.can_write(auth.uid()));
CREATE POLICY "brokers_update" ON public.brokers FOR UPDATE TO authenticated USING (public.can_write(auth.uid())) WITH CHECK (public.can_write(auth.uid()));
CREATE POLICY "brokers_delete" ON public.brokers FOR DELETE TO authenticated USING (public.is_admin(auth.uid()));

CREATE POLICY "drivers_read" ON public.drivers FOR SELECT TO authenticated USING (true);
CREATE POLICY "drivers_insert" ON public.drivers FOR INSERT TO authenticated WITH CHECK (public.can_write(auth.uid()));
CREATE POLICY "drivers_update" ON public.drivers FOR UPDATE TO authenticated USING (public.can_write(auth.uid())) WITH CHECK (public.can_write(auth.uid()));
CREATE POLICY "drivers_delete" ON public.drivers FOR DELETE TO authenticated USING (public.is_admin(auth.uid()));

CREATE POLICY "trucks_read" ON public.trucks FOR SELECT TO authenticated USING (true);
CREATE POLICY "trucks_insert" ON public.trucks FOR INSERT TO authenticated WITH CHECK (public.can_write(auth.uid()));
CREATE POLICY "trucks_update" ON public.trucks FOR UPDATE TO authenticated USING (public.can_write(auth.uid())) WITH CHECK (public.can_write(auth.uid()));
CREATE POLICY "trucks_delete" ON public.trucks FOR DELETE TO authenticated USING (public.is_admin(auth.uid()));

CREATE POLICY "trailers_read" ON public.trailers FOR SELECT TO authenticated USING (true);
CREATE POLICY "trailers_insert" ON public.trailers FOR INSERT TO authenticated WITH CHECK (public.can_write(auth.uid()));
CREATE POLICY "trailers_update" ON public.trailers FOR UPDATE TO authenticated USING (public.can_write(auth.uid())) WITH CHECK (public.can_write(auth.uid()));
CREATE POLICY "trailers_delete" ON public.trailers FOR DELETE TO authenticated USING (public.is_admin(auth.uid()));

CREATE POLICY "loads_read" ON public.loads FOR SELECT TO authenticated USING (true);
CREATE POLICY "loads_insert" ON public.loads FOR INSERT TO authenticated WITH CHECK (public.can_write(auth.uid()));
CREATE POLICY "loads_update" ON public.loads FOR UPDATE TO authenticated USING (public.can_write(auth.uid())) WITH CHECK (public.can_write(auth.uid()));
CREATE POLICY "loads_delete" ON public.loads FOR DELETE TO authenticated USING (public.is_admin(auth.uid()));

CREATE POLICY "load_events_read" ON public.load_events FOR SELECT TO authenticated USING (true);
CREATE POLICY "load_events_insert" ON public.load_events FOR INSERT TO authenticated WITH CHECK (public.can_write(auth.uid()));

CREATE POLICY "load_documents_read" ON public.load_documents FOR SELECT TO authenticated USING (true);
CREATE POLICY "load_documents_insert" ON public.load_documents FOR INSERT TO authenticated WITH CHECK (public.can_write(auth.uid()));
CREATE POLICY "load_documents_delete" ON public.load_documents FOR DELETE TO authenticated USING (public.can_write(auth.uid()));

CREATE TRIGGER brokers_updated_at BEFORE UPDATE ON public.brokers FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER drivers_updated_at BEFORE UPDATE ON public.drivers FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trucks_updated_at BEFORE UPDATE ON public.trucks FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trailers_updated_at BEFORE UPDATE ON public.trailers FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER loads_updated_at BEFORE UPDATE ON public.loads FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
