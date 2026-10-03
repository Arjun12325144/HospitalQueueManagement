// Distributed slot lock: Redis SET NX EX. Falls back to memory when Redis is not configured (local dev only).
const { Redis } = require('@upstash/redis');
const r = process.env.UPSTASH_REDIS_REST_URL ? Redis.fromEnv() : null;
const mem = global._lockMem || (global._lockMem = new Map());
const live = k => { const e = mem.get(k); return e && e.exp > Date.now() ? e.who : null; };

exports.acquire = async (k, who, ttl = 120) => {
  if (r) {
    if (await r.set(k, who, { nx: true, ex: ttl })) return true;
    if ((await r.get(k)) === who) { await r.expire(k, ttl); return true; } // same person, refresh
    return false;
  }
  const cur = live(k);
  if (cur && cur !== who) return false;
  mem.set(k, { who, exp: Date.now() + ttl * 1000 });
  return true;
};
exports.owns = async (k, who) => (r ? (await r.get(k)) === who : live(k) === who);
exports.release = async (k, who) => {
  if (r) return r.eval("if redis.call('get',KEYS[1])==ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end", [k], [who]);
  if (live(k) === who) mem.delete(k);
};
exports.peek = async keys => (r ? (keys.length ? r.mget(...keys) : []) : keys.map(live));
