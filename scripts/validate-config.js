#!/usr/bin/env node
/**
 * Standalone config validation script for CI
 * Validates all config JSON files
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import process from 'node:process';

// Get the project root directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');

// Import validators
const { validateQuestionsConfig } = await import(
  join(projectRoot, 'src/utils/validateQuestions.js')
);

let hasErrors = false;

/**
 * Safely load and parse a JSON file
 */
function loadJson(filename) {
  const filepath = join(projectRoot, 'config', filename);
  if (!existsSync(filepath)) {
    console.error(`✗ ${filename} not found`);
    hasErrors = true;
    return null;
  }
  try {
    return JSON.parse(readFileSync(filepath, 'utf-8'));
  } catch (error) {
    console.error(`✗ ${filename} is not valid JSON:`);
    console.error(`  ${error.message}`);
    hasErrors = true;
    return null;
  }
}

// Load all config files (validates JSON syntax)
const questionsConfig = loadJson('questions.json');
const questionsAdvancedConfig = loadJson('questions-advanced.json');
const featuresConfig = loadJson('features.json');
const copyConfig = loadJson('copy.json');
const projectsConfig = loadJson('projects.json');
const tableModeConfig = loadJson('tableMode.json');

// Validate questions.json structure
if (questionsConfig) {
  try {
    validateQuestionsConfig(questionsConfig);
    console.log('✓ questions.json validated successfully');
  } catch (error) {
    console.error('✗ questions.json validation failed:');
    console.error(`  ${error.message}`);
    hasErrors = true;
  }
}

// Validate questions-advanced.json structure
// Note: Advanced mode uses ratio questions with different schema, so we only
// validate JSON syntax here. Full validation when advanced mode is enabled.
if (questionsAdvancedConfig) {
  // Basic structure check - must have questions array
  if (!Array.isArray(questionsAdvancedConfig.questions)) {
    console.error('✗ questions-advanced.json: missing "questions" array');
    hasErrors = true;
  } else {
    console.log('✓ questions-advanced.json validated (JSON syntax + structure)');
  }
}

// Validate features.json structure
if (featuresConfig) {
  const errors = [];

  // Check expected top-level keys
  const expectedKeys = ['ui', 'calculations'];
  for (const key of expectedKeys) {
    if (featuresConfig[key] && typeof featuresConfig[key] !== 'object') {
      errors.push(`"${key}" should be an object`);
    }
  }

  // Check all values are booleans (nested check)
  function checkBooleans(obj, path = '') {
    for (const [key, value] of Object.entries(obj)) {
      if (key.startsWith('_')) continue; // Skip comments
      const fullPath = path ? `${path}.${key}` : key;
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        checkBooleans(value, fullPath);
      } else if (typeof value !== 'boolean' && !Array.isArray(value)) {
        // Allow arrays (like calculations.order) and booleans
        if (key !== 'order') {
          errors.push(`"${fullPath}" should be a boolean, got ${typeof value}`);
        }
      }
    }
  }
  checkBooleans(featuresConfig);

  if (errors.length > 0) {
    console.error('✗ features.json validation failed:');
    errors.forEach((e) => console.error(`  ${e}`));
    hasErrors = true;
  } else {
    console.log('✓ features.json validated successfully');
  }
}

// Validate copy.json structure
if (copyConfig) {
  const errors = [];

  // Check expected top-level keys exist
  const expectedKeys = ['welcome', 'navigation', 'results'];
  for (const key of expectedKeys) {
    if (!copyConfig[key]) {
      errors.push(`Missing required section: "${key}"`);
    }
  }

  // Check for empty strings (likely mistakes)
  function checkEmptyStrings(obj, path = '') {
    for (const [key, value] of Object.entries(obj)) {
      const fullPath = path ? `${path}.${key}` : key;
      if (typeof value === 'string' && value.trim() === '') {
        errors.push(`Empty string at "${fullPath}"`);
      } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        checkEmptyStrings(value, fullPath);
      }
    }
  }
  checkEmptyStrings(copyConfig);

  if (errors.length > 0) {
    console.error('✗ copy.json validation failed:');
    errors.forEach((e) => console.error(`  ${e}`));
    hasErrors = true;
  } else {
    console.log('✓ copy.json validated successfully');
  }
}

