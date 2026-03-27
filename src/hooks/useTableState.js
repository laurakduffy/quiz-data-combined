import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { computeMultiStageAllocation } from '../utils/marcusCalculation';
import { adjustCredences, roundCredences } from '../utils/calculations';
import { useDataset } from '../context/DatasetContext';
import { useQuiz } from '../context/useQuiz';
import tableConfig from '../../config/tableMode.json';
import worldviewPresets from '../../config/worldviewPresets.json';

const STORAGE_KEY = 'table_state';
const STATE_VERSION = 7;

function createWorldview(presetId) {
  if (presetId) {
    const preset = tableConfig.presets.find((p) => p.id === presetId);
    if (preset) {
      const { id, name, ...data } = preset;
      return { ...JSON.parse(JSON.stringify(data)), name, presetId: id, uid: crypto.randomUUID() };
    }
  }
  const template = worldviewPresets.defaultWorldview;
  return {
    ...JSON.parse(JSON.stringify(template)),
    name: 'Custom',
    presetId: null,
    uid: crypto.randomUUID(),
  };
}

/**
 * Build initial credences object for N worldviews, summing to 100.
 * Equal split, remainder goes to first worldview.
 */
function buildEqualCredences(count) {
  const each = Math.floor(100 / count);
  const creds = {};
  for (let i = 0; i < count; i++) {
    creds[i] = each;
  }
  creds[0] += 100 - each * count;
  return creds;
}

function createDefaultStage() {
  return {
    id: crypto.randomUUID(),
    method: tableConfig.votingMethods[0].key,
    budget: tableConfig.totalBudget,
    options: {},
  };
}

/**
 * Convert old format (selectedMethod/totalBudget/methodOptions) to stages array.
 */
function migrateToStages(savedState) {
  if (savedState.stages) return savedState.stages;
  return [
    {
      id: crypto.randomUUID(),
      method: savedState.selectedMethod || tableConfig.votingMethods[0].key,
      budget: savedState.totalBudget ?? tableConfig.totalBudget,
      options: savedState.methodOptions?.[savedState.selectedMethod] ?? {},
    },
  ];
}

function loadSavedState() {
  try {
    let stored = sessionStorage.getItem(STORAGE_KEY);
    // Backward compat: migrate from old key
    if (!stored) {
      stored = sessionStorage.getItem('marcus_state');
      if (stored) {
        sessionStorage.setItem(STORAGE_KEY, stored);
        sessionStorage.removeItem('marcus_state');
      }
    }
    if (!stored) return null;
    const parsed = JSON.parse(stored);
    // Accept both version 6 (old format) and 7 (new format)
    if (parsed.version !== STATE_VERSION && parsed.version !== 6) return null;
    const { worldviews, credences, lockedKeys } = parsed.state;
    if (!Array.isArray(worldviews) || !worldviews.length) return null;
    const stages = migrateToStages(parsed.state);
    return { worldviews, credences, lockedKeys, stages };
  } catch {
    return null;
  }
}

function saveState(state) {
  try {
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: STATE_VERSION,
        state,
      })
    );
  } catch {
    // sessionStorage full or unavailable — ignore
  }
}

// Load once at module level so useState initializers don't re-parse
const _savedState = loadSavedState();

const MAX_TOTAL_BUDGET = 1000;

