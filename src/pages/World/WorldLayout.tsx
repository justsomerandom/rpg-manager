import {
  type FocusEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { NavLink, Outlet, useLocation, useParams } from "react-router-dom";
import { getWorld } from "../../api/worlds";

export function WorldLayout() {
  const { worldId } = useParams();
  const location = useLocation();
  const [worldName, setWorldName] = useState<string | null>(null);
  const [isDockExpanded, setIsDockExpanded] = useState(false);
  const compactMeasureRef = useRef<HTMLDivElement>(null);
  const expandedMeasureRef = useRef<HTMLDivElement>(null);
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

  const dockShellClasses =
    "rounded-full border border-brand/30 bg-grove-900/80 backdrop-blur shadow-panel transition-all duration-300 grid grid-cols-1 place-items-center gap-1 relative overflow-hidden";
  const collapsedPadding = "mt-2 px-5 py-2";
  const expandedPadding = "px-4 py-2";
  const dockName = worldName || "Untitled Realm";

  const handleBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setIsDockExpanded(false);
    }
  };

  return (
    <div className="h-screen w-full bg-brand-deep text-brand-glow relative overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(31,156,115,0.35),_transparent_45%)] opacity-40 pointer-events-none" />

      <div className="absolute top-0 left-0 right-0 flex justify-center pointer-events-none z-20">
        <div className="pointer-events-auto px-4 pt-2 pb-2 w-full flex justify-center">
          <div
            className="transition-[width] duration-300 ease-out"
            onMouseEnter={() => setIsDockExpanded(true)}
            onMouseLeave={() => setIsDockExpanded(false)}
            onFocusCapture={() => setIsDockExpanded(true)}
            onBlurCapture={handleBlur}
          >
            <div
              className={`${dockShellClasses} ${
                isDockExpanded ? expandedPadding : collapsedPadding
              }`}
            >
              {/* Both panels occupy the same grid cell and animate opacity/translate so they smoothly replace each other */}
              <div
                className={`col-start-1 row-start-1 flex items-center justify-center transition-opacity duration-200 ease-out ${
                  isDockExpanded
                    ? "opacity-0 -translate-y-1 pointer-events-none"
                    : "opacity-100 translate-y-0"
                }`}
              >
                <span/>
              </div>

              <div
                className={`col-start-1 row-start-1 flex items-center justify-center gap-1 overflow-hidden transition-opacity duration-200 ease-out ${
                  isDockExpanded
                    ? "opacity-100 translate-y-0 col-auto"
                    : "opacity-0 translate-y-1 pointer-events-none h-0 w-0"
                }`}
              >
                {tabs.map((tab) => (
                  <NavLink
                    key={tab.path}
                    to={tab.path}
                    className={({ isActive }) =>
                      [
                        "rounded-full transition whitespace-nowrap text-[12px] px-2 py-1.5",
                        isDockExpanded ? "px-5 py-2 text-sm" : "",
                        isActive
                          ? "bg-brand text-black font-semibold shadow-lg"
                          : "text-brand-glow/70 hover:text-brand-glow hover:bg-brand/10",
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
            <div className="h-full overflow-auto px-6 pt-16 pb-8">
              <Outlet />
            </div>
          )}
        </main>
      </div>

      <div
        className="absolute opacity-0 pointer-events-none -z-10"
        aria-hidden
      >
        <div
          ref={compactMeasureRef}
          className={`${dockShellClasses} ${collapsedPadding}`}
        >
          <span className="text-[11px] uppercase tracking-[0.35em] text-earth-sand/80 whitespace-nowrap">
            {dockName}
          </span>
        </div>
        <div
          ref={expandedMeasureRef}
          className={`${dockShellClasses} ${expandedPadding}`}
        >
          <div className="flex items-center justify-center gap-1">
            {tabs.map((tab) => (
              <span
                key={tab.path}
                className="rounded-full whitespace-nowrap text-[12px] px-5 py-2 text-sm"
              >
                {tab.label}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
