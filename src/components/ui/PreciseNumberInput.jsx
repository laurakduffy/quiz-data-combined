import { useState } from 'react';

// Format a number as a string with up to 10 decimal places, stripping trailing
// zeros and absorbing float noise (e.g. 0.8 * 100 === 80.00000000000001 → "80").
export function formatNumber(n) {
  if (!n) return '0';
  const fixed = n.toFixed(10);
  return fixed.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}

// Number input that preserves typing precision. Keeps a local string state so
// intermediate values like "0." or "0.00" aren't clobbered between keystrokes,
// and re-syncs only when the external value changes independently (e.g. a preset
// is selected) using React's "adjust state during render" pattern.
//
// When a `suffix` prop is provided, the input renders as a text input that
// displays e.g. "80 %" when blurred and just "80" when focused — useful for
// percentage or unit-bearing fields where the unit should live inline with the
// number instead of floating outside the input.
export default function PreciseNumberInput({
  value,
  onChange,
  className,
  min,
  max,
  suffix,
  ...rest
}) {
  const [text, setText] = useState(() => formatNumber(value));
  const [lastValue, setLastValue] = useState(value);
  const [isFocused, setIsFocused] = useState(false);

  if (value !== lastValue) {
    setLastValue(value);
    setText(formatNumber(value));
  }

  if (suffix) {
    const display = isFocused || text === '' ? text : `${text} ${suffix}`;
    return (
      <input
        type="text"
        inputMode="decimal"
        className={className}
        value={display}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        onChange={(e) => {
          let raw = e.target.value;
          const i = raw.indexOf(suffix);
          if (i >= 0) raw = raw.slice(0, i);
          raw = raw.trim();
          setText(raw);
          const n = raw === '' ? 0 : Number(raw);
          if (!isNaN(n)) {
            setLastValue(n);
            onChange(n);
          }
        }}
        {...rest}
      />
    );
  }

  return (
    <input
      type="number"
      className={className}
      value={text}
      min={min}
      max={max}
      step="any"
      onChange={(e) => {
        const raw = e.target.value;
        setText(raw);
        const n = raw === '' ? 0 : Number(raw);
        if (!isNaN(n)) {
          setLastValue(n);
          onChange(n);
        }
      }}
      {...rest}
    />
  );
}
