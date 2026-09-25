# The live relay

A small service that forwards session events between devices and **stores
nothing**. Zero dependencies — it is one file of plain Node.

You do not need it. Without a relay a drawing still follows you between
devices, because the durable copy lives in your own repo; it just takes a few
seconds on a device switch rather than arriving as you draw. The relay is what
makes two screens at once work: a tablet beside a laptop, or an interviewer
watching.

## Running it

```sh
node relay/server.mjs                 # :8788
PORT=3000 ALLOW_ORIGIN=https://you.github.io node relay/server.mjs
```

Then put its address in **Settings → Live sync**. Leave that field empty to
turn live sync off.

## Deploying it

It listens on `$PORT` and needs no storage, no database and no build step, so
any free tier that runs a Node process will do — Fly.io, Railway, Render,
Deno Deploy with minor changes. Set `ALLOW_ORIGIN` to your app's origin in
production, so a page on some other site cannot open one of your rooms.

Use HTTPS. The app refuses a plain `http://` relay for anything but localhost,
because an http relay would carry your session in the clear.

## What it can see

One session, while it is happening: the problem, the strokes, the code. That is
work somebody is already watching you do.

It never sees your practice log. The log lives in your private repo and is
never sent here — the interviewer's side receives events from one session and
has no way to ask for anything else. That is structural rather than a rule the
UI enforces.

Nothing is written to disk and nothing is buffered between connections. A room
exists only while somebody is listening to it and is forgotten the moment the
last listener leaves. A device that misses an event gets it from the repo on
the next poll, which is the same mechanism that covers a device that was
asleep.

## Why SSE and not a WebSocket

The traffic is one-way push plus occasional writes, which is what Server-Sent
Events are for. It is plain HTTP: no framing, no masking, no upgrade
negotiation, no dependency — and it survives the corporate proxies that quietly
drop WebSocket upgrades. That last one is not hypothetical when the person on
the other end is an interviewer whose network you cannot see and cannot debug.

## Endpoints

| | |
|---|---|
| `GET /r/:room?from=<device>` | Subscribe. `text/event-stream`, one `data:` frame per event. |
| `POST /r/:room?from=<device>` | Publish one event, or `{"batch":[…]}`. Not echoed to `from`. |
| `GET /health` | `{"ok":true,"rooms":n}` |

Room ids are session UUIDs, so they are unguessable; anyone holding one can
read and write it, which is what "send your interviewer a link" means.
