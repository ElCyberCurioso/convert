// Datos estructurados: JSON, JSON Lines, YAML, TOML, XML, INI
// (entre sí y hacia tablas cuando los datos son una lista de registros).

import { parseTree, writeTree } from '../data/serialize.js';
import { valueToWorkbook, writeWorkbook } from './sheet.js';

const TREE_IN = ['json', 'jsonl', 'yaml', 'toml', 'xml', 'ini'];
const TREE_OUT = ['json', 'json-min', 'jsonl', 'yaml', 'toml', 'xml', 'ini'];
const TABLE_OUT = ['csv', 'csv-excel', 'tsv', 'xlsx', 'ods', 'sql', 'md', 'html', 'pdf'];

export default {
  id: 'data',
  routes: [
    {
      from: TREE_IN,
      to: TREE_OUT,
      allowSame: true,
      exclude: (from, to) => from === to && to !== 'json',
      sameLabels: { json: 'JSON (formatear)' },
      async run(input, to) {
        const value = await parseTree(input.format, await input.text());
        return writeTree(to, value);
      },
    },
    {
      from: TREE_IN,
      to: TABLE_OUT,
      labels: { md: 'Markdown (tabla)', html: 'HTML (tabla)', pdf: 'PDF (tabla)' },
      options: ['csvSafe', 'pdfOrientation'],
      async run(input, to, ctx) {
        const value = await parseTree(input.format, await input.text());
        const wb = await valueToWorkbook(value, input.base);
        return writeWorkbook(wb, to, ctx, input.base);
      },
    },
  ],
};
