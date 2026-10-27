import {
  createFileRoute,
  Outlet,
  redirect,
  Link,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  Activity,
  ArrowLeftRight,
  BarChart3,
  CalendarDays,
  Contact,
  CreditCard,
  Gauge,
  ChevronDown,
  ChevronRight,
  Menu,
  Package,
  Radio,
  Settings,
  ShieldCheck,
  Truck,
  UserRound,
  Users,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { label } from "@/lib/tms";
import { usePermissions, type PermModule } from "@/hooks/usePermissions";
import { Guard } from "@/components/entity-kit";
import { GlobalSearch } from "@/components/GlobalSearch";
import { DisplayMenu } from "@/components/display-menu";
import { AlertsBell } from "@/components/alerts-bell";
import { LoadTimeAlerts } from "@/components/LoadTimeAlerts";
import { TaskToaster } from "@/hooks/useTasks";
import { BootGate } from "@/components/boot-gate";
import { BootScreen } from "@/components/boot-screen";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  // Show the loading screen immediately while the sign-in check runs (no blank page).
  pendingComponent: () => <BootScreen label="Signing you in…" />,
  pendingMs: 0,
  pendingMinMs: 300,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal && aal.nextLevel === "aal2" && aal.currentLevel !== "aal2") throw redirect({ to: "/auth" });
    return { user: data.user };
  },
  component: AuthedLayout,
});

const NAV = [
  {
    group: "Operations",
    items: [
      { to: "/dashboard", module: "dashboard", text: "Dashboard" },
      { to: "/command", module: "command", text: "Command Center" },
      { to: "/loads", module: "loads", text: "Load Board" },
      { to: "/dispatch", module: "dispatch", text: "Dispatch Board" },
      { to: "/updates", module: "updates", text: "Update Board" },
      { to: "/shifts", module: "shifts", text: "Shifts" },
      { to: "/transferring", module: "transfer", text: "Transferring" },
    ],
  },
  {
    group: "Fleet",
    items: [
      { to: "/trucks", module: "trucks", text: "Trucks" },
      { to: "/trailers", module: "trailers", text: "Trailers" },
      { to: "/maintenance", module: "maintenance", text: "Maintenance" },
      { to: "/drivers", module: "drivers", text: "Drivers" },
      { to: "/safety", module: "safety", text: "Safety" },
    ],
  },
  {
    group: "Network",
    items: [
      { to: "/brokers", module: "brokers", text: "Broker CRM" },
      { to: "/reports", module: "reports", text: "Reports" },
      { to: "/performance", module: "reports", text: "Performance" },
      { to: "/billing", module: "accounting", text: "Billing" },
      { to: "/gross", module: "reports", text: "Gross Board" },
    ],
  },
  {
    group: "Admin",
    items: [
      { to: "/staff", module: "users", text: "Staff & Roles" },
      { to: "/settings", module: "settings", text: "Settings" },
    ],
  },
] as const;

const NAV_ICONS: Record<string, LucideIcon> = {
  Dashboard: Gauge,
  "Command Center": Activity,
  "Load Board": Package,
  "Dispatch Board": Radio,
  "Update Board": Activity,
  Shifts: CalendarDays,
  Transferring: ArrowLeftRight,
  Trucks: Truck,
  Trailers: Truck,
  Maintenance: Wrench,
  Drivers: UserRound,
  Safety: ShieldCheck,
  "Broker CRM": Contact,
  Reports: BarChart3,
  Performance: Activity,
  Billing: CreditCard,
  "Gross Board": BarChart3,
  "Staff & Roles": Users,
  Settings,
};

const MOBILE_NAV = [
  { to: "/dashboard", module: "dashboard", text: "Home", icon: Gauge },
  { to: "/loads", module: "loads", text: "Loads", icon: Package },
  { to: "/dispatch", module: "dispatch", text: "Dispatch", icon: Radio },
  { to: "/drivers", module: "drivers", text: "Drivers", icon: UserRound },
] as const;

