// ============================================================================
// HOOKS — localStorage UI prefs + per-collection state over the storage layer.
// ============================================================================
function usePersistentState(name, initialState) {
  const [value, setValue] = useState(() => {
    if (typeof localStorage === 'undefined')
      return typeof initialState === 'function' ? initialState() : initialState;
    try {
      const raw = localStorage.getItem(name);
      if (raw != null) return JSON.parse(raw);
    } catch (e) { console.error(e); }
    return typeof initialState === 'function' ? initialState() : initialState;
  });
  const update = useCallback((next) => {
    setValue(prev => {
      const v = typeof next === 'function' ? next(prev) : next;
      if (typeof localStorage !== 'undefined')
        try { localStorage.setItem(name, JSON.stringify(v)); } catch (e) { console.error(e); }
      return v;
    });
  }, [name]);
  return [value, update];
}

function useStoredMap(storage, store) {
  const [map, setMap] = useState(() => storage.getAll(store));
  useEffect(() => {
    setMap({ ...storage.getAll(store) });
    const onChange = (e) => {
      if (e.detail?.store === store) setMap({ ...storage.getAll(store) });
    };
    storage.addEventListener('storechange', onChange);
    return () => storage.removeEventListener('storechange', onChange);
  }, [storage, store]);
  const upsert = useCallback((id, value) => {
    setMap(m => ({ ...m, [id]: value }));
    storage.set(store, id, value);
  }, [storage, store]);
  const remove = useCallback((id) => {
    setMap(m => { const c = { ...m }; delete c[id]; return c; });
    storage.remove(store, id);
  }, [storage, store]);
  return [map, upsert, remove];
}

