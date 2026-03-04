/**
 * Causes adapter — single import point for legacy cause data.
 *
 * Merges display metadata (name, color) from projects.json into the
 * cause definitions from causes.json so both datasets stay in sync.
 *
 * Consumers should import from this module instead of causes.json directly.
 * When the legacy calculation system is eventually migrated to use the
 * Marcus-style effect matrices, this adapter can be removed.
 */

import causesConfig from '../../config/causes.json';
import projectsConfig from '../../config/projects.json';

const { causes: rawCauses, ...rest } = causesConfig;
const { projects } = projectsConfig;

// Merge name and color from projects.json into each cause,
// preferring projects.json as the source of truth for display data.
const causes = {};
for (const [id, cause] of Object.entries(rawCauses)) {
  const project = projects[id];
  causes[id] = {
    ...cause,
    name: project?.name ?? cause.name,
    color: project?.color ?? cause.color,
  };
}

export default { ...rest, causes };
