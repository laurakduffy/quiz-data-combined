/**
 * Validation function for questions.json configuration
 * Runs on app initialization in development mode to catch config errors early
 * Validates worldviewDimension structure and cross-references with causes config
 */

const REQUIRED_QUESTION_FIELDS = [
  'id',
  'worldviewDimension',
  'categoryLabel',
  'icon',
  'previewText',
  'heading',
  'instructionsOptions',
  'instructionsSliders',
  'editPanelTitle',
  'options',
];

const REQUIRED_OPTION_FIELDS = ['key', 'label', 'description', 'panelLabel', 'panelShort'];

const VALID_APPLY_AS = ['multiplier', 'exponent'];
// For exponent applyAs, appliesTo must be a numeric property
const VALID_EXPONENT_APPLIES_TO = ['scaleFactor', 'points'];

/**
 * Checks for missing required fields in an object
 * @param {Object} obj - Object to check
 * @param {string[]} requiredFields - Array of required field names
 * @param {string} prefix - Prefix for error messages
 * @returns {string[]} Array of error messages
 */
function checkRequiredFields(obj, requiredFields, prefix) {
  return requiredFields
    .filter((field) => obj[field] === undefined || obj[field] === null)
    .map((field) => `${prefix}: Missing required field '${field}'`);
}

/**
 * Validates worldviewDimension object structure
 * @param {Object} dimension - The worldviewDimension object
 * @param {string} prefix - Prefix for error messages
 * @param {Object} causesConfig - The causes config for cause flag validation
 * @returns {string[]} Array of error messages
 */
function validateWorldviewDimension(dimension, prefix, causesConfig) {
  const errors = [];

  if (typeof dimension !== 'object' || dimension === null) {
    errors.push(`${prefix}: worldviewDimension must be an object`);
    return errors;
  }

  // Check applyAs is valid
  if (!dimension.applyAs) {
    errors.push(`${prefix}: worldviewDimension missing required field 'applyAs'`);
  } else if (!VALID_APPLY_AS.includes(dimension.applyAs)) {
    errors.push(
      `${prefix}: worldviewDimension.applyAs must be one of: ${VALID_APPLY_AS.join(', ')}`
    );
  }

  // Check has either appliesWhen or appliesTo
  if (!dimension.appliesWhen && !dimension.appliesTo) {
    errors.push(`${prefix}: worldviewDimension must have either 'appliesWhen' or 'appliesTo'`);
  }

  // Validate appliesWhen references a valid cause flag
  if (dimension.appliesWhen && causesConfig?.causes) {
    const firstCause = Object.values(causesConfig.causes)[0];
    if (firstCause && !(dimension.appliesWhen in firstCause)) {
      const validFlags = Object.keys(firstCause).filter((k) => typeof firstCause[k] === 'boolean');
      errors.push(
        `${prefix}: worldviewDimension.appliesWhen '${dimension.appliesWhen}' not a valid cause flag. Valid flags: ${validFlags.join(', ')}`
      );
    }
  }

  // Validate appliesTo references a valid cause property
  if (dimension.appliesTo) {
    // For exponent applyAs, must be a numeric property
    if (
      dimension.applyAs === 'exponent' &&
      !VALID_EXPONENT_APPLIES_TO.includes(dimension.appliesTo)
    ) {
      errors.push(
        `${prefix}: worldviewDimension.appliesTo for exponent must be one of: ${VALID_EXPONENT_APPLIES_TO.join(', ')}`
      );
    }
    // For multiplier applyAs, check that at least one cause has this property
    if (dimension.applyAs === 'multiplier' && causesConfig?.causes) {
      const causesWithProperty = Object.values(causesConfig.causes).filter(
        (cause) => cause[dimension.appliesTo] !== undefined
      );
      if (causesWithProperty.length === 0) {
        errors.push(
          `${prefix}: worldviewDimension.appliesTo '${dimension.appliesTo}' not found on any cause`
        );
      }
    }
  }

  // Validate options
  if (!dimension.options) {
    errors.push(`${prefix}: worldviewDimension missing required field 'options'`);
  } else if (typeof dimension.options !== 'object') {
    errors.push(`${prefix}: worldviewDimension.options must be an object`);
  } else {
    const optionKeys = Object.keys(dimension.options);
    if (optionKeys.length < 2) {
      errors.push(`${prefix}: worldviewDimension.options must have at least 2 options`);
    }

    // Check option values based on pattern
    const isAppliesToPattern = !!dimension.appliesTo && dimension.applyAs === 'multiplier';

    for (const [key, value] of Object.entries(dimension.options)) {
      if (isAppliesToPattern) {
        // appliesTo pattern: options are objects with property-value keys
        if (typeof value !== 'object' || value === null) {
          errors.push(
            `${prefix}: worldviewDimension.options.${key} must be an object for appliesTo pattern`
          );
        } else {
          // Check all nested values are numbers
          for (const [nestedKey, nestedValue] of Object.entries(value)) {
            if (typeof nestedValue !== 'number') {
              errors.push(
                `${prefix}: worldviewDimension.options.${key}.${nestedKey} must be a number`
              );
            }
          }
        }
      } else {
        // appliesWhen pattern: options are numbers
        if (typeof value !== 'number') {
          errors.push(`${prefix}: worldviewDimension.options.${key} must be a number`);
        }
      }
    }
  }

  return errors;
}

