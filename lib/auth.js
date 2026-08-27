// Toegangscontrole: IP-whitelist op basis van CF-Connecting-IP, plus de admincode.
//
// CF-Connecting-IP wordt door Cloudflare zelf gezet en kan door de client niet
// worden vervalst. Dat is het verschil met de oude opzet, waarin de browser zijn
// eigen IP als query-parameter meestuurde.

function parseIpv4(str) {
  const parts = str.split('.');
  if (parts.length !== 4) return null;
  const bytes = new Uint8Array(4);
  for (let i = 0; i < 4; i++) {
    if (!/^\d{1,3}$/.test(parts[i])) return null;
    const n = Number(parts[i]);
    if (n > 255) return null;
    bytes[i] = n;
  }
  return bytes;
}

function parseIpv6(input) {
  let str = input;

  // Een ingebed IPv4-adres (::ffff:1.2.3.4) eerst omzetten naar twee hexgroepen.
  const embedded = str.match(/^(.*:)((?:\d{1,3}\.){3}\d{1,3})$/);
  if (embedded) {
    const v4 = parseIpv4(embedded[2]);
    if (!v4) return null;
    const high = ((v4[0] << 8) | v4[1]).toString(16);
    const low = ((v4[2] << 8) | v4[3]).toString(16);
    str = `${embedded[1]}${high}:${low}`;
  }

  const halves = str.split('::');
  if (halves.length > 2) return null;

  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 ? (halves[1] ? halves[1].split(':') : []) : null;

  let groups;
  if (tail === null) {
    if (head.length !== 8) return null;
    groups = head;
  } else {
    const fill = 8 - head.length - tail.length;
    if (fill < 0) return null;
    groups = [...head, ...Array(fill).fill('0'), ...tail];
  }

  const bytes = new Uint8Array(16);
  for (let i = 0; i < 8; i++) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(groups[i])) return null;
    const n = parseInt(groups[i], 16);
    bytes[i * 2] = n >> 8;
    bytes[i * 2 + 1] = n & 0xff;
  }
  return bytes;
}

function parseIp(str) {
  const trimmed = (str || '').trim();
  if (!trimmed) return null;
  return trimmed.includes(':') ? parseIpv6(trimmed) : parseIpv4(trimmed);
}

// Vergelijkt een IP met een regel: los adres (185.38.90.170) of CIDR (2a02:1234::/48).
function matchesRule(ipBytes, rule) {
  const slash = rule.indexOf('/');
  const addr = slash === -1 ? rule : rule.slice(0, slash);
  const ruleBytes = parseIp(addr);
  if (!ruleBytes || ruleBytes.length !== ipBytes.length) return false;

  const maxBits = ruleBytes.length * 8;
  const bits = slash === -1 ? maxBits : Number(rule.slice(slash + 1));
  if (!Number.isInteger(bits) || bits < 0 || bits > maxBits) return false;

  const wholeBytes = bits >> 3;
  for (let i = 0; i < wholeBytes; i++) {
    if (ipBytes[i] !== ruleBytes[i]) return false;
  }

  const remainingBits = bits & 7;
  if (remainingBits) {
    const mask = (0xff << (8 - remainingBits)) & 0xff;
    if ((ipBytes[wholeBytes] & mask) !== (ruleBytes[wholeBytes] & mask)) return false;
  }
  return true;
}

export function checkIp(ip, allowedIps) {
  const rules = (allowedIps || '')
    .split(',')
    .map((r) => r.trim())
    .filter(Boolean);

  // Bewust dicht als de variabele ontbreekt. Fail-open zou betekenen dat een
  // vergeten instelling stilletjes de deur openzet.
  if (rules.length === 0) return { allowed: false, reason: 'unconfigured' };

  const ipBytes = parseIp(ip);
  if (!ipBytes) return { allowed: false, reason: 'denied' };

  const allowed = rules.some((rule) => matchesRule(ipBytes, rule));
  return { allowed, reason: allowed ? null : 'denied' };
}

export function isAdmin(request, env) {
  const supplied = request.headers.get('X-Admin-Code');
  const expected = env.ADMIN_CODE;
  if (!supplied || !expected) return false;
  return timingSafeEqual(supplied, expected);
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