function AuthedLayout() {
  const { data: me } = useCurrentUser();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { can, loading: permLoading } = usePermissions();
  const [navOpen, setNavOpen] = useState(() => window.matchMedia("(min-width: 768px)").matches);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem("vantera-nav-collapsed") ?? "{}");
    } catch {
      return {};
    }
  });

  useEffect(() => {
    localStorage.setItem("vantera-nav-collapsed", JSON.stringify(collapsedGroups));
  }, [collapsedGroups]);

  // Close the drawer after navigation on phones; leave desktop navigation open.
  useEffect(() => {
    if (window.matchMedia("(max-width: 767px)").matches) setNavOpen(false);
  }, [pathname]);
  const allItems: { to: string; module: string }[] = NAV.flatMap((s) => [...s.items]);
  const currentModule = allItems.find((i) => pathname.startsWith(i.to))?.module as PermModule | undefined;

  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  const now = new Date();

  return (
    <>
    <BootGate />
    <div className="flex min-h-dvh min-w-0 overflow-x-clip bg-ink text-sm text-fg">
      {/* Dark backdrop behind the drawer on phones */}
      {navOpen && (
        <div
          className="fixed inset-0 z-30 bg-ink/70 md:hidden"
          onClick={() => setNavOpen(false)}
          aria-hidden
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-[min(18rem,88vw)] shrink-0 flex-col border-r border-accent/25 bg-gradient-to-b from-panel via-panel to-panel2/70 shadow-2xl shadow-ink/20 transition-transform duration-200 md:sticky md:top-0 md:z-10 md:h-screen md:w-60 md:translate-x-0 md:shadow-none ${navOpen ? "translate-x-0" : "-translate-x-full md:hidden"}`}
      >
        <div className="flex h-14 items-center gap-2.5 border-b border-accent/20 bg-accent/5 px-4">
          <img src="/logo.png" alt="Vantera TMS logo" className="size-8 rounded-lg ring-1 ring-accent/30" />
          <div className="leading-none">
            <div className="font-display text-[15px] font-semibold tracking-tight text-fg">
              Vantera
            </div>
            <div className="mt-0.5 font-mono text-[10px] text-mut">DISPATCH · N-07</div>
          </div>
          <button
            onClick={() => setNavOpen(false)}
            className="ml-auto grid size-8 place-items-center rounded-lg text-mut ring-1 ring-line transition-colors hover:bg-accent/12 hover:text-accent"
            aria-label="Close menu"
            title="Close sidebar"
          >
            <X className="size-4" />
          </button>
        </div>

        <nav className="flex-1 space-y-4 overflow-y-auto px-2 py-3">
          {NAV.map((section) => {
            const items = section.items.filter((i) => !permLoading && can(i.module as PermModule, "view"));
            if (!items.length) return null;
            return (
            <div key={section.group}>
              <button
                type="button"
                aria-expanded={!collapsedGroups[section.group]}
                onClick={() => setCollapsedGroups((groups) => ({
                  ...groups,
                  [section.group]: !groups[section.group],
                }))}
                className="mb-1.5 flex w-full items-center gap-1.5 rounded px-2 py-1 text-left font-mono text-[10px] font-semibold tracking-[0.14em] text-accent/70 uppercase transition-colors hover:bg-accent/8 hover:text-accent"
              >
                {collapsedGroups[section.group] ? <ChevronRight className="size-3" /> : <ChevronDown className="size-3" />}
                {section.group}
              </button>
              {!collapsedGroups[section.group] && items.map((item) => {
                const active = pathname.startsWith(item.to);
                const Icon = NAV_ICONS[item.text] ?? Package;
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    className={`mb-0.5 flex items-center gap-2.5 rounded-lg border-l-2 px-2.5 py-2 transition-colors ${
                      active ? "border-accent bg-accent/12 font-medium text-accent shadow-sm shadow-accent/10" : "border-transparent text-mut hover:bg-panel2 hover:text-fg"
                    }`}
                  >
                    <Icon className="size-4 shrink-0" aria-hidden="true" />
                    {item.text}
                  </Link>
                );
              })}
            </div>
            );
          })}
        </nav>

        <div className="p-2">
          <div className="rounded-lg bg-panel2 p-3 ring-1 ring-line">
            <div className="mb-2 font-mono text-[10px] tracking-[0.14em] text-mut uppercase">
              Signed in
            </div>
            <div className="truncate text-xs text-fg">
              {me?.profile?.full_name ?? me?.email ?? "—"}
            </div>
            <div className="mt-0.5 font-mono text-[10px] text-mut">
              {me?.roles?.length ? me.roles.map(label).join(" · ") : "No role"}
            </div>
            <Link to="/account" className="mt-2 block rounded-md bg-ink py-1.5 text-center text-[11px] text-mut ring-1 ring-line hover:text-fg">
              My account &amp; security
            </Link>
            <Link to="/download" className="mt-1.5 block rounded-md bg-ink py-1.5 text-center text-[11px] text-mut ring-1 ring-line hover:text-fg">
              Get the app (Windows / Android)
            </Link>
            <button
              onClick={signOut}
              className="mt-1.5 h-7 w-full rounded-md bg-ink text-[11px] text-mut ring-1 ring-line hover:text-fg"
            >
              Sign out
            </button>
          </div>
        </div>
      </aside>

      <div className="flex min-h-dvh min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-12 shrink-0 items-center gap-2 border-b border-line bg-chrome/95 px-3 backdrop-blur sm:h-14 sm:gap-3 sm:px-4">
          <button
            onClick={() => setNavOpen((open) => !open)}
            className="grid size-8 shrink-0 place-items-center rounded-lg bg-panel2 text-mut ring-1 ring-line transition-colors hover:bg-accent/12 hover:text-accent"
            aria-label={navOpen ? "Close sidebar" : "Open sidebar"}
            title={navOpen ? "Close sidebar" : "Open sidebar"}
          >
            {navOpen ? <X className="size-4" /> : <Menu className="size-4" />}
          </button>
          <div className="hidden size-8 shrink-0 place-items-center rounded-lg bg-panel2 ring-1 ring-line md:grid">
            <span className="font-mono text-xs font-semibold text-mut">
              {(me?.profile?.full_name ?? me?.email ?? "U").charAt(0).toUpperCase()}
            </span>
          </div>
          <div className="hidden leading-none md:block">
            <div className="font-display text-[15px] font-semibold tracking-tight text-fg">
              Operations
            </div>
            <div className="mt-1 font-mono text-[10px] text-mut">
              {now.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}
            </div>
          </div>
          <div className="min-w-0 flex-1">
            <GlobalSearch />
          </div>
          <TaskToaster />
          <LoadTimeAlerts />
          <AlertsBell />
          <DisplayMenu />
        </header>

        <main key={pathname} className="page-enter min-w-0 flex-1 space-y-3 p-3 pb-[calc(5.25rem+env(safe-area-inset-bottom))] sm:space-y-4 sm:p-4 md:pb-4">
          {currentModule ? <Guard module={currentModule}><Outlet /></Guard> : <Outlet />}
        </main>
        <nav
          aria-label="Primary navigation"
          className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-5 border-t border-line bg-chrome/95 px-1 pt-1 pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_24px_rgb(0_0_0/0.18)] backdrop-blur-sm md:hidden"
        >
          {MOBILE_NAV.filter((item) => !permLoading && can(item.module as PermModule, "view")).map((item) => {
            const Icon = item.icon;
            const active = pathname.startsWith(item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-lg px-1 text-[10px] font-medium ${active ? "text-accent" : "text-mut"}`}
              >
                <Icon className="size-5" aria-hidden="true" />
                <span>{item.text}</span>
              </Link>
            );
          })}
          <button
            type="button"
            onClick={() => setNavOpen(true)}
            className="flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-lg px-1 text-[10px] font-medium text-mut"
            aria-label="Open all sections"
          >
            <Menu className="size-5" aria-hidden="true" />
            <span>More</span>
          </button>
        </nav>
      </div>
    </div>
    </>
  );
}
