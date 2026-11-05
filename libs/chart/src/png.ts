import { Resvg } from "@resvg/resvg-js";

/**
 * Rasterizes an SVG made by `renderSvg` at twice its size. resvg ignores media queries, so render
 * the SVG with a concrete theme (light or dark) first.
 */
export function svgToPng(svg: string): Uint8Array {
  return new Resvg(svg, {
    fitTo: { mode: "zoom", value: 2 },
    font: { loadSystemFonts: true, defaultFontFamily: "Helvetica" },
  })
    .render()
    .asPng();
}
