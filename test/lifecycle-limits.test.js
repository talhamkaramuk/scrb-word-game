import assert from "node:assert/strict";
import test from "node:test";
import {
  clientIpFromRequest,
  connectionLimitStatus,
  createWindowedActionLimiter,
  shouldPruneRoom,
  subnetKeyForIp
} from "../server/lifecycle-limits.js";

test("client IP prefers Cloudflare and forwarded headers", () => {
  assert.equal(
    clientIpFromRequest({
      headers: { "cf-connecting-ip": "203.0.113.10" },
      socket: { remoteAddress: "127.0.0.1" }
    }),
    "203.0.113.10"
  );
  assert.equal(
    clientIpFromRequest({
      headers: { "x-forwarded-for": "198.51.100.20, 10.0.0.1" },
      socket: { remoteAddress: "127.0.0.1" }
    }),
    "198.51.100.20"
  );
  assert.equal(
    clientIpFromRequest({
      headers: {},
      socket: { remoteAddress: "::ffff:192.0.2.5" }
    }),
    "192.0.2.5"
  );
});

test("connection limit status enforces IP and subnet caps", () => {
  const connections = [
    { clientIp: "203.0.113.1", clientSubnet: "203.0.113.0/24" },
    { clientIp: "203.0.113.1", clientSubnet: "203.0.113.0/24" },
    { clientIp: "203.0.113.2", clientSubnet: "203.0.113.0/24" }
  ];

  assert.equal(
    connectionLimitStatus(connections, "203.0.113.1", {
      maxConnectionsPerIp: 2,
      maxConnectionsPerSubnet: 10
    }).reason,
    "ip_connection_limit"
  );
  assert.equal(
    connectionLimitStatus(connections, "203.0.113.3", {
      maxConnectionsPerIp: 2,
      maxConnectionsPerSubnet: 3
    }).reason,
    "subnet_connection_limit"
  );
});

test("room creation limiter uses a sliding window", () => {
  let now = 1_000;
  const limiter = createWindowedActionLimiter({ limit: 2, windowMs: 10_000, now: () => now });

  assert.equal(limiter.allow("203.0.113.1"), true);
  assert.equal(limiter.allow("203.0.113.1"), true);
  assert.equal(limiter.allow("203.0.113.1"), false);

  now += 10_001;
  assert.equal(limiter.allow("203.0.113.1"), true);
});

test("waiting rooms are pruned sooner than started rooms", () => {
  assert.equal(
    shouldPruneRoom(
      { status: "waiting", updatedAt: 1_000 },
      { hasConnections: false, now: 31_001, idleRoomMs: 100_000, waitingRoomIdleMs: 30_000 }
    ),
    true
  );
  assert.equal(
    shouldPruneRoom(
      { status: "playing", updatedAt: 1_000 },
      { hasConnections: false, now: 31_001, idleRoomMs: 100_000, waitingRoomIdleMs: 30_000 }
    ),
    false
  );
  assert.equal(
    shouldPruneRoom(
      { status: "waiting", updatedAt: 1_000 },
      { hasConnections: true, now: 31_001, idleRoomMs: 100_000, waitingRoomIdleMs: 30_000 }
    ),
    false
  );
});

test("subnet keys normalize IPv4 and IPv6 addresses", () => {
  assert.equal(subnetKeyForIp("203.0.113.44"), "203.0.113.0/24");
  assert.equal(subnetKeyForIp("2001:db8::1"), "2001:0db8:0000:0000::/64");
});
