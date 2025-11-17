// src/pages/World/WorldLayout.tsx
import { NavLink, Outlet, useParams } from "react-router-dom";

export function WorldLayout() {
  const { worldId } = useParams();

  const tabs = [
    { path: "overview", label: "Overview" },
    { path: "characters", label: "Characters" },
    { path: "map", label: "Map" },
    { path: "index", label: "Index" },
    { path: "lore", label: "Lore" },
  ];

  return (
    <div className="h-full flex flex-col">
      <header className="px-6 py-3 border-b border-slate-700 flex justify-between items-center">
        <div>
          <h1 className="text-xl font-semibold">World: {worldId}</h1>
          <p className="text-xs text-slate-400">
            Campaign management · local only
          </p>
        </div>
      </header>
      <nav className="px-6 py-2 border-b border-slate-800 flex space-x-4 text-sm">
        {tabs.map((tab) => (
          <NavLink
            key={tab.path}
            to={tab.path}
            className={({ isActive }) =>
              [
                "pb-2 border-b-2",
                isActive
                  ? "border-sky-400 text-sky-300"
                  : "border-transparent text-slate-400 hover:text-slate-200",
              ].join(" ")
            }
          >
            {tab.label}
          </NavLink>
        ))}
      </nav>
      <main className="flex-1 overflow-auto p-6">
        <Outlet />
      </main>
    </div>
  );
}
