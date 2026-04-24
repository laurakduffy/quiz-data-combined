import { Lock } from 'lucide-react';
import { useSliderDrag } from '../../hooks/useSliderDrag';
import { useLockedSlider } from '../../hooks/useLockedSlider';
import styles from '../../styles/components/Slider.module.css';
import copy from '../../../config/copy.json';

/**
 * Compact slider for results page editing.
 * Smaller variant used in EditPanel components.
 */
function CompactSlider({
  label,
  value,
  thumbValue,
  onChange,
  color,
  credences,
  sliderKey,
  lockedKeys = [],
  setLockedKeys,
  hideLock = false,
  inlineValue = false,
}) {
  // The thumb position can be animated independently of the displayed percent:
  // callers pass `thumbValue` to tween the slider while `value` (the text)
  // jumps straight to the final number.
  const displayedThumb = thumbValue != null ? thumbValue : value;
  const { isLocked, hasLockedSibling, thumbOffset, canLockMore, featureEnabled } = useLockedSlider({
    sliderKey,
    lockedKeys,
    credences,
  });

  const { isDragging, dragHandlers } = useSliderDrag({
    credences,
    isLocked,
    lockedKeys,
    onChange,
  });

  const handleLockClick = () => {
    if (!featureEnabled) return;
    if (isLocked) {
      // Unlock: remove from array
      setLockedKeys(lockedKeys.filter((k) => k !== sliderKey));
    } else if (canLockMore) {
      // Lock: add to array (only if we can lock more)
      setLockedKeys([...lockedKeys, sliderKey]);
    }
  };

  const sliderBackground = hasLockedSibling
    ? `linear-gradient(to right, ${color} 0%, ${color} ${displayedThumb}%, rgba(255,255,255,0.15) ${displayedThumb}%, rgba(255,255,255,0.15) ${thumbOffset}, rgba(255,255,255,0.08) ${thumbOffset}, rgba(255,255,255,0.08) 100%)`
    : `linear-gradient(to right, ${color} 0%, ${color} ${displayedThumb}%, rgba(255,255,255,0.15) ${displayedThumb}%, rgba(255,255,255,0.15) 100%)`;

  return (
    <div className={styles.compactSlider}>
      {!inlineValue && (
        <div className={styles.header}>
          <span className={styles.label}>{label}</span>
          <span className={styles.value}>{Math.round(value)}%</span>
        </div>
      )}
      <div className={styles.sliderRow}>
        {inlineValue && (
          <span className={`${styles.value} ${styles.inlineValue}`}>{Math.round(value)}%</span>
        )}
        <div className={styles.sliderContainer}>
          <input
            type="range"
            min="0"
            max="100"
            step="any"
            value={displayedThumb}
            {...dragHandlers}
            data-dragging={isDragging}
            disabled={isLocked}
            style={{
              background: sliderBackground,
              cursor: isLocked ? 'not-allowed' : 'pointer',
            }}
          />
          {hasLockedSibling && <div className={styles.lockLimit} style={{ left: thumbOffset }} />}
        </div>
        {featureEnabled && !hideLock && (
          <button
            className={`${styles.lockButton} ${isLocked ? styles.locked : ''} ${!isLocked && !canLockMore ? styles.lockDisabled : ''}`}
            onClick={handleLockClick}
            title={isLocked ? copy.sliders.unlockTooltip : copy.sliders.lockTooltip}
            type="button"
            disabled={!isLocked && !canLockMore}
          >
            <Lock size={14} />
          </button>
        )}
      </div>
    </div>
  );
}

export default CompactSlider;
