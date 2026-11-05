import { readDataset } from "@language-history/format/file";
import { svgToPng } from "./png";
import { renderSvg, type SvgOptions } from "./svg";

export interface RenderOptions extends SvgOptions {
  /** JSONL dataset to read. */
  input: string;
  /** `.png` files become PNG, anything else SVG. */
  outputs: string[];
  /** Limit the rendered range (YYYY-MM-DD, inclusive). */
  from?: string;
  to?: string;
  log: (message: string) => void;
}

/** Reads a dataset file and writes each output file. */
export async function renderFiles(options: RenderOptions): Promise<void> {
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
