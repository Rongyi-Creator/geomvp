// Minimal in-memory KVNamespace stand-in for tests. Implements only the subset used.
export class MemKV {
  store = new Map<string, string>();
  async get(key: string, _type?: string): Promise<string | null> {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  async put(key: string, value: string, _opts?: { expirationTtl?: number }): Promise<void> {
    this.store.set(key, value);
  }
  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
  async list(opts?: { prefix?: string }): Promise<{ keys: { name: string }[] }> {
    const prefix = opts?.prefix ?? '';
    return { keys: [...this.store.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })) };
  }
}
