const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const { join } = require('node:path');

function requirePredicates(predicates) {
  for (const [name, value] of Object.entries(predicates)) assert.equal(value, true, `Acceptance predicate failed: ${name}`);
  return predicates;
}
function expectedArtifacts(pkg) {
  return [`Buildingdreams-${pkg.version}-x64-portable.exe`, `Buildingdreams-${pkg.version}-x64-nsis.exe`];
}
function assertArtifacts(names, pkg) {
  const wanted = expectedArtifacts(pkg).sort();
  assert.deepEqual(names.filter(n => /-(portable|nsis)\.exe$/.test(n)).sort(), wanted, 'Expected exactly current-version x64 portable and NSIS artifacts');
  return wanted;
}
function assertAlive(child) {
  assert(child.pid && child.exitCode === null && child.signalCode === null, 'Portable bootstrap exited before verification');
}
// Read-only protocol handshake. Closing this socket only disconnects this client;
// no page, Browser.close, or product IPC command is sent to an unverified endpoint.
async function browserCommandLine(endpoint) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(endpoint);
    let settled = false;
    const timer = setTimeout(() => finish(new Error('CDP identity handshake timed out')), 5000);
    function finish(error, args) {
      if (settled) return;
      settled = true; clearTimeout(timer);
      try { socket.close(); } catch {}
      error ? reject(error) : resolve(args);
    }
    socket.addEventListener('open', () => socket.send(JSON.stringify({ id: 1, method: 'Browser.getBrowserCommandLine' })));
    socket.addEventListener('error', () => finish(new Error('CDP identity handshake failed')), { once: true });
    socket.addEventListener('message', event => {
      try { const response = JSON.parse(String(event.data)); if (response.id === 1) { if (response.error) throw new Error(response.error.message); finish(null, response.result.arguments); } }
      catch (error) { finish(error); }
    });
  });
}
async function ownedEndpoint({ child, data, nonce, read = readFile, commandLine = browserCommandLine, pause = ms => new Promise(r => setTimeout(r, ms)), attempts = 60 }) {
  for (let i = 0; i < attempts; i++) {
    assertAlive(child);
    let record;
    try { record = await read(join(data, 'DevToolsActivePort'), 'utf8'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; await pause(500); continue; }
    const [port, path] = record.trim().split(/\r?\n/);
    assert(/^[0-9]+$/.test(port) && +port > 0 && +port <= 65535 && /^\/devtools\/browser\/[A-Za-z0-9-]+$/.test(path), 'Invalid isolated DevToolsActivePort record');
    const endpoint = `ws://127.0.0.1:${port}${path}`;
    const args = await commandLine(endpoint);
    assertAlive(child);
    assert(args.includes(`--zhumeng-smoke-nonce=${nonce}`), 'CDP endpoint nonce does not belong to spawned portable');
    assert(args.includes(`--user-data-dir=${data}`), 'CDP endpoint data directory does not belong to spawned portable');
    assert(args.includes('--remote-debugging-port=0'), 'Portable did not request an exclusive dynamic endpoint');
    return { endpoint, nonce, data, verifiedCommandLine: true };
  }
  throw new Error('Portable did not create its isolated DevToolsActivePort');
}
module.exports = { requirePredicates, assertArtifacts, expectedArtifacts, ownedEndpoint };
