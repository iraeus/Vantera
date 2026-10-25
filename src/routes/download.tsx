import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getDownloadLinks } from "@/lib/downloads.functions";
import { useInstallPrompt } from "@/hooks/useInstallPrompt";
import { ThemeDots } from "@/components/display-menu";

export const Route = createFileRoute("/download")({
  head: () => ({
    meta: [
      { title: "Get the Vantera app" },
      { name: "description", content: "Install Vantera TMS on Windows, Android or in your browser." },
    ],
  }),
  component: DownloadPage,
});

type Platform = "windows" | "android" | "ios" | "other";
function detect(): Platform {
  if (typeof navigator === "undefined") return "other";
  const ua = navigator.userAgent;
  if (/android/i.test(ua)) return "android";
  if (/iphone|ipad|ipod/i.test(ua)) return "ios";
  if (/windows/i.test(ua)) return "windows";
  return "other";
}

function Card({ title, badge, children }: { title: string; badge?: string | undefined; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl bg-panel p-5 ring-1 ring-line">
      <div className="mb-3 flex items-center gap-2">
        <h2 className="font-display text-base font-semibold">{title}</h2>
        {badge && <span className="rounded bg-accent/12 px-1.5 py-0.5 font-mono text-[10px] text-accent">{badge}</span>}
      </div>
      <div className="space-y-3 text-sm text-mut">{children}</div>
    </section>
  );
}

const buttonCls = "inline-flex h-11 items-center justify-center rounded-xl bg-accent px-5 text-sm font-semibold text-ink hover:opacity-90";

function DownloadPage() {
  const links = useServerFn(getDownloadLinks);
  const { data } = useQuery({ queryKey: ["download-links"], queryFn: () => links() });
  const { canInstall, installed, install } = useInstallPrompt();
  const platform = detect();

  return (
    <div className="min-h-screen bg-ink px-4 py-6 text-fg">
      <div className="mx-auto max-w-2xl space-y-5">
        <div className="flex items-center justify-between">
          <a href="/" className="font-display text-lg font-semibold">Vantera TMS</a>
          <ThemeDots />
        </div>

        <div className="overflow-hidden rounded-2xl ring-1 ring-line">
          <img src="/logo-lockup.png" alt="Vantera TMS" className="block w-full" />
        </div>
        <h1 className="font-display text-2xl font-semibold">Get the Vantera app</h1>
        <p className="text-sm text-mut">The apps open the same Vantera TMS you use in the browser, so everything stays up to date automatically. You need an internet connection.</p>

        <Card title="Install from your browser" badge="QUICKEST">
          {installed ? (
            <p className="text-delivered">Vantera is already installed on this device.</p>
          ) : canInstall ? (
            <button className={buttonCls} onClick={() => void install()}>Install Vantera</button>
          ) : (
            <p>
              In Chrome or Edge, open the menu (⋮ or …) and choose <b className="text-fg">Install Vantera TMS</b> (or <b className="text-fg">Add to Home screen</b> on Android).
              On iPhone or iPad, open this page in Safari, tap <b className="text-fg">Share</b>, then <b className="text-fg">Add to Home Screen</b>.
            </p>
          )}
        </Card>

        <Card title="Windows app (.exe)" badge={platform === "windows" ? "FOR THIS PC" : undefined}>
          <a className={buttonCls} href={data?.windows ?? "#"} download>Download for Windows</a>
          <ol className="list-decimal space-y-1 pl-5">
            <li>Chrome may say the file is not commonly downloaded. Click <b className="text-fg">Keep</b>.</li>
            <li>Open the downloaded <b className="text-fg">Vantera-Setup.exe</b> and follow the installer.</li>
            <li>If Windows shows "Windows protected your PC", click <b className="text-fg">More info</b>, then <b className="text-fg">Run anyway</b>.</li>
            <li>The first time, type your Vantera website address if the app asks for it.</li>
          </ol>
          <p className="text-[11px]">Works on Windows 10 and 11.</p>
        </Card>

        <Card title="Android app (.apk)" badge={platform === "android" ? "FOR THIS PHONE" : undefined}>
          <a className={buttonCls} href={data?.android ?? "#"} download>Download for Android</a>
          <ol className="list-decimal space-y-1 pl-5">
            <li>Chrome may warn that this type of file can harm your device. Tap <b className="text-fg">Keep</b> or <b className="text-fg">Download anyway</b>.</li>
            <li>Open the downloaded file. If Android asks, allow <b className="text-fg">Install unknown apps</b> for Chrome.</li>
            <li>If Play Protect shows a warning, tap <b className="text-fg">Install anyway</b>. The app is made by your own company.</li>
          </ol>
        </Card>

        <p className="pb-8 text-center text-xs text-mut">Only install apps from a link your company gave you.</p>
      </div>
    </div>
  );
}
