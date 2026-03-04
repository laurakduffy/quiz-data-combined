import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { SortableContext, horizontalListSortingStrategy } from '@dnd-kit/sortable';
import { restrictToHorizontalAxis } from '@dnd-kit/modifiers';
import WorldviewColumn from './WorldviewColumn';
import tableConfig from '../../../config/tableMode.json';
import styles from '../../styles/components/TableMode.module.css';

/**
 * Build the flat list of row descriptors. Both the label column and
 * each data column render this same list so heights stay in sync.
 */
function buildRows() {
  const rows = [];

  rows.push({ type: 'sectionTitle', label: 'Credence' });
  rows.push({ type: 'data', field: 'credence', label: 'Weight' });

  rows.push({ type: 'sectionTitle', label: 'Moral Weights' });
  for (const mw of tableConfig.moralWeightKeys) {
    rows.push({ type: 'data', field: `moral_weights.${mw.key}`, label: mw.label });
  }

  rows.push({ type: 'sectionTitle', label: 'Discount Factors' });
  for (let i = 0; i < tableConfig.discountFactorLabels.length; i++) {
    rows.push({
      type: 'data',
      field: `discount_factor.${i}`,
      label: tableConfig.discountFactorLabels[i],
    });
  }

  rows.push({ type: 'sectionTitle', label: 'Risk' });
  rows.push({ type: 'data', field: 'risk_profile', label: 'Risk Profile' });
  rows.push({ type: 'data', field: 'p_extinction', label: 'Non-xrisk discount' });

  return rows;
}

const ROWS = buildRows();

export { ROWS };

function SpreadsheetInput({
  worldviews,
  credences,
  lockedKeys,
  setLockedKeys,
  onCredenceChange,
  onUpdate,
  onUpdateDiscount,
  onApplyPreset,
  onAdd,
  onRemove,
  onReorder,
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor)
  );

  const handleDragEnd = (event) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = worldviews.findIndex((wv) => wv.uid === active.id);
    const newIndex = worldviews.findIndex((wv) => wv.uid === over.id);
    if (oldIndex !== -1 && newIndex !== -1) {
      onReorder(oldIndex, newIndex);
    }
  };

  return (
    <div className={styles.spreadsheet}>
      <div className={styles.spreadsheetScroll}>
        {/* Row labels column */}
        <div className={styles.rowLabels}>
          <div className={styles.labelHeader} />
          {ROWS.map((row, i) =>
            row.type === 'sectionTitle' ? (
              <div key={i} className={styles.sectionTitle}>
                {row.label}
              </div>
            ) : (
              <div key={i} className={styles.rowLabel}>
                {row.label}
              </div>
            )
          )}
        </div>

        {/* Worldview columns */}
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToHorizontalAxis]}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={worldviews.map((wv) => wv.uid)}
            strategy={horizontalListSortingStrategy}
          >
            {worldviews.map((wv, i) => (
              <WorldviewColumn
                key={wv.uid}
                id={wv.uid}
                worldview={wv}
                index={i}
                rows={ROWS}
                columnIndex={i}
                totalColumns={worldviews.length}
                credences={credences}
                lockedKeys={lockedKeys}
                setLockedKeys={setLockedKeys}
                onCredenceChange={onCredenceChange}
                onUpdate={onUpdate}
                onUpdateDiscount={onUpdateDiscount}
                onApplyPreset={onApplyPreset}
                onRemove={onRemove}
                canRemove={worldviews.length > 1}
              />
            ))}
          </SortableContext>
        </DndContext>

        {/* Add column button */}
        <div className={styles.addColumn}>
          <button type="button" className={styles.addButton} onClick={onAdd}>
            +
          </button>
        </div>
      </div>
    </div>
  );
}

export default SpreadsheetInput;
