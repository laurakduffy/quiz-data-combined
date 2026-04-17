import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import Header from '../layout/Header';
import NetworkBlockedModal from '../ui/NetworkBlockedModal';
import styles from '../../styles/components/DonationPage.module.css';
import SplitEditor from './SplitEditor';
import { endpoints } from '../../config/api';
import config from '../../../config/donationPage.json';
import features from '../../../config/features.json';
import { useDataset } from '../../context/DatasetContext';

const HANDOFF_KEY = 'donate_handoff';

const fundNameById = Object.fromEntries(config.funds.map(({ id, name }) => [id, name]));

const DEFAULT_SPLIT = Object.fromEntries(
  config.funds.map(({ id, defaultPct }) => [id, defaultPct])
);

function genRefId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = '';
  for (let i = 0; i < 4; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return config.memo.refIdPrefix + '-' + new Date().getFullYear() + '-' + id;
}

export default function DonationPage() {
  const { dataset } = useDataset();

  // Derive cluster fund list from the dataset when feature is on
  const useClusters = features.ui?.fundClusters && dataset.clusters?.length > 0;
  const activeFunds = useMemo(() => {
    if (!useClusters) return config.funds;
    return dataset.clusters.map((c) => ({
      id: c.id,
      name: c.name,
      sub: null,
      defaultPct: null,
      info: c.members.map((m) => dataset.projects[m]?.name || m).join('  \n'),
    }));
  }, [useClusters, dataset]);

  const [form, setForm] = useState({
    name: '',
    email: '',
    anonymity: null,
    splitPreference: 'defer',
    splits: { ...DEFAULT_SPLIT },
    amount: '',
  });
  const [copyConfirm, setCopyConfirm] = useState(false);
  const [submitState, setSubmitState] = useState(null); // null | 'submitting' | 'success' | 'error'
  const [warning, setWarning] = useState('');
  const [handoffBanner, setHandoffBanner] = useState(false);
  const [networkBlocked, setNetworkBlocked] = useState(false);
  const refId = useRef(genRefId());

  const activeFundNameById = useMemo(
    () => Object.fromEntries(activeFunds.map(({ id, name }) => [id, name])),
    [activeFunds]
  );

  // Read donate handoff from sessionStorage on mount
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(HANDOFF_KEY);
      if (!raw) return;
      sessionStorage.removeItem(HANDOFF_KEY);
      const parsed = JSON.parse(raw);

      // Use clustered allocations when available and feature is on
      const sourceAllocations =
        useClusters && parsed.clusteredAllocations
          ? parsed.clusteredAllocations
          : parsed.allocations;
      if (!sourceAllocations || typeof sourceAllocations !== 'object') return;

      const ids = activeFunds.map((f) => f.id);

      // Build splits keyed by fund/cluster id, rounding to 1 decimal
      const splits = {};
      let total = 0;
      for (const id of ids) {
        const rawVal = sourceAllocations[id];
        const val = Math.round((rawVal != null ? Number(rawVal) : 0) * 10) / 10;
        splits[id] = val;
        total += val;
      }
      // Adjust rounding error on the largest entry
      const diff = Math.round((100 - total) * 10) / 10;
      if (diff !== 0) {
        const largestId = ids.reduce((best, id) =>
          (splits[id] || 0) > (splits[best] || 0) ? id : best
        );
        splits[largestId] = Math.round((splits[largestId] + diff) * 10) / 10;
      }

      setForm((prev) => ({
        ...prev,
        splitPreference: 'custom',
        splits,
      }));
      setHandoffBanner(true);
    } catch {
      // ignore corrupt handoff
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const set = useCallback((field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  }, []);

  const setSplit = useCallback((fund, value) => {
    setForm((prev) => ({
      ...prev,
      splits: { ...prev.splits, [fund]: value },
    }));
  }, []);

  // --- Validation ---
  const getMissingFields = useCallback(() => {
    const missing = [];
    if (!form.name.trim()) missing.push(config.validation.missingName);
    if (!form.email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email))
      missing.push(config.validation.missingEmail);
    if (!form.anonymity) missing.push(config.validation.missingAnonymity);
    if (form.splitPreference === 'custom') {
      const total = Object.values(form.splits).reduce((s, v) => s + (parseFloat(v) || 0), 0);
      if (Math.round(total * 10) / 10 !== 100) missing.push(config.validation.missingSplitTotal);
    }
    return missing;
  }, [form]);

  // --- Memo ---
  const memo = useMemo(() => {
    const anonOpt = config.fields.anonymity.options.find((o) => o.value === form.anonymity);
    const anonText = anonOpt ? anonOpt.label : '\u2014';

    return `Fund: ${config.memo.fundName}
Donor name: ${form.name}
Donor email: ${form.email}
Anonymity: ${anonText}`;
  }, [form]);

  // --- Actions ---
  function handleCopy() {
    const missing = getMissingFields();
    if (missing.length) {
      setWarning(config.validation.copyWarningPrefix + missing.join(', ') + '.');
      setCopyConfirm(false);
      return;
    }
    setWarning('');
    navigator.clipboard.writeText(memo).then(() => {
      setCopyConfirm(true);
      setTimeout(() => setCopyConfirm(false), 2500);
    });
  }

  async function handleSubmit() {
    const missing = getMissingFields();
    if (missing.length) {
      setWarning(config.validation.submitWarningPrefix + missing.join(', ') + '.');
      return;
    }
    setWarning('');
    setSubmitState('submitting');

    try {
      const res = await fetch(endpoints.donate, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          email: form.email.trim(),
          anonymity: form.anonymity,
          splitPreference: form.splitPreference,
          splits: form.splitPreference === 'custom' ? form.splits : undefined,
          amount: form.amount || undefined,
          refId: refId.current,
          memo,
        }),
      });
      if (!res.ok) throw new Error('Request failed');
      navigator.clipboard.writeText(memo).catch(() => {});
      setCopyConfirm(true);
      setTimeout(() => setCopyConfirm(false), 2500);
      setSubmitState('success');
    } catch (err) {
      if (
        err instanceof TypeError &&
        /failed to fetch|networkerror|load failed/i.test(err.message)
      ) {
        setNetworkBlocked(true);
      }
      setSubmitState('error');
    }
  }

  // Parse the split hint which may contain a markdown link with {quizUrl} placeholder
  function renderSplitHint() {
    const raw = config.fields.split.hint;
    const quizUrl = `${import.meta.env.BASE_URL}#`;
    const filled = raw.replace('{quizUrl}', quizUrl);
    const match = filled.match(/^(.*?)\[(.+?)\]\((.+?)\)(.*)$/);
    if (!match) return filled;
    return (
      <>
        {match[1]}
        <a href={match[3]}>{match[2]}</a>
        {match[4]}
      </>
    );
  }

  const showSplitEditor = form.splitPreference !== 'defer';
  const isComplete = form.name.trim() && form.email.trim() && form.anonymity;

  return (
    <div className="screen">
      <Header />

      <main className="screen-main" style={{ alignItems: 'flex-start' }}>
        <div className={styles.pageWrap}>
          {/* Intro */}
          <div className={styles.intro}>
            <div className={styles.eyebrow}>{config.intro.eyebrow}</div>
            <h1 className={styles.introTitle}>{config.intro.title}</h1>
            <p className={styles.introDesc}>{config.intro.description}</p>
          </div>

          <div className={styles.divider} />

          {handoffBanner && (
            <div className={styles.handoffBanner}>
              Your quiz allocations have been pre-filled below. Adjust as needed.
            </div>
          )}

          {/* Name + Email */}
          <div className={styles.formSection}>
            <div className={styles.fieldRow}>
              <div>
                <label className={styles.fieldLabel} htmlFor="donor-name">
                  {config.fields.name.label}
                </label>
                <input
                  className={styles.textInput}
                  type="text"
                  id="donor-name"
                  placeholder={config.fields.name.placeholder}
                  autoComplete="name"
                  value={form.name}
                  onChange={(e) => set('name', e.target.value)}
                />
              </div>
              <div>
                <label className={styles.fieldLabel} htmlFor="donor-email">
                  {config.fields.email.label}
                </label>
                <input
                  className={styles.textInput}
                  type="email"
                  id="donor-email"
                  placeholder={config.fields.email.placeholder}
                  autoComplete="email"
                  value={form.email}
                  onChange={(e) => set('email', e.target.value)}
                />
                <div className={styles.fieldHint}>{config.fields.email.hint}</div>
              </div>
            </div>
          </div>

          {/* Anonymity */}
          <div className={styles.formSection}>
            <label className={styles.fieldLabel}>{config.fields.anonymity.label}</label>
            <div className={styles.radioGroup}>
              {config.fields.anonymity.options.map((opt) => (
                <label
                  key={opt.value}
                  className={`${styles.radioOption} ${form.anonymity === opt.value ? styles.radioOptionSelected : ''}`}
                >
                  <input
                    type="radio"
                    name="anonymity"
                    value={opt.value}
                    checked={form.anonymity === opt.value}
                    onChange={() => set('anonymity', opt.value)}
                  />
                  <div>
                    <div className={styles.radioLabel}>{opt.label}</div>
                  </div>
                </label>
              ))}
            </div>
            <div className={styles.fieldHint}>{config.fields.anonymity.hint}</div>
          </div>

          {/* Split preference */}
          <div className={styles.formSection}>
            <label className={styles.fieldLabel}>{config.fields.split.label}</label>
            <div className={styles.fieldHint} style={{ marginTop: 0, marginBottom: 10 }}>
              {renderSplitHint()}
            </div>
            <div className={styles.radioGroup}>
              {config.fields.split.options.map((opt) => (
                <label
                  key={opt.value}
                  className={`${styles.radioOption} ${form.splitPreference === opt.value ? styles.radioOptionSelected : ''}`}
                >
                  <input
                    type="radio"
                    name="split"
                    value={opt.value}
                    checked={form.splitPreference === opt.value}
                    onChange={() => set('splitPreference', opt.value)}
                  />
                  <div>
                    <div className={styles.radioLabel}>{opt.label}</div>
                    {opt.sub && <div className={styles.radioSub}>{opt.sub}</div>}
                  </div>
                </label>
              ))}
            </div>

            {showSplitEditor && (
              <SplitEditor splits={form.splits} onChange={setSplit} funds={activeFunds} />
            )}

            {form.splitPreference === 'custom' && (
              <button
                className={styles.splitReset}
                onClick={() => set('splits', { ...DEFAULT_SPLIT })}
              >
                {config.fields.split.resetButton}
              </button>
            )}
          </div>

          {/* Amount */}
          <div className={styles.formSection}>
            <label className={styles.fieldLabel} htmlFor="donor-amount">
              {config.fields.amount.label}{' '}
              <span
                style={{
                  fontWeight: 300,
                  textTransform: 'none',
                  letterSpacing: 0,
                  color: 'var(--text-muted)',
                }}
              >
                {config.fields.amount.optionalTag}
              </span>
            </label>
            <div className={styles.amountWrap}>
              <span className={styles.currency}>$</span>
              <input
                className={styles.textInput}
                type="number"
                id="donor-amount"
                placeholder={config.fields.amount.placeholder}
                min="0"
                style={{ maxWidth: 200, paddingLeft: 26 }}
                value={form.amount}
                onChange={(e) => set('amount', e.target.value)}
              />
            </div>
            <div className={styles.fieldHint}>{config.fields.amount.hint}</div>
          </div>

          {/* Output — always shown */}
          <div className={styles.outputSection}>
            <div className={styles.divider} />
            <div className={styles.outputLabel}>{config.memo.label}</div>
            <div className={styles.outputDesc}>{config.memo.description}</div>

            <div
              className={`${styles.memoWrap} ${isComplete ? styles.memoWrapClickable : ''}`}
              onClick={isComplete ? handleCopy : undefined}
              title={isComplete ? config.actions.copy : undefined}
            >
              <div className={`${styles.memoBox} ${!isComplete ? styles.memoBoxIncomplete : ''}`}>
                {isComplete ? memo : config.memo.placeholder}
              </div>
              {isComplete && (
                <span className={styles.memoCopyIcon}>
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                  </svg>
                </span>
              )}
              {copyConfirm && (
                <div className={styles.memoCopiedOverlay}>
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  Copied to clipboard
                </div>
              )}
            </div>

            {warning && <div className={styles.missingWarning}>{warning}</div>}

            <button
              className="btn btn-primary"
              onClick={handleSubmit}
              disabled={submitState === 'submitting' || submitState === 'success'}
              style={{ marginTop: 'var(--spacing-8)', alignSelf: 'center' }}
            >
              {submitState === 'submitting'
                ? 'Submitting\u2026'
                : submitState === 'success'
                  ? config.actions.submitted
                  : config.actions.submit}
            </button>

            {submitState === 'success' && (
              <div className={styles.notifyConfirm}>
                {config.actions.successMessage.split('{email}')[0]}
                <strong>{form.email}</strong>
                {config.actions.successMessage.split('{email}')[1]}
              </div>
            )}

            {submitState === 'error' && (
              <div className={styles.missingWarning}>{config.actions.errorMessage}</div>
            )}
          </div>

          <div className={styles.legalNote}>{config.legal}</div>
        </div>
      </main>

      {networkBlocked && (
        <NetworkBlockedModal onDismiss={() => setNetworkBlocked(false)} context="donate" />
      )}
    </div>
  );
}
