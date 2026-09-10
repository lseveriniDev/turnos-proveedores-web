"use client";

import { ChangeEvent, useState } from "react";

import { obtenerSupabase, supabaseConfigurado } from "@/lib/supabase/client";

type FilaImportacion = {
  cuit: string;
  razon_social: string;
  email: string | null;
  codigo_externo: string | null;
  orden_compra: string | null;
};

function partirLinea(linea: string, separador: string): string[] {
  const valores: string[] = [];
  let actual = "";
  let entreComillas = false;

  for (let indice = 0; indice < linea.length; indice += 1) {
    const caracter = linea[indice];
    if (caracter === '"') {
      if (entreComillas && linea[indice + 1] === '"') {
        actual += '"';
        indice += 1;
      } else {
        entreComillas = !entreComillas;
      }
    } else if (caracter === separador && !entreComillas) {
      valores.push(actual.trim());
      actual = "";
    } else {
      actual += caracter;
    }
  }
  valores.push(actual.trim());
  return valores;
}

function clave(texto: string) {
  return texto.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, "_");
}

function leerCsv(contenido: string): FilaImportacion[] {
  const lineas = contenido.replace(/^\uFEFF/, "").split(/\r?\n/).filter((linea) => linea.trim());
  if (lineas.length < 2) throw new Error("El archivo necesita una fila de encabezados y al menos un proveedor.");
  const separador = lineas[0].includes(";") ? ";" : ",";
  const encabezados = partirLinea(lineas[0], separador).map(clave);
  const obligatorios = ["cuit", "razon_social"];
  if (obligatorios.some((nombre) => !encabezados.includes(nombre))) {
    throw new Error("El CSV necesita las columnas cuit y razon_social.");
  }

  return lineas.slice(1).map((linea, indice) => {
    const valores = partirLinea(linea, separador);
    const fila = Object.fromEntries(encabezados.map((encabezado, posicion) => [encabezado, valores[posicion] ?? ""]));
    if (!fila.cuit || !fila.razon_social) throw new Error(`Revisá la fila ${indice + 2}: falta CUIT o razón social.`);
    return {
      cuit: fila.cuit,
      razon_social: fila.razon_social,
      email: fila.email || null,
      codigo_externo: fila.codigo_externo || fila.codigo_summa || null,
      orden_compra: fila.orden_compra || fila.oc || null,
    };
  });
}

type Props = {
  modoDemo: boolean;
  informar: (texto: string, esError?: boolean) => void;
};

export function CsvImporter({ modoDemo, informar }: Props) {
  const [archivo, setArchivo] = useState<File | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const seleccionar = (evento: ChangeEvent<HTMLInputElement>) => {
    setArchivo(evento.target.files?.[0] ?? null);
  };

  const importar = async () => {
    if (!archivo) {
      informar("Elegí un archivo CSV para importar.", true);
      return;
    }
    setOcupado(true);
    try {
      const filas = leerCsv(await archivo.text());
      if (modoDemo || !supabaseConfigurado) {
        informar(`Vista de prueba: se importarían ${filas.length} proveedores y sus órdenes de compra.`);
        return;
      }
      const supabase = obtenerSupabase();
      if (!supabase) throw new Error("No encontramos la conexión con Supabase.");
      const proveedores = filas.map(({ orden_compra: _orden, ...proveedor }) => ({ ...proveedor, habilitado: true }));
      const { data: proveedoresGuardados, error: errorProveedores } = await supabase
        .from("proveedores")
        .upsert(proveedores, { onConflict: "cuit" })
        .select("id,cuit");
      if (errorProveedores) throw errorProveedores;

      const idPorCuit = new Map((proveedoresGuardados ?? []).map((proveedor) => [proveedor.cuit, proveedor.id]));
      const ordenes = filas
        .filter((fila) => fila.orden_compra)
        .map((fila) => ({ numero: fila.orden_compra as string, proveedor_id: idPorCuit.get(fila.cuit), estado: "abierta" }));
      if (ordenes.some((orden) => !orden.proveedor_id)) throw new Error("No pudimos asociar una orden a su proveedor.");
      if (ordenes.length) {
        const { error: errorOrdenes } = await supabase.from("ordenes_compra").upsert(ordenes, { onConflict: "numero" });
        if (errorOrdenes) throw errorOrdenes;
      }
      informar(`Importación lista: ${filas.length} proveedores y ${ordenes.length} órdenes procesadas.`);
    } catch (error) {
      informar(error instanceof Error ? error.message : "No pudimos leer el archivo.", true);
    } finally {
      setOcupado(false);
    }
  };

  return (
    <section className="import-card" aria-labelledby="importar-titulo">
      <div>
        <p className="eyebrow">Datos iniciales</p>
        <h2 id="importar-titulo">Importar proveedores y órdenes</h2>
        <p>Usá un CSV con las columnas <b>cuit</b>, <b>razon_social</b> y, si corresponde, <b>orden_compra</b>.</p>
      </div>
      <div className="import-actions">
        <label className="file-picker"><span>Elegir CSV</span><input type="file" accept=".csv,text/csv" onChange={seleccionar} /></label>
        <button className="secondary-button" type="button" disabled={ocupado} onClick={() => void importar()}>{ocupado ? "Importando…" : "Importar"}</button>
        <a href="/plantilla-importacion.csv" download>Descargar plantilla</a>
      </div>
      {archivo && <p className="selected-file">Archivo seleccionado: {archivo.name}</p>}
    </section>
  );
}
