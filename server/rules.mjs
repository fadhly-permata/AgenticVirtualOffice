import fs from 'node:fs/promises';
import path from 'node:path';

export const RULE_START = '<!-- virtoffice:rules:start -->';
export const RULE_END = '<!-- virtoffice:rules:end -->';

/**
 * One adapter per agentic tool. A tool without an adapter reports
 * `supported: false`, so wiring another tool means adding one entry here
 * instead of touching the routes.
 */
const ADAPTERS = {
  opencode: {
    file: 'AGENTS.md',
    render: (delayMs) => renderRule('task', delayMs),
  },
  claude: {
    file: 'CLAUDE.md',
    render: (delayMs) => renderRule('Agent', delayMs),
  },
};

function renderRule(tool, delayMs) {
  const seconds = String(delayMs / 1000);
  return [
    RULE_START,
    '## VirtOffice: jeda delegasi',
    '',
    `Blok ini diatur otomatis oleh VirtOffice (jeda ${seconds} detik) supaya animasi kantor tidak melihat subagent berdiri terlalu cepat.`,
    '',
    `- Tugas yang datang dari delegasi (\`${tool}\` subagent): jalankan \`sleep ${seconds}\` sebelum mulai bekerja, lalu \`sleep ${seconds}\` lagi setelah pekerjaan selesai sebelum mengirim laporan akhir.`,
    `- Saat mendelegasikan lewat \`${tool}\`, sertakan aturan jeda ini di prompt subagent.`,
    RULE_END,
  ].join('\n');
}

export function ruleAdapter(tool) {
  return ADAPTERS[tool] ?? null;
}

/**
 * Install or refresh the managed rule block in the workspace, leaving every
 * other byte of the file alone. `delayMs: 0` removes the block again.
 */
export async function upsertToolRules(tool, directory, { delayMs }) {
  const adapter = ruleAdapter(tool);
  if (!adapter) return { tool, file: null, delayMs, ok: false, supported: false, changed: false };

  const file = path.join(directory, adapter.file);
  const existing = await fs.readFile(file, 'utf8').catch((error) => {
    if (error.code === 'ENOENT') return '';
    throw error;
  });

  const next = delayMs > 0 ? withBlock(existing, adapter.render(delayMs)) : withoutBlock(existing);
  const changed = next !== existing;
  if (changed) await fs.writeFile(file, next, 'utf8');

  return { tool, file: adapter.file, delayMs, ok: true, supported: true, changed };
}

function withBlock(text, block) {
  const start = text.indexOf(RULE_START);
  if (start < 0) return `${text.trimEnd()}\n\n${block}\n`;

  const end = text.indexOf(RULE_END, start);
  const tail = end < 0 ? '' : text.slice(end + RULE_END.length);
  return `${text.slice(0, start)}${block}${tail}`;
}

function withoutBlock(text) {
  const start = text.indexOf(RULE_START);
  if (start < 0) return text;
  const end = text.indexOf(RULE_END, start);
  const tail = end < 0 ? '' : text.slice(end + RULE_END.length);
  const head = text.slice(0, start).trimEnd();
  const rest = tail.replace(/^\n+/, '');
  return head ? `${head}\n${rest ? `\n${rest}` : ''}` : rest;
}
