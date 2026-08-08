// Tiny TTL cache. Keeps catalog + show-page metadata snappy and reduces
// load on the source site. In-memory only (fine for a single addon process).

const store = new Map(); // key -> { value, expires }

/**
 * Get a cached value or compute+store it.
 * @param {string} key
 * @param {number} ttlMs   time-to-live in milliseconds
 * @param {Function: Promise<any>} producer  called on miss
 */
async function cached(key, ttlMs, producer) {
    const hit = store.get(key);
    const now = Date.now();
    if (hit && hit.expires > now) {
        return hit.value;
    }
    const value = await producer();
    store.set(key, { value, expires: now + ttlMs });
    return value;
}

function invalidate(key) {
    store.delete(key);
}

module.exports = { cached, invalidate };
