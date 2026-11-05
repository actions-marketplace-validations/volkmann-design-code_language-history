import { renderSvg, type SvgOptions } from "@language-history/chart";
import { svgToPng } from "@language-history/chart/png";
import { readDataset } from "@language-history/format/file";

export interface RenderOptions extends SvgOptions {
  input: string;
  /** `.png` files become PNG, anything else SVG. */
  outputs: string[];
  from?: string;
  to?: string;
  log: (message: string) => void;
}

export async function render(options: RenderOptions): Promise<void> {
  const dataset = await readDataset(options.input);
  dataset.days = dataset.days.filter(
    (day) => (!options.from || day.date >= options.from) && (!options.to || day.date <= options.to),
  );

  for (const out of options.outputs) {
    if (out.endsWith(".png")) {
      const theme = options.theme === "auto" ? "light" : options.theme;
      await Bun.write(out, svgToPng(renderSvg(dataset, { ...options, theme, tooltips: false })));
    } else {
      await Bun.write(out, renderSvg(dataset, options));
    }
    options.log(`Wrote ${out}`);
  }
}
