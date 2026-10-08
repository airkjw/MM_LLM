import { createServer } from "node:http";

// Synthetic loopback only. The source consumes the original body before redirecting;
// both same-origin and second-origin targets record every method/header/body received.
export async function redirectFixture(status, sameOrigin = false) {
  const first = [];
  const target = [];
  const receive = (requests, req, res, reply) => {
    const request = { method: req.method, url: req.url, headers: req.headers, body: "" };
    requests.push(request);
    req.on("data", chunk => { request.body += chunk; });
    req.on("end", () => reply(res));
  };
  const answer = res => { res.writeHead(200, { "content-type": "application/json" }); res.end('{"synthetic":true}'); };
  const destination = createServer((req, res) => receive(target, req, res, answer));
  const listen = server => new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const origin = server => `http://127.0.0.1:${server.address().port}`;
  await listen(destination);
  const source = createServer((req, res) => {
    if (req.url === "/redirected") return receive(target, req, res, answer);
    receive(first, req, res, response => {
      response.writeHead(status, { location: `${sameOrigin ? origin(source) : origin(destination)}/redirected` });
      response.end();
    });
  });
  try { await listen(source); }
  catch (error) { await new Promise(resolve => destination.close(resolve)); throw error; }
  return { first, target, origin: origin(source), async close() {
    for (const server of [source, destination]) server.closeAllConnections();
    await Promise.all([source, destination].map(server => new Promise(resolve => server.close(resolve))));
  } };
}
