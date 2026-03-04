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

if (hasErrors) {
  console.error('\nValidation failed!');
  process.exit(1);
}

console.log('\nAll config files validated successfully!');
