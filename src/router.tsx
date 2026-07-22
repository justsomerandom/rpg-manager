import {
  createHashRouter,
  isRouteErrorResponse,
  Link,
  Navigate,
  RouterProvider,
  useRouteError,
} from "react-router-dom";
import { HomePage } from "./pages/HomePage";
import { WorldLayout } from "./pages/World/WorldLayout";
import { WorldOverviewPage } from "./pages/World/WorldOverviewPage";
import { WorldCharactersPage } from "./pages/World/WorldCharactersPage";
import { WorldMapPage } from "./pages/World/WorldMapPage";
import { WorldIndexPage } from "./pages/World/WorldIndexPage";
import { WorldLorePage } from "./pages/World/WorldLorePage";

function RouteErrorPage() {
  const error = useRouteError();
  const message = isRouteErrorResponse(error)
    ? error.statusText || `The requested page returned ${error.status}.`
    : error instanceof Error
      ? error.message
      : "The application could not display this page.";

  return (
    <main className="flex min-h-screen items-center justify-center bg-brand-deep px-5 text-brand-glow">
      <section className="glass-panel w-full max-w-lg p-7 text-center" role="alert">
        <p className="section-label">Unexpected detour</p>
        <h1 className="mt-3 font-display text-3xl font-semibold">This page hit a snag</h1>
        <p className="mt-3 text-sm leading-6 text-slate-300">{message}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link className="secondary-button" to="/">Return to worlds</Link>
          <button className="primary-button" type="button" onClick={() => window.location.reload()}>
            Reload application
          </button>
        </div>
      </section>
    </main>
  );
}

function NotFoundPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-brand-deep px-5 text-brand-glow">
      <section className="glass-panel w-full max-w-lg p-7 text-center">
        <p className="section-label">Page not found</p>
        <h1 className="mt-3 font-display text-3xl font-semibold">That path is not on the map</h1>
        <p className="mt-3 text-sm leading-6 text-slate-300">
          The destination may have moved, or the link may be incomplete.
        </p>
        <Link className="primary-button mt-6" to="/">Return to worlds</Link>
      </section>
    </main>
  );
}

// Hash history remains valid when a bundled desktop route is refreshed through
// Tauri's custom asset protocol.
const router = createHashRouter([
  {
    path: "/",
    element: <HomePage />,
    errorElement: <RouteErrorPage />,
  },
  {
    path: "/world/:worldId",
    element: <WorldLayout />,
    errorElement: <RouteErrorPage />,
    children: [
      { index: true, element: <Navigate to="overview" replace /> },
      { path: "overview", element: <WorldOverviewPage /> },
      { path: "characters", element: <WorldCharactersPage /> },
      { path: "map", element: <WorldMapPage /> },
      { path: "index", element: <WorldIndexPage /> },
      { path: "lore", element: <WorldLorePage /> },
      { path: "*", element: <Navigate to="overview" replace /> },
    ],
  },
  { path: "*", element: <NotFoundPage /> },
]);

export function AppRouter() {
  return <RouterProvider router={router} />;
}
