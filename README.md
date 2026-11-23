# Análisis Fundamental (web gratuita)

Web estática estilo TIKR / InvestingPro, gratis y sin servidor:

- **Ficha de cada acción** (≈ todas las empresas que presentan cuentas a la SEC de EE. UU., incluidas muchas extranjeras con ADR): estados financieros anuales y de los últimos 12 meses, márgenes, ROCE, ROIC, ROE, crecimiento, deuda, ratios de valoración históricos.
- **Valor intrínseco (DCF)** con supuestos editables, tabla de sensibilidad y DCF inverso.
- **Proyección y rentabilidad esperada** a N años con escenarios pesimista / base / optimista, medias de 5 y 10 años de cada supuesto y un **índice de predecibilidad** (0-100) que indica cuánto fiarse de la proyección.
- **Previsiones de analistas** (consenso): ventas, EBITDA, EBIT, beneficio neto y BPA de los próximos años con mínimo, máximo y nº de analistas, comparadas con las medias históricas y el índice de predecibilidad, y una nota de «acuerdo entre analistas» según la dispersión de las estimaciones.
- **Grandes inversores**: carteras 13F trimestrales y sus movimientos (nuevas, aumenta, reduce, vende todo).
- **Buscador (screener)** con filtros por métricas.

## Cómo funciona

1. `scripts/build_data.py` descarga los datos gratuitos:
   - Estados financieros: SEC EDGAR XBRL (`companyfacts.zip`).
   - Sector: SEC (`submissions.zip`).
   - Precios mensuales de 10 años: Yahoo Finance (alternativa: Stooq).
   - Carteras: formularios 13F de la SEC. CUSIP → ticker con OpenFIGI (gratis).
2. Genera JSON en `site/data/`.
3. GitHub Actions (`.github/workflows/actualizar.yml`) lo ejecuta de martes a sábado y publica `site/` en GitHub Pages.

Las proyecciones son cálculos propios a partir de los históricos, con supuestos que el usuario puede cambiar.

### Previsiones de analistas

El consenso **no** se descarga en GitHub Actions ni se publica en la web: cada usuario pega en la pestaña «Previsiones de analistas» su propia clave gratuita y su navegador lo pide directamente al proveedor (uso personal, sin redistribuir datos de terceros). La clave se guarda solo en el navegador (`localStorage`) y la respuesta se recuerda 24 horas.

- Principal: [Financial Modeling Prep](https://site.financialmodelingprep.com/developer/docs/stable/financial-estimates) (`/stable/analyst-estimates`), plan gratuito de 250 consultas al día.
- Respaldo: [Alpha Vantage](https://www.alphavantage.co/documentation/) (`EARNINGS_ESTIMATES`), 25 consultas al día, solo ventas y BPA del ejercicio actual y el siguiente, con revisiones.

Ninguno de los dos da previsiones de flujo de caja libre.

## Ajustes opcionales (Settings → Secrets and variables → Actions)

- Variable `SEC_USER_AGENT`: la SEC pide identificarse, p. ej. `MiNombre miemail@dominio.com`.
- Secreto `OPENFIGI_API_KEY`: clave gratuita de openfigi.com; acelera la traducción de CUSIP a ticker.
- Variable `BUILD_ARGS`: p. ej. `--limit 100` para una prueba rápida.
- Lista de inversores: `scripts/investors.json` (CIK de la SEC).

## Probar en local

```bash
pip install requests
python scripts/build_data.py --tickers AAPL,MSFT,KO   # unas pocas empresas
cd site && python -m http.server 8000                  # abrir http://localhost:8000
```

Datos de ejemplo sin conexión: `python tests/make_demo.py site/data`.

No es asesoramiento financiero.
