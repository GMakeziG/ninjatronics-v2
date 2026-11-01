// Reading time from the raw Markdown/MDX source. Code is counted at a slower
// rate than prose; frontmatter, MDX imports/exports, and markup are ignored.
const PROSE_WPM = 225;
const CODE_WPM = 100;

const countWords = (text: string): number => text.split(/\s+/).filter(Boolean).length;

export function readingMinutes(source: string | undefined): number {
  if (!source) return 1;

  const codeBlocks = source.match(/^(```|~~~)[\s\S]*?^\1/gm) ?? [];
  const codeWords = codeBlocks.reduce((sum, block) => sum + countWords(block), 0);

  const prose = source
    .replace(/^(```|~~~)[\s\S]*?^\1/gm, " ")
    .replace(/^(import|export)\s.*$/gm, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/[#*_>`~[\]()!|-]/g, " ");

  const minutes = countWords(prose) / PROSE_WPM + codeWords / CODE_WPM;
  return Math.max(1, Math.round(minutes));
}
