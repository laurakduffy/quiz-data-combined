import { useState, useRef, useCallback, useMemo } from 'react';
import Header from '../layout/Header';
import styles from '../../styles/components/DonationPage.module.css';
import SplitEditor from './SplitEditor';
import { endpoints } from '../../config/api';
import config from '../../../config/donationPage.json';

const DEFAULT_SPLIT = Object.fromEntries(
  config.funds.map(({ name, defaultPct }) => [name, defaultPct])
);

function genRefId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = '';
  for (let i = 0; i < 4; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return config.memo.refIdPrefix + '-' + new Date().getFullYear() + '-' + id;
}

export default function DonationPage() {
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
  const refId = useRef(genRefId());

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

  const isComplete = getMissingFields().length === 0;

  // --- Memo ---
  const memo = useMemo(() => {
    const anonOpt = config.fields.anonymity.options.find((o) => o.value === form.anonymity);
    const anonText = anonOpt ? anonOpt.label : '\u2014';

    let splitText = config.fields.split.options[0].label; // "defer" label
    if (form.splitPreference === 'recommended') {
      splitText = 'RP recommended split:';
      for (const [fund, pct] of Object.entries(DEFAULT_SPLIT)) {
        splitText += `\n  ${fund}: ${pct ?? 0}%`;
      }
    } else if (form.splitPreference === 'custom') {
      splitText = 'Custom split:';
      for (const [fund, pct] of Object.entries(form.splits)) {
        splitText += `\n  ${fund}: ${pct}%`;
      }
    }

    let text = `Fund: ${config.memo.fundName}
Donor name: ${form.name}
Donor email: ${form.email}
Anonymity: ${anonText}
Split preference: ${splitText}`;
    if (form.amount) text += `\nApproximate amount: $${parseFloat(form.amount).toLocaleString()}`;
    text += `\nReference: ${refId.current}`;
    return text;
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
      setSubmitState('success');
    } catch {
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
              <SplitEditor
                splits={form.splitPreference === 'recommended' ? DEFAULT_SPLIT : form.splits}
                onChange={setSplit}
                readOnly={form.splitPreference === 'recommended'}
              />
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

            <div className={`${styles.memoBox} ${!isComplete ? styles.memoBoxIncomplete : ''}`}>
              {isComplete ? memo : config.memo.placeholder}
            </div>

            {warning && <div className={styles.missingWarning}>{warning}</div>}

            <div className={styles.actionRow}>
              <button className="btn btn-primary btn-sm" onClick={handleCopy}>
                {config.actions.copy}
              </button>
              <button
                className="btn btn-secondary btn-sm"
                onClick={handleSubmit}
                disabled={submitState === 'submitting' || submitState === 'success'}
              >
                {submitState === 'success' ? config.actions.submitted : config.actions.submit}
              </button>
            </div>

            {copyConfirm && <div className={styles.copyConfirm}>{config.actions.copyConfirm}</div>}

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

            <div className={styles.refId}>
              Reference ID: <strong>{refId.current}</strong>
            </div>
          </div>

          <div className={styles.legalNote}>{config.legal}</div>
        </div>
      </main>
    </div>
  );
}
