import Link from "next/link";

import { AdminPanel } from "@/components/AdminPanel";

export default function PanelPage() {
  return (
    <main className="shell panel-shell">
      <header className="site-header">
        <Link className="brand" href="/" aria-label="Turnos de proveedores, inicio">
          <span className="brand-mark" aria-hidden="true">T</span>
          <span>
            <strong>Turnos</strong>
            <small>Panel interno</small>
          </span>
        </Link>
        <Link className="panel-link" href="/">Ver portal público</Link>
      </header>
      <AdminPanel />
    </main>
  );
}
