const required = ['MAC_CSC_LINK', 'MAC_CSC_KEY_PASSWORD', 'APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID'];
const missing = required.filter((name) => !process.env[name]?.trim());
if (missing.length) throw new Error(`Register these repository Actions secrets: ${missing.join(', ')}`);
console.log('All required signing secrets are present (values are not displayed).');
