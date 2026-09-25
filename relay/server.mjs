// The live relay. Forwards session events between devices and stores nothing.
//
//   node relay/server.mjs            # listens on :8788
//   PORT=3000 node relay/server.mjs
//
// Why this exists: git commits take a second or two and are rate-limited, so
// the durable channel gives handoff between devices and cannot give liveness.
// An interviewer watching you draw needs the stroke to appear as you draw it.
//
// Why SSE and a POST rather than a WebSocket. The traffic here is one-way push
// plus occasional writes, which is exactly what Server-Sent Events are for. It
// is plain HTTP: no framing, no masking, no upgrade dance, no dependency, and
// it survives the corporate proxies that quietly drop WebSocket upgrades —
// which matters when the person on the other end is an interviewer whose
// network you do not control and cannot debug.
//
// Why it stores nothing. It is a relay, not a record. Everything durable lives
// in the user's own repo, which is also what covers a device that missed an
// event: the next poll picks it up within seconds. A buffer here would make
// this a place somebody's work lives, which is the thing the architecture went
// out of its way to avoid.
//
// What it can see: whatever is in the room it is forwarding — strokes and code
// from one session that somebody is already watching. Not the practice log,
// which never leaves the user's repo and is never sent here.
//
// Rooms are session UUIDs, so they are unguessable, and anyone holding one can
// read and write it. That is inherent in "send your interviewer a link".

import { createServer } from "node:http";

const PORT = Number(process.env.PORT) || 8788;

/** Which origins may talk to this. `*` in development; set ALLOW_ORIGIN in
 *  production so a page on some other site cannot open a room. */
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || "*";

/** A published payload larger than this is not a stroke, it is a mistake or an
 *  attack. Generous enough for a compacted board. */
const MAX_BODY_BYTES = 256 * 1024;

/** Rooms only exist while somebody is listening. */
const rooms = new Map();   // roomId -> Set<res>

const cors = {
  "Access-Control-Allow-Origin": ALLOW_ORIGIN,
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
};

/** Rooms are session UUIDs. The length floor is what makes one unguessable, so
 *  a short id is refused rather than quietly creating a room anyone could hit
 *  by typing. */
const MIN_ROOM_ID = 8;

const roomIdFrom = (url) => {
  const m = /^\/r\/([A-Za-z0-9_-]{1,128})$/.exec(url.split("?")[0]);
  if (!m) return null;
  return m[1].length >= MIN_ROOM_ID ? m[1] : { tooShort: true };
};

function subscribe(roomId, req, res) {
  res.writeHead(200, {
    ...cors,
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    // Nginx and friends buffer by default, which turns a live stream into a
    // batch delivered at the end of the session.
    "X-Accel-Buffering": "no",
  });
  res.write(": connected\n\n");

  const peers = rooms.get(roomId) || new Set();
  peers.add(res);
  rooms.set(roomId, peers);

  // Proxies and phone networks drop an idle connection; a comment every twenty
  // seconds is cheap and keeps it open.
  const beat = setInterval(() => res.write(": ping\n\n"), 20_000);

  const close = () => {
    clearInterval(beat);
    peers.delete(res);
    if (!peers.size) rooms.delete(roomId);   // no listeners, no room
  };
  req.on("close", close);
  req.on("error", close);
}

function publish(roomId, req, res) {
  let size = 0;
  const chunks = [];
  req.on("data", (chunk) => {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      res.writeHead(413, cors).end();
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });
  req.on("end", () => {
    if (res.writableEnded) return;
    const body = Buffer.concat(chunks).toString("utf8");
    try {
      JSON.parse(body);   // forwarded verbatim, but never forwarded as garbage
    } catch (_) {
      res.writeHead(400, cors).end();
      return;
    }
    const from = new URL(req.url, "http://x").searchParams.get("from") || "";
    const frame = `data: ${body.replace(/\n/g, " ")}\n\n`;
    let sent = 0;
    for (const peer of rooms.get(roomId) || []) {
      // Not echoed to the sender. It already has the event — it is the one that
      // made it — and an echo would be a second copy to deduplicate for nothing.
      if (from && peer.ledgerFrom === from) continue;
      peer.write(frame);
      sent += 1;
    }
    res.writeHead(200, { ...cors, "Content-Type": "application/json" })
      .end(JSON.stringify({ delivered: sent }));
  });
}

createServer((req, res) => {
  if (req.method === "OPTIONS") { res.writeHead(204, cors).end(); return; }
  if (req.url === "/health") {
    res.writeHead(200, { ...cors, "Content-Type": "application/json" })
      .end(JSON.stringify({ ok: true, rooms: rooms.size }));
    return;
  }

  const roomId = roomIdFrom(req.url);
  if (!roomId) { res.writeHead(404, cors).end(); return; }
  if (roomId.tooShort) {
    // Said rather than left as a bare 404, because the symptom of getting this
    // wrong is a client that connects to nothing and reports no reason.
    res.writeHead(400, { ...cors, "Content-Type": "application/json" })
      .end(JSON.stringify({ error: `room id must be at least ${MIN_ROOM_ID} characters` }));
    return;
  }

  if (req.method === "GET") {
    res.ledgerFrom = new URL(req.url, "http://x").searchParams.get("from") || "";
    subscribe(roomId, req, res);
    return;
  }
  if (req.method === "POST") { publish(roomId, req, res); return; }
  res.writeHead(405, cors).end();
}).listen(PORT, () => {
  console.log(`relay listening on :${PORT} (origin ${ALLOW_ORIGIN}, storing nothing)`);
});
