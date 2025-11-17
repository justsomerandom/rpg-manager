// src/pages/World/WorldLayout.tsx
import { NavLink, Outlet, useLocation, useParams } from "react-router-dom";

export function WorldLayout() {
  const { worldId } = useParams();
  const location = useLocation();
  const isMapRoute = location.pathname?.includes("/map");

  const tabs = [
    { path: "overview", label: "Overview" },
    { path: "characters", label: "Characters" },
    { path: "map", label: "Map" },
    { path: "index", label: "Index" },
    { path: "lore", label: "Lore" },
  ];

  return (
    <div className="h-screen w-full bg-brand-deep text-brand-glow relative overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(31,156,115,0.35),_transparent_45%)] opacity-40 pointer-events-none" />
      <div className="h-full flex flex-col relative z-10">
        <header className="px-8 py-4 border-b border-brand/15 flex flex-wrap items-center justify-between gap-4 bg-brand-deep/80 backdrop-blur">
          <div>
            <p className="text-xs tracking-widest uppercase text-earth-sand/60">World</p>
            <h1 className="text-2xl font-semibold text-brand-glow">
              {worldId || "Untitled Realm"}
            </h1>
          </div>
          <div className="text-xs text-earth-sand/70 flex items-center gap-2">
            <span>Dock Navigation</span>
            <span className="text-earth-clay">•</span>
            <span>Local Save</span>
          </div>
        </header>

        <nav className="flex justify-center mt-2">
          <div className="flex gap-2 rounded-full bg-grove-900/85 px-4 py-2 shadow-panel backdrop-blur">
            {tabs.map((tab) => (
              <NavLink
                key={tab.path}
                to={tab.path}
                className={({ isActive }) =>
                  [
                    "px-4 py-2 rounded-full text-sm transition",
                    isActive
                      ? "bg-brand text-black font-semibold shadow-lg"
                      : "text-brand-glow/70 hover:text-brand-glow hover:bg-brand/10",
                  ].join(" ")
                }
              >
                {tab.label}
              </NavLink>
            ))}
          </div>
        </nav>

        <main className="flex-1 relative overflow-hidden">
          <div className={`absolute inset-0 ${isMapRoute ? "" : "overflow-auto px-6 py-6"}`}>
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