/**
 * Validates the questions configuration against causes configuration
 * @param {Object} questionsConfig - The questions configuration object
 * @param {Object} causesConfig - The causes configuration object
 * @throws {Error} If validation fails
 */
export function validateQuestionsConfig(questionsConfig, causesConfig) {
  const errors = [];

  // Check top-level structure
  if (!questionsConfig) {
    throw new Error('Questions config is missing or null');
  }

  if (!questionsConfig.questions || !Array.isArray(questionsConfig.questions)) {
    errors.push('Missing or invalid questions array');
  } else if (questionsConfig.questions.length === 0) {
    errors.push('Questions array cannot be empty');
  } else {
    // Validate each question
    const questionIds = new Set();

    questionsConfig.questions.forEach((question, qIndex) => {
      const qPrefix = `Question[${qIndex}]`;

      // Skip validation for disabled questions (type starts with underscore)
      if (question.type?.startsWith('_')) {
        return;
      }

      // Skip validation for intermission questions - they have a different structure
      if (question.type === 'intermission') {
        // Only validate required intermission fields
        if (!question.id) {
          errors.push(`${qPrefix}: Missing required field 'id'`);
        }
        if (!question.title) {
          errors.push(`${qPrefix}: Intermission missing required field 'title'`);
        }
        if (!question.body) {
          errors.push(`${qPrefix}: Intermission missing required field 'body'`);
        }
        return; // Skip rest of validation for intermissions
      }

      // Check required fields
      errors.push(...checkRequiredFields(question, REQUIRED_QUESTION_FIELDS, qPrefix));

      // Check unique ID
      if (question.id) {
        if (questionIds.has(question.id)) {
          errors.push(`${qPrefix}: Duplicate question ID '${question.id}'`);
        }
        questionIds.add(question.id);

        // Check ID format (should be valid for use as state key)
        if (!/^[a-zA-Z][a-zA-Z0-9]*$/.test(question.id)) {
          errors.push(
            `${qPrefix}: Question ID '${question.id}' must start with a letter and contain only alphanumeric characters`
          );
        }
      }

      // Validate worldviewDimension structure
      if (question.worldviewDimension) {
        errors.push(
          ...validateWorldviewDimension(question.worldviewDimension, qPrefix, causesConfig)
        );
      }

      // Validate options
      if (question.options) {
        if (!Array.isArray(question.options)) {
          errors.push(`${qPrefix}: 'options' must be an array`);
        } else if (question.options.length < 2) {
          errors.push(`${qPrefix}: Must have at least 2 options`);
        } else {
          const optionKeys = new Set();

          question.options.forEach((option, oIndex) => {
            const oPrefix = `${qPrefix}.options[${oIndex}]`;

            // Check required option fields
            errors.push(...checkRequiredFields(option, REQUIRED_OPTION_FIELDS, oPrefix));

            // Check unique option key within question
            if (option.key) {
              if (optionKeys.has(option.key)) {
                errors.push(`${oPrefix}: Duplicate option key '${option.key}'`);
              }
              optionKeys.add(option.key);
            }
          });

          // Check that option keys match worldviewDimension option keys
          if (question.worldviewDimension?.options) {
            const dimensionOptionKeys = new Set(Object.keys(question.worldviewDimension.options));

            const missingInDimension = [...optionKeys].filter((k) => !dimensionOptionKeys.has(k));
            const missingInOptions = [...dimensionOptionKeys].filter((k) => !optionKeys.has(k));

            if (missingInDimension.length > 0) {
              errors.push(
                `${qPrefix}: Option keys [${missingInDimension.join(', ')}] not found in worldviewDimension.options`
              );
            }
            if (missingInOptions.length > 0) {
              errors.push(
                `${qPrefix}: worldviewDimension.options keys [${missingInOptions.join(', ')}] not found in question options`
              );
            }
          }
        }
      }
    });
  }

  if (errors.length > 0) {
    const errorMessage = `Questions config validation failed:\n${errors.map((e) => `  - ${e}`).join('\n')}`;
    throw new Error(errorMessage);
  }

  return true;
}

export default validateQuestionsConfig;
