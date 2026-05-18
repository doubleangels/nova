class MockKeyv {
  constructor(opts) {
    this.store = new Map();
    this.namespace = opts?.namespace || 'keyv';
  }
  get = jest.fn(async (key) => this.store.get(key));
  set = jest.fn(async (key, value) => { this.store.set(key, value); });
  delete = jest.fn(async (key) => { this.store.delete(key); });
  clear = jest.fn(async () => { this.store.clear(); });
  on = jest.fn();
}
module.exports = MockKeyv;