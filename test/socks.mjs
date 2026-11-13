// A minimal SOCKS5 server standing in for a proxy node in tests. It records every target it is
// asked for and maps *.cave.test (and optionally every host) to the local fixture server, so
// tests never need the public internet.
import { createServer, connect } from 'node:net';

export function startSocks({ map = () => null } = {}) {
  const targets = [];
  const sockets = new Set();
  const server = createServer((client) => {
    sockets.add(client);
    client.on('close', () => sockets.delete(client));
    client.on('error', () => undefined);
    client.once('data', (hello) => {
      if (hello[0] !== 5) return client.destroy();
      client.write(Buffer.from([5, 0]));
      client.once('data', (req) => {
        let host, port, p = 4;
        if (req[3] === 1) (host = [...req.subarray(4, 8)].join('.')), (p = 8);
        else if (req[3] === 3) (host = req.toString('utf8', 5, 5 + req[4])), (p = 5 + req[4]);
        else if (req[3] === 4) (host = req.subarray(4, 20).toString('hex').match(/.{4}/g).join(':')), (p = 20);
        port = req.readUInt16BE(p);
        targets.push({ host, port, atyp: req[3] });
        const to = map(host, port);
        if (!to) return client.end(Buffer.from([5, 2, 0, 1, 0, 0, 0, 0, 0, 0]));
        const upstream = connect(to.port, to.host, () => {
          client.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 0]));
          client.pipe(upstream).pipe(client);
        });
        upstream.on('error', () => client.destroy());
      });
    });
  });
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () =>
      resolve({
        port: server.address().port,
        targets,
        close: () => new Promise((r) => { for (const s of sockets) s.destroy(); server.close(r); }),
      }),
    ),
  );
}
