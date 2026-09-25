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
    followUps: [
      "How do you support custom aliases without breaking the counter scheme?",
      "A link goes viral and is one in a million reads — what breaks?",
      "How would you support link expiry?",
      "301 or 302, and what does that choose about analytics?",
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
    followUps: [
      "How do you raise one customer's limit without a deploy?",
      "How would you rate limit by something other than client id — IP, endpoint, cost?",
      "What is the memory cost at 100M clients?",
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
    followUps: [
      "What happens when a user with 50M followers posts?",
      "How do you handle unfollow — do you rewrite their timeline?",
      "How would you add 'posts from people they follow, ranked by relevance'?",
      "How does a brand-new user with no follows get a feed?",
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
    followUps: [
      "What happens to the 50,000 users on a node that crashes?",
      "How does a client catch up after being offline for a week?",
      "How would you add group chat with 1,000 members?",
      "How do you do end-to-end encryption, and what does it cost you?",
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
    followUps: [
      "How do you avoid crawler traps and infinite URL spaces?",
      "How do you prioritise which URL to fetch next?",
      "What is the false positive rate of your Bloom filter, and does it matter?",
    ],
  },
];
