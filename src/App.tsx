import { AppRouter } from "./router";

// Keep a conventional App export for tooling and component-level tests while
// main.tsx mounts the router directly.
export default function App() {
  return <AppRouter />;
}
