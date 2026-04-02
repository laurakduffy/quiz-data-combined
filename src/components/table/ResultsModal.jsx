import { useState, useMemo, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, Copy, Check } from 'lucide-react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import AllocationBar from './AllocationBar';
import { copyToClipboard } from '../../utils/clipboard';
import styles from '../../styles/components/ResultsModal.module.css';
import tableStyles from '../../styles/components/TableMode.module.css';

function formatScore(v) {
  const abs = Math.abs(v);
  if (abs === 0) return '0';
  if (abs >= 1e6 || abs < 1e-3) return v.toExponential(2);
  return v.toFixed(2);
}

function truncLabel(s, max = 16) {
  return s.length > max ? s.slice(0, max - 1) + '\u2026' : s;
}

function ResultsModal({ results, projectEntries, fundingCaps = {}, totalBudget, onClose }) {
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState('results');
  const [selectedIteration, setSelectedIteration] = useState(() => results.debugTrace?.length || 0);
  const draggingRef = useRef(false);

  const chartData = useMemo(() => {
    if (!results.debugTrace?.length) return [];
    const zeroPoint = { iteration: 0 };
    for (const [id] of projectEntries) zeroPoint[id] = 0;
    return [
      zeroPoint,
      ...results.debugTrace.map((entry, i) => ({
        iteration: i + 1,
        ...entry.fundingAfter,
      })),
    ];
  }, [results.debugTrace, projectEntries]);

  const projectColors = useMemo(() => {
    const map = {};
    for (const [id, project] of projectEntries) {
      map[id] = project.color;
    }
    return map;
  }, [projectEntries]);

  const allocatedIds = useMemo(() => {
    if (!results.debugTrace?.length) return [];
    return projectEntries
      .map(([id]) => id)
      .filter((id) => results.debugTrace.some((entry) => entry.fundingAfter[id] > 0));
  }, [results.debugTrace, projectEntries]);

  const projectNames = useMemo(() => {
    const map = {};
    for (const [id, project] of projectEntries) map[id] = project.name;
    return map;
  }, [projectEntries]);

  const selectedEntry = selectedIteration > 0 ? results.debugTrace?.[selectedIteration - 1] : null;

  const projectIds = useMemo(() => projectEntries.map(([id]) => id), [projectEntries]);

  // Extract project→number score maps from methodResult (skip allocation keys & complex structures)
  const scoreColumns = useMemo(() => {
    if (!selectedEntry?.methodResult) return [];
    const cols = [];
    const isProjectMap = (obj) => {
      const entries = Object.entries(obj);
      return (
        entries.length > 0 &&
        entries.every(([k, v]) => projectIds.includes(k) && typeof v === 'number')
      );
    };
    const selectedIndices = selectedEntry.methodResult.selectedIndices;
    const wvNames = selectedEntry.worldviewNames;
    for (const [key, value] of Object.entries(selectedEntry.methodResult)) {
      if (projectIds.includes(key)) continue;
      if (key === 'selectedIndices' || key === 'unbeaten') continue;
      // Leximax vectors → extract min (worst-off worldview) per project
      if (key === 'vectors') {
        const mins = {};
        for (const id of projectIds) {
          const vec = value[id];
          if (Array.isArray(vec) && vec.length > 0) mins[id] = vec[0];
        }
        cols.push({ label: 'min', values: mins });
        continue;
      }
      // Split cycle margins matrix → compute net margin per project
      if (key === 'margins') {
        const netMargins = {};
        for (const a of projectIds) {
          let s = 0;
          for (const b of projectIds) {
            if (a !== b) s += value[a]?.[b] || 0;
          }
          netMargins[a] = s;
        }
        cols.push({ label: 'netMargin', values: netMargins });
        continue;
      }
      // Array of project→number maps (worldviewScores)
      if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i++) {
          if (typeof value[i] === 'object' && value[i] !== null && isProjectMap(value[i])) {
            const selected = selectedIndices?.includes(i);
            const name = wvNames?.[i] || `wv${i}`;
            const full = `${name}${selected ? ' *' : ''}`;
            cols.push({ label: truncLabel(full), title: full, values: value[i] });
          }
        }
        continue;
      }
      if (typeof value !== 'object' || value === null) continue;
      if (isProjectMap(value)) {
        cols.push({ label: truncLabel(key), title: key, values: value });
      }
    }
    return cols;
  }, [selectedEntry, projectIds]);

  const unbeatenSet = useMemo(
    () => new Set(selectedEntry?.methodResult?.unbeaten || []),
    [selectedEntry]
  );

  const handleChartMouseDown = useCallback((e) => {
    if (e?.activeLabel != null && e.activeLabel > 0) {
      draggingRef.current = true;
      setSelectedIteration(e.activeLabel);
    }
  }, []);

  const handleChartMouseMove = useCallback((e) => {
    if (draggingRef.current && e?.activeLabel != null && e.activeLabel > 0) {
      setSelectedIteration(e.activeLabel);
    }
  }, []);

  const handleChartMouseUp = useCallback(() => {
    draggingRef.current = false;
  }, []);

  const handleCopy = async () => {
    const header = 'Project\tAllocation %\tFunding ($M)';
    const rows = projectEntries.map(([id, project]) => {
      const pct = (results.allocations[id] || 0).toFixed(1);
      const funding = Math.round(results.funding[id] || 0);
      return `${project.name}\t${pct}\t${funding}`;
    });
    await copyToClipboard([header, ...rows].join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return createPortal(
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <div className={styles.tabs}>
            <button
              className={`${styles.tab} ${activeTab === 'results' ? styles.tabActive : ''}`}
              onClick={() => setActiveTab('results')}
            >
              Results
            </button>
            <button
              className={`${styles.tab} ${activeTab === 'debug' ? styles.tabActive : ''}`}
              onClick={() => setActiveTab('debug')}
            >
              Debug
            </button>
          </div>
          <button className={styles.closeButton} onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className={styles.content}>
          {activeTab === 'results' ? (
            <div className={tableStyles.allocationList}>
              {projectEntries.map(([id, project]) => (
                <AllocationBar
                  key={id}
                  name={project.name}
                  percentage={results.allocations[id] || 0}
                  funding={results.funding[id] || 0}
                  color={project.color}
                  cap={fundingCaps[id]}
                  totalBudget={totalBudget}
                />
              ))}
            </div>
          ) : (
            <>
              {chartData.length > 0 && (
                <div className={styles.chartContainer}>
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                      data={chartData}
                      onMouseDown={handleChartMouseDown}
                      onMouseMove={handleChartMouseMove}
                      onMouseUp={handleChartMouseUp}
                    >
                      <XAxis
                        dataKey="iteration"
                        tick={{ fill: 'var(--text-secondary)', fontSize: 11 }}
                        axisLine={{ stroke: 'var(--border-subtle)' }}
                        tickLine={false}
                      />
                      <YAxis
                        tick={{ fill: 'var(--text-secondary)', fontSize: 11 }}
                        axisLine={{ stroke: 'var(--border-subtle)' }}
                        tickLine={false}
                        tickFormatter={(v) => `$${v}M`}
                      />
                      <Tooltip
                        contentStyle={{
                          background: '#0a3549',
                          border: '1px solid var(--border-subtle)',
                          borderRadius: 8,
                          fontSize: 12,
                        }}
                        labelFormatter={(v) => `Iteration ${v}`}
                        formatter={(value, name) => {
                          const project = projectEntries.find(([id]) => id === name);
                          return [`$${Math.round(value)}M`, project?.[1]?.name || name];
                        }}
                      />
                      <ReferenceLine x={selectedIteration} stroke="white" strokeDasharray="4 2" />
                      {allocatedIds.map((id) => (
                        <Area
                          key={id}
                          type="monotone"
                          dataKey={id}
                          stroke={projectColors[id]}
                          fill="none"
                          isAnimationActive={false}
                        />
                      ))}
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}
              <div className={styles.iterationDetail}>
                {selectedIteration === 0 || !selectedEntry ? (
                  <div className={styles.noSelection}>No allocation yet (iteration 0)</div>
                ) : (
                  <>
                    <div className={styles.iterationHeader}>
                      <span>
                        Iteration {selectedIteration}: {selectedEntry.method}
                      </span>
                      {selectedEntry.stopped && (
                        <span className={styles.stoppedBadge}>stopped</span>
                      )}
                      {selectedEntry.cappedProjects?.length > 0 && (
                        <span className={styles.cappedBadge}>
                          capped: {selectedEntry.cappedProjects.join(', ')}
                        </span>
                      )}
                    </div>
                    <table className={styles.iterationTable}>
                      <thead>
                        <tr>
                          <th>Project</th>
                          <th>Before</th>
                          <th></th>
                          <th>After</th>
                          <th>Delta</th>
                          {selectedEntry.drFactors && <th>DR</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {projectIds.map((id) => {
                          const before = selectedEntry.fundingBefore?.[id] || 0;
                          const after = selectedEntry.fundingAfter[id] || 0;
                          const delta = after - before;
                          const dr = selectedEntry.drFactors?.[id];
                          return (
                            <tr key={id}>
                              <td>
                                <span
                                  className={styles.colorDot}
                                  style={{ background: projectColors[id] }}
                                />
                                {projectNames[id] || id}
                              </td>
                              <td>${Math.round(before)}M</td>
                              <td className={styles.arrow}>→</td>
                              <td>${Math.round(after)}M</td>
                              <td className={delta > 0 ? styles.deltaPositive : ''}>
                                {delta > 0 ? '+' : ''}
                                {Math.round(delta)}
                              </td>
                              {selectedEntry.drFactors && (
                                <td className={dr < 1 ? styles.drReduced : ''}>
                                  {dr != null ? dr.toFixed(3) : '—'}
                                </td>
                              )}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    {scoreColumns.length > 0 && (
                      <table className={styles.iterationTable}>
                        <thead>
                          <tr>
                            <th>Project</th>
                            {scoreColumns.map((col) => (
                              <th key={col.label} title={col.title}>
                                {col.label}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {projectIds
                            .filter((id) => scoreColumns.some((col) => col.values[id] != null))
                            .map((id) => (
                              <tr key={id}>
                                <td>
                                  <span
                                    className={styles.colorDot}
                                    style={{ background: projectColors[id] }}
                                  />
                                  {projectNames[id] || id}
                                  {selectedEntry.cappedProjects?.includes(id) && (
                                    <span className={styles.cappedBadge}>capped</span>
                                  )}
                                  {unbeatenSet.has(id) && (
                                    <span className={styles.unbeatenBadge}>unbeaten</span>
                                  )}
                                </td>
                                {scoreColumns.map((col) => (
                                  <td key={col.label}>
                                    {col.values[id] != null ? formatScore(col.values[id]) : '—'}
                                  </td>
                                ))}
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    )}
                  </>
                )}
              </div>
            </>
          )}
        </div>
        {activeTab === 'results' && (
          <div className={styles.footer}>
            <button
              className={`btn btn-secondary ${styles.copyButton} ${copied ? styles.copied : ''}`}
              onClick={handleCopy}
            >
              {copied ? <Check size={16} /> : <Copy size={16} />}
              {copied ? 'Copied!' : 'Copy to Clipboard'}
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

export default ResultsModal;
