declare module "pdf-parse/lib/pdf-parse.js" {
  function parse(input: Buffer): Promise<{ text: string; numpages: number }>;
  export = parse;
}
