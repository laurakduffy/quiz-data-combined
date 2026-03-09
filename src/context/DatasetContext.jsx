import { createContext, useContext, useState, useCallback, useMemo } from 'react';

const datasetModules = import.meta.glob('../../config/datasets/*.json', { eager: true });

function parseDatasets() {
  const entries = [];
  for (const [path, mod] of Object.entries(datasetModules)) {
    const filename = path.split('/').pop();
    const id = filename.replace(/\.json$/, '');
    const data = mod.default || mod;
    entries.push({ id, ...data });
  }
  return entries;
}

function pickDefault(datasets) {
  const dated = datasets
    .filter((d) => /^\d{8}/.test(d.id))
    .sort((a, b) => b.id.localeCompare(a.id));
  return dated.length > 0 ? dated[0].id : (datasets[0]?.id ?? null);
}

const STORAGE_KEY = 'active_dataset';

const DatasetContext = createContext(null);

export function DatasetProvider({ children }) {
  const allDatasets = useMemo(() => parseDatasets(), []);
  const defaultId = useMemo(() => {
    try {
      const stored = sessionStorage.getItem(STORAGE_KEY);
      if (stored && allDatasets.some((d) => d.id === stored)) return stored;
    } catch {
      // sessionStorage unavailable
    }
    return pickDefault(allDatasets);
  }, [allDatasets]);

  const [activeId, setActiveId] = useState(defaultId);

  const setActiveDataset = useCallback(
    (id) => {
      if (allDatasets.some((d) => d.id === id)) {
        setActiveId(id);
        try {
          sessionStorage.setItem(STORAGE_KEY, id);
        } catch {
          // sessionStorage unavailable
        }
      }
    },
    [allDatasets]
  );

  const dataset = useMemo(
    () => allDatasets.find((d) => d.id === activeId) ?? allDatasets[0],
    [allDatasets, activeId]
  );

  const datasets = useMemo(
    () => allDatasets.map(({ id, name, description }) => ({ id, name, description })),
    [allDatasets]
  );

  const value = useMemo(
    () => ({ dataset, datasets, setActiveDataset }),
    [dataset, datasets, setActiveDataset]
  );

  return <DatasetContext.Provider value={value}>{children}</DatasetContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useDataset() {
  const ctx = useContext(DatasetContext);
  if (!ctx) throw new Error('useDataset must be used within DatasetProvider');
  return ctx;
}
