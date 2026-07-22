import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { Link, NavLink, Outlet, useLocation, useParams } from "react-router-dom";
import { getErrorMessage } from "../../api/client";
import { getWorld, type World } from "../../api/worlds";

export type WorldOutletContext = {
  world: World;
  setWorld: Dispatch<SetStateAction<World | null>>;
};

const TABS = [
  { path: "overview", label: "Overview" },
  { path: "characters", label: "Characters" },
  { path: "map", label: "Map" },
  { path: "index", label: "Index" },
  { path: "lore", label: "Lore" },
] as const;

export function WorldLayout() {
  const { worldId } = useParams();
  const location = useLocation();
  const [world, setWorld] = useState<World | null>(null);
  const [loadingWorld, setLoadingWorld] = useState(true);
  const [worldError, setWorldError] = useState<string | null>(null);
  const isMapRoute = location.pathname.endsWith("/map");

  useEffect(() => {
    let cancelled = false;
    if (!worldId) {
      setWorld(null);
      setWorldError("This campaign link is missing its world identifier.");
      setLoadingWorld(false);
      return;
    }

    setLoadingWorld(true);
    setWorldError(null);
    getWorld(worldId)
      .then((loadedWorld) => {
        if (!cancelled) setWorld(loadedWorld);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setWorld(null);
          setWorldError(getErrorMessage(error, "This campaign could not be loaded."));
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingWorld(false);
      });

    return () => {
      cancelled = true;
    };
  }, [worldId]);

  const dockName = world?.name || (loadingWorld ? "Loading campaign…" : "Campaign unavailable");

  return (
    <div className="relative h-screen w-full overflow-hidden bg-brand-deep text-brand-glow">
      <button
        className="skip-link"
        type="button"
        onClick={() => document.getElementById("world-content")?.focus()}
      >
        Skip to campaign content
      </button>
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(31,156,115,0.35),_transparent_45%)] opacity-40" />

      <header className="pointer-events-none absolute inset-x-0 top-0 z-20 flex justify-center">
        <div className="pointer-events-auto flex w-full justify-center px-3 pb-2 pt-2 sm:px-4">
          <div className="min-w-0 max-w-full transition-[width] duration-300 ease-out">
            <div className="rounded-2xl border border-grove-600/80 bg-grove-900/95 px-2 py-2 shadow-panel backdrop-blur-xl">
              <nav aria-label="Campaign sections" className="flex items-center gap-1 overflow-x-auto">
                <Link
                  aria-label="Return to all worlds"
                  className="shrink-0 rounded-xl px-3 py-2 text-sm font-semibold text-earth-sand transition hover:bg-grove-700 hover:text-white"
                  title="All worlds"
                  to="/"
                >
                  <span aria-hidden="true">←</span>
                  <span className="ml-2 hidden md:inline">Worlds</span>
                </Link>
                <div className="hidden shrink-0 border-r border-grove-600 px-3 pr-4 sm:block">
                  <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-earth-sand/70">Campaign</p>
                  <p className="max-w-36 truncate text-sm font-semibold text-brand-glow" title={dockName}>
                    {dockName}
                  </p>
                </div>
                {TABS.map((tab) => (
                  <NavLink
                    key={tab.path}
                    className={({ isActive }) =>
                      [
                        "whitespace-nowrap rounded-xl px-3 py-2 text-sm transition",
                        isActive
                          ? "bg-brand font-semibold text-grove-900 shadow-lg shadow-emerald-950/40"
                          : "text-slate-300 hover:bg-grove-700/70 hover:text-brand-glow",
                      ].join(" ")
                    }
                    end
                    to={tab.path}
                  >
                    {tab.label}
                  </NavLink>
                ))}
              </nav>
            </div>
          </div>
        </div>
      </header>

      <div className="relative z-10 flex h-full flex-col">
        <main className="relative flex-1 overflow-hidden" id="world-content" tabIndex={-1}>
          {loadingWorld ? (
            <div className="flex h-full items-center justify-center px-5" role="status">
              <div className="glass-panel px-6 py-5 text-center text-sm text-slate-200">
                <span className="loading-dot" aria-hidden="true" />
                Loading campaign…
              </div>
            </div>
          ) : worldError || !world ? (
            <div className="flex h-full items-center justify-center px-5 pt-20">
              <section className="glass-panel max-w-lg p-7 text-center" role="alert">
                <p className="section-label">Campaign unavailable</p>
                <h1 className="mt-3 font-display text-2xl font-semibold">We could not open this world</h1>
                <p className="mt-3 text-sm leading-6 text-slate-300">
                  {worldError || "This campaign no longer exists."}
                </p>
                <Link className="primary-button mt-6" to="/">Return to worlds</Link>
              </section>
            </div>
          ) : isMapRoute ? (
            <div className="absolute inset-0">
              <Outlet context={{ world, setWorld } satisfies WorldOutletContext} />
            </div>
          ) : (
            <div className="h-full overflow-auto px-4 pb-8 pt-24 sm:px-8">
              <Outlet context={{ world, setWorld } satisfies WorldOutletContext} />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
