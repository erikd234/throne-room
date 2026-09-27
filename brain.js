// The studio brain: one long-lived `gbrain serve` owned by the Throne server.
// GBrain's PGLite store takes one process at a time, so workers never open it
// themselves; they reach it through Throne's brain tools, which also lets the room
// draw a beam for every real read.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

export function gbrainClient(env) {
  let client = null, connecting = null;
  async function connect() {
    if (client) return client;
    if (connecting) return connecting;
    connecting = (async () => {
      const c = new Client({ name: 'throne', version: '1.0.0' });
      const transport = new StdioClientTransport({ command: 'gbrain', args: ['serve'], env, stderr: 'ignore' });
      transport.onclose = () => { if (client === c) client = null; };
      await c.connect(transport);
      client = c; return c;
    })().finally(() => { connecting = null; });
    return connecting;
  }
  async function call(name, args = {}) {
    const c = await connect();
    const r = await c.callTool({ name, arguments: args }, undefined, { timeout: 30000 });
    const text = (r.content || []).map(x => x.text || '').join('');
    if (r.isError) throw new Error(`gbrain ${name}: ${text.slice(0, 300)}`);
    try { return JSON.parse(text); } catch { return text; }
  }
  return { connect, call, close: async () => { try { await client?.close(); } catch {} client = null; } };
}
