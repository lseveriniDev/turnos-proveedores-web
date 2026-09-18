import Image from "next/image";

import { BookingForm } from "@/components/BookingForm";

export default function Inicio() {
  return (
    <main className="shell">
      <header className="site-header">
        <div className="brand" aria-label="Turnos de proveedores">
          <Image className="brand-logo" src="/gottert-logo.png" width={869} height={287} priority alt="Göttert" />
          <span className="brand-copy">
            <strong>Portal de proveedores</strong>
            <small>Coordinación de entregas</small>
          </span>
        </div>
      </header>

      <section className="booking-layout" aria-labelledby="titulo-reserva">
        <BookingForm />
      </section>
    </main>
  );
}
