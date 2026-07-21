import {
  useEffect,
  useState,
} from "react";
import { NavLink, Outlet, useLocation, useParams } from "react-router-dom";
import { getWorld } from "../../api/worlds";

export function WorldLayout() {
  const { worldId } = useParams();
  const location = useLocation();
  const [worldName, setWorldName] = useState<string | null>(null);
  const isMapRoute = location.pathname?.includes("/map");

  const tabs = [
    { path: "overview", label: "Overview" },
    { path: "characters", label: "Characters" },
    { path: "map", label: "Map" },
    { path: "index", label: "Index" },
    { path: "lore", label: "Lore" },
  ];

  useEffect(() => {
    let cancelled = false;
    if (!worldId) {
      setWorldName(null);
      return;
    }
    getWorld(worldId)
      .then((world) => {
        if (!cancelled) setWorldName(world.name);
      })
      .catch(() => {
        if (!cancelled) setWorldName(null);
      });
    return () => {
      cancelled = true;
    };
  }, [worldId]);

  const dockShellClasses = "rounded-2xl border border-grove-600/80 bg-grove-900/90 backdrop-blur-xl shadow-panel transition-all duration-300";
  const dockName = worldName || "Untitled Realm";

  return (
    <div className="h-screen w-full bg-brand-deep text-brand-glow relative overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(31,156,115,0.35),_transparent_45%)] opacity-40 pointer-events-none" />

      <div className="absolute top-0 left-0 right-0 flex justify-center pointer-events-none z-20">
        <div className="pointer-events-auto px-4 pt-2 pb-2 w-full flex justify-center">
          <div className="transition-[width] duration-300 ease-out">
            <div className={`${dockShellClasses} px-2 py-2`}>
              <div className="flex items-center gap-1 overflow-x-auto">
                <div className="hidden shrink-0 border-r border-grove-600 px-3 pr-4 sm:block">
                  <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-earth-sand/70">Campaign</p>
                  <p className="max-w-36 truncate text-sm font-semibold text-brand-glow">{dockName}</p>
                </div>
                {tabs.map((tab) => (
                  <NavLink
                    key={tab.path}
                    to={tab.path}
                    className={({ isActive }) =>
                      [
                        "rounded-xl transition whitespace-nowrap px-3 py-2 text-sm",
                        isActive
                          ? "bg-brand text-white font-semibold shadow-lg shadow-emerald-950/40"
                          : "text-slate-300 hover:text-brand-glow hover:bg-grove-700/70",
                      ]
                        .filter(Boolean)
                        .join(" ")
                    }
                  >
                    {tab.label}
                  </NavLink>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="h-full flex flex-col relative z-10">
        <main className="flex-1 relative overflow-hidden">
          {isMapRoute ? (
            <div className="absolute inset-0">
              <Outlet />
            </div>
          ) : (
            <div className="h-full overflow-auto px-4 pt-24 pb-8 sm:px-8">
              <Outlet />
            </div>
          )}
        </main>
      </div>

    </div>
  );
}
