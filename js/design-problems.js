// The system-design problem bank, and the worked answers.
//
// Where this fits: the design half's equivalent of the coding catalog. A coding
// problem names the pattern it wants; a design problem names the components its
// reference answer reaches for, which is what makes component mastery, search,
// drills and the practice ladder work identically on both halves of the app.
//
// The format follows how the interview actually runs, and the practice format
// follows from it: you whiteboard your own answer against the clock, and only
// then reveal this. Comparing is the exercise. Reading it first is not.
//
// `walkthrough` is staged rather than a finished diagram on purpose. A complete
// architecture shown at once is a picture to admire; the same architecture
// arrived at in six steps, each naming the pressure that forced the next box,
// is an argument you can reconstruct — which is what an interview asks for.
//
// `rubric` is what a good answer covers, not what this answer says. There is
// more than one right design, and a bank that only rewards matching the
// reference teaches the wrong thing.

export const DESIGN_PROBLEMS = [
  {
    id: "url-shortener",
    name: "Design a URL shortener",
    difficulty: "Easy",
    tags: ["read-heavy", "key-value", "caching"],
    prompt:
      "Design a service that turns a long URL into a short one and redirects anyone who visits the short link.",
    requirements: {
      functional: [
        "Create a short code for a given URL",
        "Redirect a short code to its original URL",
        "Optionally let the caller choose a custom alias",
      ],
      nonFunctional: [
        "Redirects must be fast — this is on the critical path of somebody else's page load",
        "Read-to-write ratio is enormous, on the order of 100:1 or worse",
        "Links effectively never expire, so storage only grows",
      ],
    },
    estimate: {
      assumptions: ["100M new links/day", "100:1 read:write", "~500 bytes stored per link"],
      derive: [
        "Writes: 100M/day ÷ 86,400 ≈ 1,200/s average, call it 3,000/s peak",
        "Reads: 100:1 → ~120,000/s average — this is a read system with a write feature",
        "Storage: 100M × 500B = 50GB/day ≈ 18TB/year — large, but not exotic",
        "A 7-character base62 code gives 62⁷ ≈ 3.5 × 10¹² codes: centuries of headroom",
      ],
    },
    entities: [
      { name: "Link", fields: "code (pk), longUrl, ownerId, createdAt, expiresAt?",
        note: "Immutable once created. That single fact is what makes the entire read path cacheable, and it is worth saying out loud." },
      { name: "User", fields: "id, email",
        note: "Only exists if custom aliases or per-owner stats are in scope. If they are not, say so and leave it out." },
      { name: "Click", fields: "code, at, country, referrer",
        note: "Append-only, and off the redirect path. It is a different system that happens to share a key." },
    ],
    api: [
      { call: "POST /links", body: "{ longUrl, customAlias?, expiresAt? }", returns: "201 { code, shortUrl }",
        note: "The only write in the system. Everything else is a read." },
      { call: "GET /{code}", body: "—", returns: "302 Location: longUrl",
        note: "Not under /links. The short URL is the product, and every prefix character is one the user has to carry." },
      { call: "DELETE /links/{code}", body: "—", returns: "204",
        note: "Needs an owner, which is the reason User is an entity at all." },
      { call: "GET /links/{code}/stats", body: "—", returns: "200 { clicks, byDay }",
        note: "Served from the analytics store. Never from the redirect path." },
    ],
    deepDives: [
      {
        q: "Custom aliases and generated codes share one namespace. What stops them colliding?",
        answer: "One table, with uniqueness enforced by the store rather than by a check in the application: insert-if-absent, or a conditional write. A custom alias that loses the race gets a 409 and the caller picks again. Generated codes cannot collide with each other by construction — they come from a counter, not a hash — so only the custom path pays for the check.",
        watchFor: "\"Check whether it exists, then write it\" is two operations with a race between them. Say what makes it one.",
      },
      {
        q: "One link goes viral: a million reads a second, every one of them the same key. What breaks first?",
        answer: "The single cache shard that key hashes to. Adding cache nodes does not help, because the load is one key and partitioning cannot split it. The value is tiny and immutable, so replicate rather than partition: cache it at the CDN edge with a long TTL and keep a small in-process LRU on each app server. The origin then sees one request per server per TTL.",
        watchFor: "Adding capacity the hot key cannot use. Name the hot-key problem as a hot-key problem.",
      },
      {
        q: "Storage is 18TB and only grows. How do you expire links without scanning it?",
        answer: "Expiry is a property of the row, so check expiresAt on read and return 410. That makes correctness independent of any sweep ever running. Reclaiming the space is a separate, lazy job — a store-native TTL, or an index on expiry walked in the background — and the read path never waits for it.",
        watchFor: "A nightly scan of the whole table, or treating expiry as a deletion problem rather than a read-time check.",
      },
      {
        q: "301 or 302 — and what does that choose for you?",
        answer: "301 is permanent: browsers and intermediaries cache it, so the redirect becomes free, and in exchange you stop seeing the clicks and can never change where the link points. 302 sends every click back to you, which buys analytics and re-targeting at the cost of a round trip every time. It is a requirements question: a marketing link that must be counted and re-pointed is a 302.",
        watchFor: "Picking one as a preference rather than deriving it from a requirement.",
      },
      {
        q: "120,000 clicks a second, each one an analytics event. How does that not slow the redirect down?",
        answer: "The redirect returns before the event is durable. Write it to a local buffer or a log shipper, batch it, and aggregate downstream. Losing a handful of events in a crash is acceptable for a click count; a slow redirect is not. If the count has to be exact, that is a requirement — say so, and pay for it with a durable queue rather than pretending it is free.",
        watchFor: "A synchronous insert into the analytics store on the hot path.",
      },
    ],
    walkthrough: [
      {
        title: "The smallest thing that works",
        components: ["app-servers", "relational-db"],
        says: "One service, one table: code → long URL. Write inserts a row, read selects by primary key and returns a 301.",
        because: "Start where the interviewer can see the whole thing. Everything after this is a response to a specific pressure, and naming the pressure is the part being assessed.",
      },
      {
        title: "Where the code comes from",
        components: ["key-value"],
        says: "Generate codes from a counter encoded in base62, handing each app server a pre-allocated block of the number space. Do not hash the URL and hope.",
        because: "Hashing needs collision handling on every write and makes the same URL collide with itself. A counter is ordered, dense and free of collisions; block allocation stops the counter itself becoming the bottleneck.",
        watchFor: "Sequential codes are guessable. If links are private, that is a requirement, not a detail — say so and add randomness inside the block.",
      },
      {
        title: "Reads leave the database",
        components: ["cache"],
        says: "Put a cache in front of the lookup, keyed by code, with a long TTL. Links are immutable once created, which makes this the easy kind of caching.",
        because: "120,000 reads/s against one database is the actual problem in this design. Immutable values mean no invalidation problem at all — the hard part of caching simply does not arise here.",
        watchFor: "A cold cache hands the whole read load to the database at once. Say what happens on restart.",
      },
      {
        title: "Reads leave your servers entirely",
        components: ["cdn"],
        says: "Serve the redirect at the edge where the platform allows it, or at minimum put the redirect behind a CDN with a long TTL.",
        because: "A redirect is a tiny, cacheable, geographically-sensitive response — the textbook case for an edge. It also cuts the latency a user's browser actually experiences, which is the whole product.",
      },
      {
        title: "Storage past one machine",
        components: ["sharding", "key-value"],
        says: "Shard by the short code itself. Every read and every write already carries it, so no query needs to cross a shard.",
        because: "18TB/year outgrows one box. The shard key is obvious here precisely because the access pattern is: the code is in every request, so nothing scatters.",
        watchFor: "Analytics — 'how many clicks did this get' — is a different access pattern and does not belong on this path.",
      },
      {
        title: "Counting clicks without slowing redirects",
        components: ["queue", "worker-pool", "wide-column"],
        says: "Fire an event per redirect onto a queue and aggregate it asynchronously. Never write to a counter on the redirect path.",
        because: "A synchronous counter write doubles the cost of the hottest path in the system and couples a redirect's availability to the analytics store's. Losing a click count is acceptable; failing a redirect is not.",
      },
    ],
    rubric: [
      "Asked about read:write ratio before designing anything",
      "Computed enough scale to justify the choices, rather than assuming 'big'",
      "Chose a code generation scheme and defended it against the alternative",
      "Put a cache on the read path and said what happens when it is cold",
      "Named a shard key and showed that queries carry it",
      "Kept analytics off the redirect path",
      "Said what is lost when each component fails",
    ],
  },

  {
    id: "rate-limiter",
    name: "Design a distributed rate limiter",
    difficulty: "Medium",
    tags: ["coordination", "caching", "consistency"],
    prompt:
      "Design a rate limiter that caps each API client at N requests per minute, across a fleet of gateway instances.",
    requirements: {
      functional: [
        "Allow or reject a request based on the client's recent rate",
        "Limits configurable per client and per endpoint",
        "Tell the client the limit, what is left, and when it resets",
      ],
      nonFunctional: [
        "The check is on every request, so it must add ~1ms, not ~10ms",
        "Must stay roughly correct across many gateway instances",
        "It must not become the reason the API is down",
      ],
    },
    estimate: {
      assumptions: ["50,000 req/s across the fleet", "20 gateway instances", "1M distinct clients"],
      derive: [
        "50,000 counter operations/s — a single Redis handles this, but not with room to spare",
        "1M clients × a small counter ≈ tens of MB: memory is not the constraint, round trips are",
        "Per-instance limits would give 20× the intended limit, so the state must be shared",
      ],
    },
    entities: [
      { name: "Policy", fields: "subject (clientId | ip | apiKey), endpoint, limit, windowSec",
        note: "Configuration, not traffic: read constantly, written rarely. Keeping it data rather than code is what makes a limit changeable without a deploy." },
      { name: "Counter", fields: "key = subject:endpoint:window, count, expiresAt",
        note: "The only hot thing in the system. It lives in memory and is allowed to be lost — which is a decision you should make deliberately, not discover." },
      { name: "Decision", fields: "allowed, remaining, resetAt, retryAfter",
        note: "Not stored. It is the response, and those four fields are the response headers." },
    ],
    api: [
      { call: "check(subject, endpoint, cost)", body: "in-process", returns: "{ allowed, remaining, resetAt }",
        note: "A library call inside the gateway, not a service call. Making it an HTTP hop adds exactly the latency the design is trying to avoid." },
      { call: "GET /limits/{subject}", body: "—", returns: "200 { limits }",
        note: "So a customer can see their own limits instead of discovering them by being rejected." },
      { call: "PUT /limits/{subject}", body: "{ endpoint, limit, windowSec }", returns: "204",
        note: "The config plane. This is the endpoint that makes \"raise their limit now\" possible." },
      { call: "every response", body: "—", returns: "X-RateLimit-Limit / -Remaining / -Reset, and 429 + Retry-After",
        note: "Telling the client when to come back is the difference between backing off and hammering you." },
    ],
    deepDives: [
      {
        q: "Raise one customer's limit right now, with no deploy. How?",
        answer: "The policy is a row, not a constant. Gateways read it from a store and keep it in a local cache with a short TTL, or subscribe to change notifications. The cost is a bounded window of staleness — name the number, ten seconds or so, and confirm it is acceptable.",
        watchFor: "Limits compiled into the gateway, or a read of the policy store on every request — which puts the config plane on the hot path.",
      },
      {
        q: "The counter store is unreachable. Does everything get rejected, or does everything get through?",
        answer: "This is a business decision and the answer is that somebody must have made it. Fail open keeps the product up and accepts a window of abuse; fail closed protects the backend and turns a dependency outage into your outage. The usual choice is to fail open with a conservative per-instance local limit, so it degrades instead of disappearing.",
        watchFor: "Not having an answer, or picking one without saying whose risk is being taken.",
      },
      {
        q: "100 million distinct clients. What does the counter state actually cost?",
        answer: "Only clients seen inside the current window have a counter, and those counters expire with the window — the working set is active clients, not all clients. At roughly a hundred bytes a key, a million active clients is about 100MB, which fits in memory comfortably. That sizing only holds for a counter-based algorithm: a sliding log stores an entry per request and does not fit.",
        watchFor: "Sizing for every client who ever existed, or choosing sliding-log accuracy without pricing its storage.",
      },
      {
        q: "A fixed window lets a client send 2N requests across the boundary. Does that matter, and what do you do?",
        answer: "It is real: N at the end of one window and N at the start of the next is a 2N burst against a backend sized for N. A sliding window counter — weighting the previous window by how much of it is still in view — removes most of the error for one extra read and no per-request storage. A token bucket is the answer if bursts are something you want to allow deliberately rather than merely tolerate.",
        watchFor: "Asserting that a fixed window is fine without acknowledging the seam.",
      },
      {
        q: "The check runs on every request. Where does it physically run?",
        answer: "In the gateway process, against a counter that is either local with asynchronous reconciliation or in a store on the same rack. A cross-availability-zone round trip per request is the thing to design out — it can cost more than the work being protected. Pipeline or batch the updates where the algorithm allows it.",
        watchFor: "A network call to a distant, strongly consistent store on every single request.",
      },
    ],
    walkthrough: [
      {
        title: "Name the algorithm before the infrastructure",
        components: [],
        says: "Fixed window is one counter per client per minute. Sliding window log is exact and stores every timestamp. Token bucket allows a burst then a steady rate. Pick token bucket unless told otherwise.",
        because: "Each has a specific failure: fixed window lets 2× through across a boundary, the log costs memory proportional to traffic, and token bucket is approximate at the edges. Interviewers are listening for you to name the tradeoff, not the algorithm.",
      },
      {
        title: "Shared state, because per-instance is not a limit",
        components: ["cache"],
        says: "Keep the counter in Redis, keyed by client and window. Do the check and decrement in one atomic operation — a Lua script or INCR with expiry — not read-then-write.",
        because: "Twenty instances each enforcing the limit enforce twenty times the limit. Read-then-write races under exactly the load the limiter exists for.",
        watchFor: "A round trip per request is the latency budget. Say the number.",
      },
      {
        title: "Making it fast enough",
        components: ["cache", "rate-limiter"],
        says: "Give each instance a local allowance drawn from the shared budget, refilled periodically. Check locally; synchronise in the background.",
        because: "This is the real answer to 'add 1ms not 10ms'. It trades exactness for latency — the limit becomes approximate near the boundary — which for rate limiting is a trade almost always worth making, and saying so out loud is the point.",
      },
      {
        title: "What happens when the counter store is down",
        components: ["load-shedding"],
        says: "Decide fail-open or fail-closed, and say why. For a public API protecting scarce capacity, fail closed to a conservative local limit. For a login flow, fail open.",
        because: "This is the question that separates a design from a diagram. Either answer is defensible; having not considered it is not.",
      },
      {
        title: "Telling the client",
        components: ["api-gateway"],
        says: "Return 429 with the limit, remaining and reset headers, plus Retry-After.",
        because: "A client that is refused without being told when to return will retry immediately, and your limiter becomes a load amplifier.",
      },
    ],
    rubric: [
      "Named an algorithm and its specific failure mode",
      "Recognised per-instance counters do not enforce a fleet limit",
      "Made the check-and-decrement atomic",
      "Addressed the latency cost of a round trip per request",
      "Decided fail-open vs fail-closed deliberately",
      "Told the client enough to back off correctly",
    ],
  },

  {
    id: "news-feed",
    name: "Design a news feed",
    difficulty: "Hard",
    tags: ["fan-out", "caching", "ranking"],
    prompt:
      "Design the home timeline for a social network: the list of recent posts from everyone a user follows.",
    requirements: {
      functional: [
        "A user sees recent posts from people they follow",
        "Posting is fast and appears promptly for followers",
        "The feed is paginated and stable enough to scroll",
      ],
      nonFunctional: [
        "Feed load is the most common request in the product, and must be fast",
        "The follower graph is wildly uneven — most users have hundreds, some have millions",
        "Slightly stale is fine; missing a post entirely is not",
      ],
    },
    estimate: {
      assumptions: ["500M daily users", "2 posts/user/day", "each user follows ~200", "feed opened 10×/day"],
      derive: [
        "Writes: 1B posts/day ≈ 12,000/s",
        "Feed reads: 5B/day ≈ 58,000/s — this is fundamentally a read system",
        "Fan-out on write: 1B posts × 200 followers = 200B timeline inserts/day. That number is the whole problem.",
      ],
    },
    entities: [
      { name: "User", fields: "id, handle, displayName", note: "" },
      { name: "Follow", fields: "followerId, followeeId, createdAt",
        note: "The edge, and the whole problem. Its cardinality is what decides push against pull." },
      { name: "Post", fields: "id, authorId, body, createdAt", note: "" },
      { name: "FeedEntry", fields: "userId, postId, score, createdAt",
        note: "Only exists if you fan out on write. It is a materialised view — derivable, rebuildable, and safe to cap." },
    ],
    api: [
      { call: "POST /posts", body: "{ body, mediaIds? }", returns: "201 { id, createdAt }",
        note: "Returns as soon as the post is durable. Fan-out happens after, asynchronously." },
      { call: "GET /feed", body: "?cursor=&limit=", returns: "200 { items, nextCursor }",
        note: "A cursor, not an offset. An offset page shifts under the reader every time somebody posts." },
      { call: "POST /follows/{userId}", body: "—", returns: "204", note: "" },
      { call: "DELETE /follows/{userId}", body: "—", returns: "204", note: "" },
    ],
    deepDives: [
      {
        q: "A user with 50 million followers posts. What happens?",
        answer: "Fan-out on write turns one post into fifty million writes, and the queue backs up behind it for everyone else. So do not fan those out: above a threshold an author is pulled at read time and merged with the pushed feed. The cost is that every read now does a merge, and the threshold is a number you tune rather than derive.",
        watchFor: "\"Make the queue bigger.\" The problem is not throughput, it is that the work is unbounded per post.",
      },
      {
        q: "Someone unfollows. Do you rewrite their timeline?",
        answer: "No. Filter at read time against the current follow set and let the stale entries age out of the capped list. Rewriting is work proportional to everything that author ever posted, triggered by an action that happens constantly and that nobody is waiting on.",
        watchFor: "A delete-by-author sweep across the unfollower's feed — correct, and far too expensive for what it buys.",
      },
      {
        q: "A brand-new user follows nobody. What is in their feed?",
        answer: "Nothing, which is a product failure rather than a correct empty result. Serve a global or topical popular feed until there are enough follows to personalise, and say that is what you are doing. This is worth naming precisely because it is the part that gets skipped as an infrastructure question when it is a product one.",
        watchFor: "Returning an empty list and treating it as correct.",
      },
      {
        q: "Rank by relevance instead of recency. What changes?",
        answer: "The feed store stops being the answer and becomes a candidate set. Scoring moves to read time over a bounded number of candidates, with features precomputed offline so the read stays cheap. Pagination gets harder: pin the ranking inputs per scroll session, or the same post appears twice as scores move under the reader.",
        watchFor: "Ranking the whole corpus at read time, or ignoring what ranking does to pagination stability.",
      },
      {
        q: "How large do you let one user's materialised feed get?",
        answer: "Capped — the most recent several hundred entries. Deep scrolling past the cap falls back to a pull, which is rare enough to be allowed to be slower. An uncapped per-user list is storage proportional to users times their following activity, with no natural limit.",
        watchFor: "Unbounded per-user lists, which is the version of this design that works in a demo and not in a year.",
      },
    ],
    walkthrough: [
      {
        title: "The two approaches, stated as a tradeoff",
        components: [],
        says: "Fan-out on write pushes each post into every follower's timeline — expensive writes, trivial reads. Fan-out on read assembles the feed by querying everyone you follow — cheap writes, expensive reads.",
        because: "Every good answer to this problem is a position on this tradeoff. Picking one without naming the other is the most common way this interview goes wrong.",
      },
      {
        title: "Fan-out on write, for almost everyone",
        components: ["queue", "worker-pool", "wide-column"],
        says: "On post, enqueue a fan-out job; workers append the post id into each follower's timeline list, stored per user and capped at a few hundred entries.",
        because: "Reads outnumber writes five to one and are latency-critical, so pay on write. A capped list bounds storage and matches how far anyone actually scrolls.",
        watchFor: "This is asynchronous, so a post appears in followers' feeds a second or two later. That is a product decision — check it is acceptable.",
      },
      {
        title: "Celebrities break it, so exclude them",
        components: ["cache"],
        says: "Above a follower threshold, do not fan out. Store those posts once, and merge them into the feed at read time from a small per-celebrity cache.",
        because: "One post to 100M followers is 100M writes for one action. The hybrid is the actual answer to this interview: fan-out on write for the tail, fan-out on read for the head, merged at request time.",
        watchFor: "Name the threshold and say it is tunable. A hard-coded 10,000 invites the follow-up about why.",
      },
      {
        title: "Serving the read",
        components: ["cache", "app-servers"],
        says: "Keep the top of each timeline in cache. A feed request reads the cached list of ids, merges any celebrity posts, then hydrates the post bodies in one batched fetch.",
        because: "Separating the id list from the post bodies means one cached post object serves every follower, instead of being copied into every timeline.",
      },
      {
        title: "Ranking, if asked",
        components: ["stream-processing", "search-index"],
        says: "Chronological first. If ranking is required, score candidates at read time from features maintained by a stream job, and keep the candidate set small.",
        because: "Ranking turns a merge into a scoring problem and changes the caching story completely. Do not volunteer it before the interviewer asks; do have an answer.",
      },
      {
        title: "Pagination that does not repeat itself",
        components: [],
        says: "Cursor on post id or timestamp, never offset.",
        because: "An offset into a list that is growing at the head shows the same post twice. It is a small thing that signals whether you have built one of these.",
      },
    ],
    rubric: [
      "Stated the fan-out tradeoff in both directions before choosing",
      "Computed the fan-out write volume and used it to justify the choice",
      "Handled the celebrity case as a hybrid rather than ignoring it",
      "Separated timeline ids from post bodies",
      "Made fan-out asynchronous and acknowledged the staleness that buys",
      "Used a cursor rather than an offset",
      "Bounded per-user timeline storage",
    ],
  },

  {
    id: "chat",
    name: "Design a chat system",
    difficulty: "Hard",
    tags: ["realtime", "delivery", "ordering"],
    prompt:
      "Design one-to-one and small-group messaging with delivery receipts and history.",
    requirements: {
      functional: [
        "Send and receive messages in near real time",
        "Messages are durable and readable as history",
        "Sent / delivered / read receipts",
        "Delivery to a recipient who is offline right now",
      ],
      nonFunctional: [
        "Delivery in well under a second when both parties are online",
        "Messages must never be lost, and must not be shown out of order",
        "Connection count is the scaling unit, not request rate",
      ],
    },
    estimate: {
      assumptions: ["50M concurrent connections", "40 messages per user per day", "500M users"],
      derive: [
        "50M concurrent sockets ÷ ~50k per node = ~1,000 connection nodes",
        "20B messages/day ≈ 230,000/s average",
        "Storage at ~200 bytes/message ≈ 4TB/day — this is a write-heavy store",
      ],
    },
    entities: [
      { name: "User / Device", fields: "userId, deviceId, pushToken",
        note: "Delivery is per device, not per user. That distinction is most of what makes receipts and multi-device hard." },
      { name: "Conversation", fields: "id, type (direct | group), memberIds", note: "" },
      { name: "Message", fields: "id, conversationId, senderId, body, sentAt, seq",
        note: "seq is per conversation and assigned by the server. It is what makes \"what order did this happen in\" a question with an answer." },
      { name: "Receipt", fields: "conversationId, userId, deviceId, upToSeq, state (delivered | read)",
        note: "Up-to a sequence, not per message — otherwise a screenful of messages is a screenful of writes." },
      { name: "Connection", fields: "userId, deviceId, nodeId, since",
        note: "Ephemeral routing state with a TTL. It is not history and must not be treated as durable." },
    ],
    api: [
      { call: "WS connect", body: "auth token", returns: "session established",
        note: "The connection is the subscription. There is no polling endpoint to design." },
      { call: "WS send", body: "{ conversationId, clientMsgId, body }", returns: "ack { id, seq, sentAt }",
        note: "clientMsgId makes a resend after a dropped connection idempotent instead of a duplicate." },
      { call: "GET /conversations/{id}/messages", body: "?afterSeq=&limit=", returns: "200 { messages, nextSeq }",
        note: "Catch-up is a query by sequence, which is why the server assigns one." },
      { call: "POST /conversations/{id}/receipts", body: "{ upToSeq, state }", returns: "204", note: "" },
    ],
    deepDives: [
      {
        q: "A node holding 50,000 connections crashes. What happens to those users?",
        answer: "Connections are ephemeral, so nothing durable is lost: clients reconnect — with backoff and jitter, or all fifty thousand arrive at the replacement together — their registry entries expire by TTL, and anything sent meanwhile was persisted before it was delivered, so it arrives on resume. The property that makes this true is writing before delivering, and it is worth saying explicitly.",
        watchFor: "Any answer in which an in-flight message existed only in the crashed node's memory.",
      },
      {
        q: "A client has been offline for a week. How does it catch up without downloading everything?",
        answer: "It knows the last sequence it saw per conversation and asks for what came after, paginated. Conversations it has not opened are fetched lazily when opened rather than eagerly on connect. The server keeps a bounded backlog and is allowed to answer \"that is too old, here is a snapshot instead\".",
        watchFor: "Replaying a global log, or sending the whole history on reconnect.",
      },
      {
        q: "Group chat with a thousand members. How does one send become a thousand deliveries?",
        answer: "One durable write to the conversation, then fan out to connected devices only; everyone else picks it up from history on resume. Receipts have to aggregate — a count of who has read up to which sequence — because a thousand receipt rows per message per state is more write traffic than the messages themselves.",
        watchFor: "A thousand durable writes per message, or per-member receipt rows.",
      },
      {
        q: "Two messages are sent at the same instant from different devices. What order does everyone see?",
        answer: "The order the server commits them in, expressed as the per-conversation sequence, and it is the same for every participant. Client timestamps are for display and will disagree — clocks are not synchronised and cannot be made to be. Total ordering per conversation is enough here; global ordering across all conversations is neither needed nor affordable.",
        watchFor: "Ordering by client timestamp, or promising a global order.",
      },
      {
        q: "Add end-to-end encryption. What does it cost you?",
        answer: "The server stops being able to read content, so everything that depended on reading it goes: server-side search, link previews, spam classification and moderation either move to the client or stop existing. Key distribution and adding a second device become the hard problems. Metadata — who talks to whom, when, how much — is still visible, and pretending otherwise is the common mistake.",
        watchFor: "\"Just encrypt the messages\" without naming the features that die.",
      },
    ],
    walkthrough: [
      {
        title: "Connections are the architecture",
        components: ["websockets", "load-balancer"],
        says: "A tier of connection servers holding long-lived sockets, behind a load balancer configured for upgrades and long idle timeouts. This tier is stateful by nature.",
        because: "Everything about this design follows from the fact that a user is attached to one specific machine. That is the constraint the rest of the answer works around.",
      },
      {
        title: "Finding the machine a user is on",
        components: ["cache", "pub-sub"],
        says: "Keep a session registry — user id to connection node — in a shared cache, and route a message by publishing to that node's channel.",
        because: "The sender's connection is on a different node from the recipient's. Something has to know where to deliver, and a registry plus pub/sub is the standard answer.",
        watchFor: "The registry is stale the moment a node dies. Say how it is repaired — TTL plus heartbeat.",
      },
      {
        title: "Durable before delivered",
        components: ["wide-column", "queue"],
        says: "Write the message to storage first, then attempt delivery. Partition history by conversation id, clustered by message id so a read is a range scan.",
        because: "'Never lost' means the write happens before the network hop that might fail. Doing it the other way round is the bug this design is most often written with.",
      },
      {
        title: "Ordering, honestly",
        components: ["event-log"],
        says: "Order per conversation, not globally, using a sequence assigned by the store. Clients sort by it and can detect gaps.",
        because: "Global ordering across a chat system is neither achievable nor wanted. Per-conversation is what users perceive, and it is cheap because a conversation is a partition.",
      },
      {
        title: "Offline recipients",
        components: ["queue", "worker-pool"],
        says: "If the registry shows no connection, the message is already durable; queue a push notification. On reconnect the client asks for everything after its last sequence number.",
        because: "Offline is the normal case, not the exception. A design that only works when both parties are connected is answering an easier question.",
      },
      {
        title: "Receipts as messages",
        components: ["pub-sub"],
        says: "Delivered and read are just small events on the same path, written and routed the same way.",
        because: "Reusing the delivery path instead of inventing a second one keeps ordering and durability guarantees identical for both, which is the only way the two stay consistent.",
      },
    ],
    rubric: [
      "Recognised connections, not requests, as the scaling unit",
      "Solved routing between connection nodes explicitly",
      "Persisted before delivering",
      "Scoped ordering to a conversation and said why not globally",
      "Handled the offline case as the normal path",
      "Said what happens when a connection node dies",
    ],
  },

  {
    id: "web-crawler",
    name: "Design a web crawler",
    difficulty: "Medium",
    tags: ["pipeline", "coordination", "storage"],
    prompt:
      "Design a crawler that fetches and stores a large portion of the public web, politely and without repeating itself.",
    requirements: {
      functional: [
        "Fetch pages starting from a seed set and follow links",
        "Store page content for downstream indexing",
        "Do not fetch the same URL repeatedly",
        "Respect robots.txt and per-host politeness",
      ],
      nonFunctional: [
        "Throughput in the thousands of pages per second",
        "Must not overwhelm any single host",
        "Must make progress despite crashes, and not restart from scratch",
      ],
    },
    estimate: {
      assumptions: ["1B pages/month", "~100KB per page"],
      derive: [
        "1B ÷ 2.6M seconds ≈ 400 pages/s average, several thousand at peak",
        "100TB/month of raw content — object storage, not a database",
        "URL seen-set at 1B+ entries: a Bloom filter is the classic answer",
      ],
    },
    entities: [
      { name: "UrlRecord", fields: "url (normalised, pk), host, firstSeen, lastFetched, etag, status, nextEligibleAt",
        note: "Normalisation is part of identity here: the same page reached three ways must be one record or the dedup does nothing." },
      { name: "Page", fields: "urlHash, fetchedAt, contentHash, blobRef",
        note: "The content is in a blob store; this row is a pointer to it. contentHash is what catches the same page served at many URLs." },
      { name: "HostState", fields: "host, robots, crawlDelay, lastFetchedAt, healthy",
        note: "Politeness is per host, which makes the host a first-class entity rather than a field on a URL." },
      { name: "FrontierEntry", fields: "url, host, priority, leasedUntil",
        note: "Leased, not popped. A worker that dies must not take its URLs with it." },
    ],
    api: [
      { call: "enqueue(urls[], fromUrl)", body: "internal", returns: "accepted count",
        note: "Normalises, dedups and drops anything robots disallows before it ever reaches the frontier." },
      { call: "next(workerId)", body: "internal", returns: "{ url, host, leaseUntil }",
        note: "A lease with a visibility timeout. This one choice is what makes worker crashes a non-event." },
      { call: "complete(url, result)", body: "{ status, contentHash, links[] }", returns: "ok",
        note: "Must be safe to apply twice, because a lease that expires mid-flight means it will be." },
      { call: "GET /crawl/status", body: "—", returns: "200 { queued, inFlight, fetchedPerSec, byHost }",
        note: "A crawler without this is a program you cannot tell is stuck." },
    ],
    deepDives: [
      {
        q: "A calendar page generates infinite URLs. How do you not crawl it forever?",
        answer: "Bound it rather than try to detect it: a per-host page budget, a depth limit from each seed, aggressive URL normalisation to collapse parameter permutations, and content hashing so a page that only produces near-duplicates stops being expanded from. Traps are indistinguishable from large sites, so the defence has to be a budget rather than a classifier.",
        watchFor: "Pattern blacklists as the primary defence — they only catch the traps somebody has already seen.",
      },
      {
        q: "Which URL do you fetch next, and why that one?",
        answer: "Not FIFO. Score by host importance, observed change frequency, depth from seed, and how overdue a refetch is. But the frontier is already partitioned by host for politeness, so priority operates inside a host's queue and across hosts you are choosing which host is eligible now — the two constraints have to be designed together.",
        watchFor: "A single global priority queue, which pulls directly against the per-host rate limiting.",
      },
      {
        q: "Your Bloom filter says you have seen this URL. What is the false-positive rate, and does it matter?",
        answer: "A false positive means a page is never fetched — a silent, permanent omission with nothing to alert on. Size it for the URL count you expect and state the rate: around ten bits per element gives roughly one percent. For anything that matters, back it with an exact lookup in the store. The filter's errors only go one way, and that direction is the tolerable one, which is why it is the right structure here.",
        watchFor: "Not knowing which direction the filter can be wrong in.",
      },
      {
        q: "A worker dies holding fifty leased URLs. What happens to them?",
        answer: "Their leases expire and they become eligible again, with no coordination and nobody noticing. That requires fetch and complete to be idempotent, because a lease that expires while the work is still in flight means the same URL genuinely will be processed twice.",
        watchFor: "A pop-based queue, where a crash loses the work silently.",
      },
      {
        q: "A host publishes a stricter robots.txt, or starts returning 429. How fast do you comply?",
        answer: "robots is cached per host with a TTL and refetched on a schedule, so compliance is bounded by that TTL — name it. A 429 or a 503 with Retry-After feeds straight into that host's state and slows it immediately, without waiting for anything. Because politeness is enforced at the host partition, one host backing off does not slow the fleet.",
        watchFor: "Caching robots indefinitely, or treating 429 as a transient error to retry through.",
      },
    ],
    walkthrough: [
      {
        title: "A pipeline, not a program",
        components: ["queue", "worker-pool"],
        says: "Frontier queue → fetchers → parser → extracted links back to the frontier. Each stage scales independently.",
        because: "Fetching is IO-bound and parsing is CPU-bound. Splitting them lets each scale on its own constraint, which is the entire reason this is a pipeline.",
      },
      {
        title: "Politeness is a partitioning problem",
        components: ["consistent-hashing", "rate-limiter"],
        says: "Partition the frontier by host so all URLs for one host go to one worker, which paces itself per host.",
        because: "Politeness is per host, so the constraint is only enforceable if one place owns each host. This turns a coordination problem into a routing decision — the move worth pointing out.",
      },
      {
        title: "Not fetching the same thing twice",
        components: ["cache", "key-value"],
        says: "A Bloom filter for the seen-set, backed by a durable store for the authoritative check.",
        because: "An exact set of a billion URLs is expensive in memory; a Bloom filter answers 'definitely not seen' cheaply. False positives mean skipping a page, which is acceptable here — say so.",
        watchFor: "Canonicalise URLs first, or the same page appears a dozen ways.",
      },
      {
        title: "Storage",
        components: ["object-storage", "key-value"],
        says: "Raw content in object storage keyed by content hash; metadata and crawl state in a key-value store.",
        because: "Content is large and immutable, which is exactly what object storage is for. Hashing by content deduplicates mirrors for free.",
      },
      {
        title: "Surviving a crash",
        components: ["queue"],
        says: "A URL is only removed from the frontier once its content is stored. In-flight work returns after a visibility timeout.",
        because: "A crawl runs for weeks. 'Restarts cleanly' is a requirement, and at-least-once with idempotent storage is how you get it.",
      },
      {
        title: "Recrawling",
        components: ["time-series-db", "batch-pipeline"],
        says: "Track per-URL change frequency and schedule recrawls adaptively — news hourly, a static page monthly.",
        because: "Uniform recrawling wastes most of the budget. Noticing the crawl is never finished, only more or less current, is what distinguishes a considered answer here.",
      },
    ],
    rubric: [
      "Structured it as independently scaling stages",
      "Made politeness a partitioning decision rather than a wish",
      "Chose a deduplication structure and accepted its error mode",
      "Canonicalised URLs",
      "Made crash recovery explicit",
      "Treated recrawl frequency as adaptive",
    ],
  },
];
