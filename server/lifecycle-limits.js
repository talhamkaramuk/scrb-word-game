import net from "node:net";

export function createWindowedActionLimiter({ limit, windowMs, now = () => Date.now() }) {
  const actionsByKey = new Map();

  function allow(key) {
    if (!key) {
      return true;
    }

    const cutoff = now() - windowMs;
    const actions = (actionsByKey.get(key) || []).filter((at) => at > cutoff);
    if (actions.length >= limit) {
      actionsByKey.set(key, actions);
      return false;
    }

    actions.push(now());
    actionsByKey.set(key, actions);
    return true;
  }

  function prune() {
    const cutoff = now() - windowMs;
    for (const [key, actions] of actionsByKey) {
      const activeActions = actions.filter((at) => at > cutoff);
      if (activeActions.length === 0) {
        actionsByKey.delete(key);
      } else {
        actionsByKey.set(key, activeActions);
      }
    }
  }

  return {
    allow,
    prune,
    get size() {
      return actionsByKey.size;
    }
  };
}

export function connectionLimitStatus(connections, clientIp, { maxConnectionsPerIp, maxConnectionsPerSubnet }) {
  const clientSubnet = subnetKeyForIp(clientIp);
  let ipConnections = 0;
  let subnetConnections = 0;

  for (const connection of connections) {
    if (connection.clientIp === clientIp) {
      ipConnections += 1;
    }
    if (clientSubnet && connection.clientSubnet === clientSubnet) {
      subnetConnections += 1;
    }
  }

  if (ipConnections >= maxConnectionsPerIp) {
    return { allowed: false, reason: "ip_connection_limit", clientSubnet };
  }
  if (clientSubnet && subnetConnections >= maxConnectionsPerSubnet) {
    return { allowed: false, reason: "subnet_connection_limit", clientSubnet };
  }

  return { allowed: true, reason: null, clientSubnet };
}

export function shouldPruneRoom(room, { hasConnections, now, idleRoomMs, waitingRoomIdleMs }) {
  if (hasConnections) {
    return false;
  }

  const idleMs = now - room.updatedAt;
  if (room.status === "waiting") {
    return idleMs > waitingRoomIdleMs;
  }

  return idleMs > idleRoomMs;
}

export function clientIpFromRequest(req) {
  const cfConnectingIp = normalizeIp(firstHeaderValue(req.headers["cf-connecting-ip"]));
  if (cfConnectingIp) {
    return cfConnectingIp;
  }

  const forwardedFor = firstHeaderValue(req.headers["x-forwarded-for"])?.split(",")[0]?.trim();
  const forwardedIp = normalizeIp(forwardedFor);
  if (forwardedIp) {
    return forwardedIp;
  }

  return normalizeIp(req.socket?.remoteAddress) || "unknown";
}

export function subnetKeyForIp(ip) {
  const normalizedIp = normalizeIp(ip);
  const family = net.isIP(normalizedIp);
  if (family === 4) {
    const octets = normalizedIp.split(".");
    return `${octets[0]}.${octets[1]}.${octets[2]}.0/24`;
  }
  if (family === 6) {
    const hextets = ipv6Hextets(normalizedIp);
    if (!hextets) {
      return null;
    }
    return `${hextets.slice(0, 4).join(":")}::/64`;
  }
  return null;
}

export function normalizeIp(value) {
  const raw = String(value || "")
    .trim()
    .replace(/%.+$/, "");
  if (!raw) {
    return null;
  }

  const ipv4Mapped = raw.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  const candidate = ipv4Mapped ? ipv4Mapped[1] : raw;
  return net.isIP(candidate) ? candidate.toLowerCase() : null;
}

function firstHeaderValue(value) {
  if (Array.isArray(value)) {
    return value[0];
  }
  return typeof value === "string" ? value : null;
}

function ipv6Hextets(ip) {
  if (net.isIP(ip) !== 6 || ip.includes(".")) {
    return null;
  }

  const [leftRaw, rightRaw = ""] = ip.split("::");
  const left = leftRaw ? leftRaw.split(":") : [];
  const right = rightRaw ? rightRaw.split(":") : [];
  const fill = Array.from({ length: Math.max(0, 8 - left.length - right.length) }, () => "0");
  const hextets = [...left, ...fill, ...right];
  if (hextets.length !== 8) {
    return null;
  }

  return hextets.map((hextet) => Number.parseInt(hextet || "0", 16).toString(16).padStart(4, "0"));
}
