/**
 * Izvoz v CSV za Excel s slovensko regionalno nastavitvijo.
 *
 * Ta datoteka je ČISTA: brez baze, brez Reacta.
 */

const BOM = '﻿'

/**
 * Oblikuje cente v slovenski decimalni zapis BREZ znaka valute, npr. -4750 -> "-47,50".
 * Namenjeno izkljucno CSV celicam (ne za prikaz v vmesniku — tam se uporabi formatEur).
 */
export function centsForCsv(cents: number): string {
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  const whole = Math.floor(abs / 100)
  const frac = String(abs % 100).padStart(2, '0')
  return `${sign}${whole},${frac}`
}

/** Ali polje potrebuje navednice: vsebuje locilo, navednico ali prelom vrstice. */
function needsQuoting(field: string): boolean {
  return field.includes(';') || field.includes('"') || field.includes('\r') || field.includes('\n')
}

function escapeField(field: string): string {
  if (!needsQuoting(field)) return field
  // Navednica se podvoji, celotno polje se ovije v navednice.
  return `"${field.replace(/"/g, '""')}"`
}

/**
 * Pretvori vrstice besedila v CSV niz.
 *
 * Locilo je PODPICJE (;), ne vejica: lastnik bo datoteko odprl v Excelu s
 * slovensko regionalno nastavitvijo, kjer je vejica decimalno locilo. Datoteka
 * z vejico kot locilom polj bi se ob decimalnih vejicah (glej centsForCsv)
 * razdrobila na napacne stolpce.
 *
 * Vrstice se koncajo s CRLF, kot pricakuje Excel na Windows.
 *
 * Datoteka se zacne z UTF-8 BOM (﻿): brez njega Excel privzeto bere
 * datoteko kot Windows-1250/ANSI in šumnike (č š ž) prikaze kot smetje
 * (mojibake). To je najpogostejsa napaka pri slovenskih CSV izvozih.
 */
export function toCsv(rows: readonly (readonly string[])[]): string {
  const body = rows.map((row) => row.map(escapeField).join(';')).join('\r\n')
  return `${BOM}${body}`
}
