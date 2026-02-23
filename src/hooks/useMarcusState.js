import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { computeMarcusAllocation } from '../utils/marcusCalculation';
import { adjustCredences, roundCredences } from '../utils/calculations';
import marcusConfig from '../../config/marcusMode.json';
import worldviewPresets from '../../config/worldviewPresets.json';

const STORAGE_KEY = 'marcus_state';
const STATE_VERSION = 6;

function createWorldview(presetId) {
  if (presetId) {
    const preset = marcusConfig.presets.find((p) => p.id === presetId);
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

function loadSavedState() {
  try {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    if (!stored) return null;
    const parsed = JSON.parse(stored);
    if (parsed.version !== STATE_VERSION) return null;
    const { worldviews, credences, lockedKeys, selectedMethod, totalBudget, methodOptions } =
      parsed.state;
    if (!Array.isArray(worldviews) || !worldviews.length) return null;
    return { worldviews, credences, lockedKeys, selectedMethod, totalBudget, methodOptions };
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

export function useMarcusState() {
  const [worldviews, setWorldviews] = useState(
    () => _savedState?.worldviews ?? marcusConfig.presets.map((p) => createWorldview(p.id))
  );
  const [credences, setCredences] = useState(
    () => _savedState?.credences ?? buildEqualCredences(marcusConfig.presets.length)
  );
  const [lockedKeys, setLockedKeys] = useState(() => _savedState?.lockedKeys ?? []);
  const [selectedMethod, setSelectedMethod] = useState(
    () => _savedState?.selectedMethod ?? marcusConfig.votingMethods[0].key
  );
  const [totalBudget, setTotalBudget] = useState(
    () => _savedState?.totalBudget ?? marcusConfig.totalBudget
  );
  const [methodOptions, setMethodOptions] = useState(() => _savedState?.methodOptions ?? {});

  // Debounce worldviews + credences + budget + methodOptions together for calculation
  const [debouncedState, setDebouncedState] = useState({
    worldviews,
    credences,
    totalBudget,
    methodOptions,
  });
  const debounceRef = useRef(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedState({ worldviews, credences, totalBudget, methodOptions });
    }, 150);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [worldviews, credences, totalBudget, methodOptions]);

  // Persist to sessionStorage on changes (300ms debounce)
  const saveRef = useRef(null);
  useEffect(() => {
    if (saveRef.current) clearTimeout(saveRef.current);
    saveRef.current = setTimeout(() => {
      saveState({ worldviews, credences, lockedKeys, selectedMethod, totalBudget, methodOptions });
    }, 300);
    return () => {
      if (saveRef.current) clearTimeout(saveRef.current);
    };
  }, [worldviews, credences, lockedKeys, selectedMethod, totalBudget, methodOptions]);

  const results = useMemo(() => {
    const {
      worldviews: wvs,
      credences: creds,
      totalBudget: budget,
      methodOptions: opts,
    } = debouncedState;
    if (!wvs.length) {
      const empty = {};
      for (const id of Object.keys(marcusConfig.projects)) empty[id] = 0;
      return { allocations: empty, funding: empty };
    }

    // Merge credences (0-100 percentages) into worldview objects as 0-1 floats
    const worldviewsWithCredences = wvs.map((wv, i) => ({
      ...wv,
      credence: (creds[i] || 0) / 100,
    }));

    try {
      const result = computeMarcusAllocation(
        marcusConfig.projects,
        worldviewsWithCredences,
        selectedMethod,
        budget,
        marcusConfig.incrementSize,
        opts[selectedMethod]
      );
      console.log('[marcus] recalc', selectedMethod, {
        credences: Object.fromEntries(
          wvs.map((wv, i) => [wv.name, `${Math.round(creds[i] || 0)}%`])
        ),
        allocations: Object.fromEntries(
          Object.entries(result.allocations)
            .filter(([, v]) => v > 0)
            .sort((a, b) => b[1] - a[1])
            .map(([id, v]) => [marcusConfig.projects[id].name, `${v.toFixed(1)}%`])
        ),
      });
      return result;
    } catch (e) {
      console.error('[marcus] calc error', e);
      const empty = {};
      for (const id of Object.keys(marcusConfig.projects)) empty[id] = 0;
      return { allocations: empty, funding: empty };
    }
  }, [debouncedState, selectedMethod]);

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
    if (shareData.selectedMethod) setSelectedMethod(shareData.selectedMethod);
    if (shareData.totalBudget != null) setTotalBudget(shareData.totalBudget);
    if (shareData.methodOptions) setMethodOptions(shareData.methodOptions);
    setLockedKeys([]);
  }, []);

  return {
    worldviews,
    credences,
    lockedKeys,
    setLockedKeys,
    selectedMethod,
    totalBudget,
    results,
    addWorldview,
    removeWorldview,
    updateCredence,
    updateWorldview,
    updateDiscountFactor,
    applyPreset,
    reorderWorldviews,
    setSelectedMethod,
    setTotalBudget,
    methodOptions,
    setMethodOptions,
    hydrateFromShare,
  };
}
