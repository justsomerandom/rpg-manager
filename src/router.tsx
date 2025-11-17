// src/router.tsx
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { HomePage } from "./pages/HomePage";
import { WorldLayout } from "./pages/World/WorldLayout";
import { WorldOverviewPage } from "./pages/World/WorldOverviewPage";
import { WorldCharactersPage } from "./pages/World/WorldCharactersPage";
import { WorldMapPage } from "./pages/World/WorldMapPage";
import { WorldIndexPage } from "./pages/World/WorldIndexPage";
import { WorldLorePage } from "./pages/World/WorldLorePage";

const router = createBrowserRouter([
  {
    path: "/",
    element: <HomePage />,
  },
  {
    path: "/world/:worldId",
    element: <WorldLayout />,
    children: [
      { path: "overview", element: <WorldOverviewPage /> },
      { path: "characters", element: <WorldCharactersPage /> },
      { path: "map", element: <WorldMapPage /> },
      { path: "index", element: <WorldIndexPage /> },
      { path: "lore", element: <WorldLorePage /> },
    ],
  },
]);

export function AppRouter() {
  return <RouterProvider router={router} />;
}
