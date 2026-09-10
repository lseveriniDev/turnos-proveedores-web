import Link from "next/link";

import { BookingForm } from "@/components/BookingForm";

export default function Inicio() {
  return (
    <main className="shell">
      <header className="site-header">
        <Link className="brand" href="/" aria-label="Turnos de proveedores, inicio">
          <span className="brand-mark" aria-hidden="true">T</span>
          <span>
            <strong>Turnos</strong>
            <small>Recepción de proveedores</small>
          </span>
        </Link>
        <Link className="panel-link" href="/panel">Panel interno</Link>
      </header>

      <section className="booking-layout" aria-labelledby="titulo-reserva">
        <BookingForm />
      </section>
    </main>
  );
}