// Validate projects.json + tableMode.json cross-file consistency
if (projectsConfig && tableModeConfig) {
  const errors = [];

  const riskProfileCount = tableModeConfig.riskProfileOptions?.length;
  const timePeriodCount = tableModeConfig.discountFactorLabels?.length;
  const moralWeightKeySet = new Set((tableModeConfig.moralWeightKeys || []).map((k) => k.key));

  if (!riskProfileCount) {
    errors.push('tableMode.json: missing or empty riskProfileOptions');
  }
  if (!timePeriodCount) {
    errors.push('tableMode.json: missing or empty discountFactorLabels');
  }

  // Check riskProfileOptions values are sequential 0..N-1
  if (riskProfileCount) {
    for (let i = 0; i < riskProfileCount; i++) {
      const opt = tableModeConfig.riskProfileOptions[i];
      if (opt.value !== i) {
        errors.push(
          `tableMode.json: riskProfileOptions[${i}].value is ${opt.value}, expected ${i}`
        );
      }
      if (!opt.label || typeof opt.label !== 'string') {
        errors.push(`tableMode.json: riskProfileOptions[${i}] missing or invalid label`);
      }
    }
  }

  // Validate each project's effects
  const { projects, budget, incrementSize } = projectsConfig;
  if (!projects || typeof projects !== 'object') {
    errors.push('projects.json: missing or invalid "projects" object');
  } else {
    for (const [projectId, project] of Object.entries(projects)) {
      if (!project.effects || typeof project.effects !== 'object') {
        errors.push(`projects.json: ${projectId} missing "effects" object`);
        continue;
      }

      for (const [effectId, effect] of Object.entries(project.effects)) {
        const path = `${projectId}.${effectId}`;

        // Check recipient_type exists in moralWeightKeys
        if (!effect.recipient_type) {
          errors.push(`${path}: missing recipient_type`);
        } else if (moralWeightKeySet.size > 0 && !moralWeightKeySet.has(effect.recipient_type)) {
          errors.push(
            `${path}: recipient_type "${effect.recipient_type}" not in tableMode.json moralWeightKeys`
          );
        }

        // Check values matrix dimensions
        if (!Array.isArray(effect.values)) {
          errors.push(`${path}: missing or invalid "values" matrix`);
          continue;
        }

        if (timePeriodCount && effect.values.length !== timePeriodCount) {
          errors.push(
            `${path}: values has ${effect.values.length} rows, expected ${timePeriodCount} (discountFactorLabels)`
          );
        }

        for (let row = 0; row < effect.values.length; row++) {
          if (!Array.isArray(effect.values[row])) {
            errors.push(`${path}: values[${row}] is not an array`);
            continue;
          }
          if (riskProfileCount && effect.values[row].length !== riskProfileCount) {
            errors.push(
              `${path}: values[${row}] has ${effect.values[row].length} columns, expected ${riskProfileCount} (riskProfileOptions)`
            );
          }
          for (let col = 0; col < effect.values[row].length; col++) {
            if (typeof effect.values[row][col] !== 'number') {
              errors.push(
                `${path}: values[${row}][${col}] is ${typeof effect.values[row][col]}, expected number`
              );
            }
          }
        }
      }

      // Check diminishing_returns is a valid array of numbers
      if (project.diminishing_returns !== undefined) {
        if (!Array.isArray(project.diminishing_returns)) {
          errors.push(`${projectId}: diminishing_returns is not an array`);
        } else if (project.diminishing_returns.length === 0) {
          errors.push(`${projectId}: diminishing_returns is empty`);
        } else {
          for (let i = 0; i < project.diminishing_returns.length; i++) {
            if (typeof project.diminishing_returns[i] !== 'number') {
              errors.push(`${projectId}: diminishing_returns[${i}] is not a number`);
              break;
            }
          }
        }
      }
    }

    // Check all projects have the same diminishing_returns length
    const drLengths = Object.entries(projects)
      .filter(([, p]) => Array.isArray(p.diminishing_returns))
      .map(([id, p]) => [id, p.diminishing_returns.length]);
    if (drLengths.length > 1) {
      const firstLen = drLengths[0][1];
      for (const [id, len] of drLengths.slice(1)) {
        if (len !== firstLen) {
          errors.push(
            `${id}: diminishing_returns has ${len} entries, but ${drLengths[0][0]} has ${firstLen}`
          );
        }
      }
    }
  }

  // Validate presets reference valid moralWeightKeys and risk profiles
  if (Array.isArray(tableModeConfig.presets)) {
    for (const preset of tableModeConfig.presets) {
      const name = preset.name || preset.id || '(unnamed)';

      if (preset.moral_weights && moralWeightKeySet.size > 0) {
        for (const key of Object.keys(preset.moral_weights)) {
          if (!moralWeightKeySet.has(key)) {
            errors.push(
              `tableMode.json preset "${name}": moral_weights key "${key}" not in moralWeightKeys`
            );
          }
        }
        for (const key of moralWeightKeySet) {
          if (!(key in preset.moral_weights)) {
            errors.push(`tableMode.json preset "${name}": missing moral_weights key "${key}"`);
          }
        }
      }

      if (riskProfileCount && typeof preset.risk_profile === 'number') {
        if (preset.risk_profile < 0 || preset.risk_profile >= riskProfileCount) {
          errors.push(
            `tableMode.json preset "${name}": risk_profile ${preset.risk_profile} out of range (0-${riskProfileCount - 1})`
          );
        }
      }

      if (timePeriodCount && Array.isArray(preset.discount_factors)) {
        if (preset.discount_factors.length !== timePeriodCount) {
          errors.push(
            `tableMode.json preset "${name}": discount_factors has ${preset.discount_factors.length} entries, expected ${timePeriodCount}`
          );
        }
      }
    }
  }

  if (errors.length > 0) {
    console.error('✗ projects.json + tableMode.json cross-validation failed:');
    errors.forEach((e) => console.error(`  ${e}`));
    hasErrors = true;
  } else {
    console.log('✓ projects.json + tableMode.json cross-validated successfully');
  }
}

if (hasErrors) {
  console.error('\nValidation failed!');
  process.exit(1);
}

console.log('\nAll config files validated successfully!');