export function useTableState() {
  const { dataset } = useDataset();
  const { fundingCaps, isHydrating } = useQuiz();

  const [worldviews, setWorldviews] = useState(
    () => _savedState?.worldviews ?? tableConfig.presets.map((p) => createWorldview(p.id))
  );
  const [credences, setCredences] = useState(
    () => _savedState?.credences ?? buildEqualCredences(tableConfig.presets.length)
  );
  const [lockedKeys, setLockedKeys] = useState(() => _savedState?.lockedKeys ?? []);
  const [stages, setStages] = useState(() => _savedState?.stages ?? [createDefaultStage()]);

  // Note: calculations recompute automatically when dataset changes
  // via the dataset dependency in the results useMemo below.

  // Stage callbacks
  const addStage = useCallback(() => {
    setStages((prev) => {
      const usedBudget = prev.reduce((sum, s) => sum + s.budget, 0);
      const remaining = Math.max(0, MAX_TOTAL_BUDGET - usedBudget);
      return [
        ...prev,
        {
          id: crypto.randomUUID(),
          method: tableConfig.votingMethods[0].key,
          budget: remaining,
          options: {},
        },
      ];
    });
  }, []);

  const removeStage = useCallback((index) => {
    setStages((prev) => {
      if (prev.length <= 1) return prev;
      return prev.filter((_, i) => i !== index);
    });
  }, []);

  const updateStage = useCallback((index, field, value) => {
    setStages((prev) => {
      const next = prev.map((s, i) => {
        if (i !== index) return s;
        const updated = { ...s, [field]: value };
        // When changing method, reset options for that stage
        if (field === 'method') updated.options = {};
        return updated;
      });
      // Clamp budgets so total <= MAX_TOTAL_BUDGET
      if (field === 'budget') {
        const total = next.reduce((sum, s) => sum + s.budget, 0);
        if (total > MAX_TOTAL_BUDGET) {
          const excess = total - MAX_TOTAL_BUDGET;
          // Reduce other stages proportionally to fit
          const othersTotal = total - next[index].budget;
          if (othersTotal > 0) {
            return next.map((s, i) => {
              if (i === index) return s;
              const ratio = s.budget / othersTotal;
              return { ...s, budget: Math.max(0, Math.round(s.budget - excess * ratio)) };
            });
          }
        }
      }
      return next;
    });
  }, []);

  const updateStageOption = useCallback((index, optKey, value) => {
    setStages((prev) =>
      prev.map((s, i) => {
        if (i !== index) return s;
        return { ...s, options: { ...s.options, [optKey]: value } };
      })
    );
  }, []);

  // Debounce worldviews + credences + stages together for calculation
  const [debouncedState, setDebouncedState] = useState({
    worldviews,
    credences,
    stages,
  });
  const debounceRef = useRef(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedState({ worldviews, credences, stages });
    }, 150);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [worldviews, credences, stages]);

  // Persist to sessionStorage on changes (300ms debounce)
  const saveRef = useRef(null);
  useEffect(() => {
    if (saveRef.current) clearTimeout(saveRef.current);
    saveRef.current = setTimeout(() => {
      saveState({ worldviews, credences, lockedKeys, stages });
    }, 300);
    return () => {
      if (saveRef.current) clearTimeout(saveRef.current);
    };
  }, [worldviews, credences, lockedKeys, stages]);

  const results = useMemo(() => {
    const { worldviews: wvs, credences: creds, stages: stgs } = debouncedState;
    if (!wvs.length || isHydrating) {
      const empty = {};
      for (const id of Object.keys(dataset.projects)) empty[id] = 0;
      return { allocations: empty, funding: empty, stageResults: [] };
    }

    // Merge credences (0-100 percentages) into worldview objects as 0-1 floats
    const worldviewsWithCredences = wvs.map((wv, i) => ({
      ...wv,
      credence: (creds[i] || 0) / 100,
    }));

    try {
      // Inject fundingCaps into each stage's options so allocateBudget sees them
      // Use live fundingCaps (not debounced) to avoid flash of uncapped results on reload
      const stagesWithCaps =
        fundingCaps && Object.keys(fundingCaps).length > 0
          ? stgs.map((s) => ({ ...s, options: { ...s.options, fundingCaps } }))
          : stgs;

      const result = computeMultiStageAllocation(
        dataset.projects,
        worldviewsWithCredences,
        stagesWithCaps,
        dataset.incrementSize
      );
      console.log(
        '[table] recalc stages',
        stgs.map((s) => s.method),
        {
          credences: Object.fromEntries(
            wvs.map((wv, i) => [wv.name, `${Math.round(creds[i] || 0)}%`])
          ),
          allocations: Object.fromEntries(
            Object.entries(result.allocations)
              .filter(([, v]) => v > 0)
              .sort((a, b) => b[1] - a[1])
              .map(([id, v]) => [dataset.projects[id].name, `${v.toFixed(1)}%`])
          ),
        }
      );
      return result;
    } catch (e) {
      console.error('[table] calc error', e);
      const empty = {};
      for (const id of Object.keys(dataset.projects)) empty[id] = 0;
      return { allocations: empty, funding: empty, stageResults: [] };
    }
  }, [debouncedState, dataset, isHydrating, fundingCaps]);

  const addWorldview = useCallback(() => {
    setWorldviews((prev) => {
      const next = [...prev, createWorldview(null)];
      setCredences(buildEqualCredences(next.length));
      setLockedKeys([]);
      return next;
    });
  }, []);

  const removeWorldview = useCallback((index) => {
    setWorldviews((prev) => {
      if (prev.length <= 1) return prev;
      const next = prev.filter((_, i) => i !== index);
      // Rebuild credences with new indices
      setCredences(buildEqualCredences(next.length));
      setLockedKeys([]);
      return next;
    });
  }, []);

  const updateCredence = useCallback(
    (indexKey, newValue, baseCredences, shouldRound, currentLockedKeys) => {
      const key = String(indexKey);
      const source = baseCredences || credences;
      const adjusted = adjustCredences(key, newValue, source, baseCredences, currentLockedKeys);
      const final = shouldRound ? roundCredences(adjusted) : adjusted;
      setCredences(final);
    },
    [credences]
  );

  const updateWorldview = useCallback((index, path, value) => {
    setWorldviews((prev) => {
      const next = prev.map((wv, i) => {
        if (i !== index) return wv;
        const copy = { ...wv };
        const parts = path.split('.');
        if (parts.length === 1) {
          copy[parts[0]] = value;
        } else if (parts.length === 2) {
          copy[parts[0]] = { ...copy[parts[0]], [parts[1]]: value };
        }
        return copy;
      });
      return next;
    });
  }, []);

  const updateDiscountFactor = useCallback((index, factorIndex, value) => {
    setWorldviews((prev) => {
      const next = prev.map((wv, i) => {
        if (i !== index) return wv;
        const newFactors = [...wv.discount_factors];
        newFactors[factorIndex] = value;
        return { ...wv, discount_factors: newFactors };
      });
      return next;
    });
  }, []);

  const applyPreset = useCallback((index, presetId) => {
    setWorldviews((prev) =>
      prev.map((wv, i) => {
        if (i !== index) return wv;
        if (!presetId) {
          return { ...wv, presetId: null, name: 'Custom' };
        }
        return createWorldview(presetId);
      })
    );
  }, []);

  const reorderWorldviews = useCallback((fromIndex, toIndex) => {
    setWorldviews((prev) => {
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);

      // Remap credences: values follow their worldview
      setCredences((prevCreds) => {
        const newCreds = {};
        const oldOrder = prev.map((_, i) => i);
        const reordered = [...oldOrder];
        const [movedIdx] = reordered.splice(fromIndex, 1);
        reordered.splice(toIndex, 0, movedIdx);
        for (let newIdx = 0; newIdx < reordered.length; newIdx++) {
          newCreds[newIdx] = prevCreds[reordered[newIdx]] ?? 0;
        }
        return newCreds;
      });

      // Remap locked keys to match new positions
      setLockedKeys((prevLocked) => {
        const oldOrder = prev.map((_, i) => i);
        const reordered = [...oldOrder];
        const [movedIdx] = reordered.splice(fromIndex, 1);
        reordered.splice(toIndex, 0, movedIdx);
        // Build reverse map: oldIndex -> newIndex
        const reverseMap = {};
        for (let newIdx = 0; newIdx < reordered.length; newIdx++) {
          reverseMap[reordered[newIdx]] = newIdx;
        }
        return prevLocked.map((k) => String(reverseMap[Number(k)] ?? k));
      });

      return next;
    });
  }, []);

  const hydrateFromShare = useCallback((shareData) => {
    if (shareData.worldviews) setWorldviews(shareData.worldviews);
    if (shareData.credences) setCredences(shareData.credences);
    if (shareData.stages) {
      setStages(shareData.stages);
    } else if (shareData.selectedMethod) {
      // Backward compat: convert old format to single stage
      setStages([
        {
          id: crypto.randomUUID(),
          method: shareData.selectedMethod,
          budget: shareData.totalBudget ?? tableConfig.totalBudget,
          options: shareData.methodOptions?.[shareData.selectedMethod] ?? {},
        },
      ]);
    }
    setLockedKeys([]);
  }, []);

  return {
    worldviews,
    credences,
    lockedKeys,
    setLockedKeys,
    stages,
    results,
    addWorldview,
    removeWorldview,
    updateCredence,
    updateWorldview,
    updateDiscountFactor,
    applyPreset,
    reorderWorldviews,
    addStage,
    removeStage,
    updateStage,
    updateStageOption,
    hydrateFromShare,
  };
}
