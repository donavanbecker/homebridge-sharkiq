# homebridge-sharkiq Plugin Development

homebridge-sharkiq is a Homebridge plugin written in TypeScript that enables controlling SharkIQ vacuum cleaners through Apple HomeKit. The plugin connects to SharkClean servers via API to provide vacuum control, status monitoring, and power mode management.

Always reference these instructions first and fallback to search or bash commands only when you encounter unexpected information that does not match the info here.

## Git Branch and PR Targeting Strategy

### Branch Selection for Pull Requests
When creating pull requests, always follow this priority order:

1. **Check for Beta Branches First**: Use `git branch -r | grep origin/beta-` or GitHub API to check for branches that start with "beta-"
2. **Target Beta Branch**: If any beta branches exist, target the most recent beta branch (e.g., `beta-1.4.1`)
3. **Fallback to Latest**: If no beta branches exist, target the `latest` branch
4. **Never target main/master**: This repository uses `latest` as the primary development branch, not main/master

### Implementation Steps
```bash
# Method 1: Check for beta branches using git (after fetching)
git fetch origin
git branch -r | grep "origin/beta-" | sort -V | tail -1

# Method 2: Use GitHub API to list branches (more reliable)
# Use github-mcp-server-list_branches to see all available branches

# If beta branch found (e.g., beta-1.4.1), use it as base:
git checkout -b feature/your-change origin/beta-1.4.1

# If no beta branch found, use latest:
git checkout -b feature/your-change origin/latest
```

### Branch Verification
Always verify you're targeting the correct branch before making changes:
- Run `git status` to confirm current branch
- Use `github-mcp-server-list_branches` tool to see all available branches
- Run `git fetch origin && git branch -r` to see all available remote branches  
- Prioritize beta branches over latest for all development work
- Current available branches include: `beta-1.4.1`, `latest`, `copilot/fix-56`

## Working Effectively

### Initial Setup
- Install dependencies: `PUPPETEER_SKIP_DOWNLOAD=true npm install`
  - **CRITICAL**: Puppeteer requires Chrome download which fails in restricted environments. Always use `PUPPETEER_SKIP_DOWNLOAD=true` environment variable.
  - Takes ~10 seconds. NEVER CANCEL. Set timeout to 30+ seconds.
- Lint code: `npm run lint` - takes ~3 seconds
- Build plugin: `npm run build` - takes ~5 seconds. NEVER CANCEL. Set timeout to 30+ seconds.
- Generate documentation: `npm run docs` - takes ~5 seconds

### Build and Development Workflow
- Clean build: `npm run clean && npm run build`
- Development watch mode: `npm run watch` (requires Homebridge setup)
- Fix linting issues: `npm run lint:fix`
- Plugin UI setup: `npm run plugin-ui` (copies UI files to dist)

### Testing and Validation
- **IMPORTANT**: There are no unit tests in this project yet (`npm test` only runs `npm install`)
- **Critical validation steps after any code change:**
  1. `npm run build && npm run lint` - Takes ~8 seconds total
  2. Plugin loadability test: `node -e "const plugin = require('./dist/index.js').default; console.log('✓ Plugin loaded successfully');"`
  3. Plugin registration test: `node -e "const plugin = require('./dist/index.js').default; const mockAPI = { registerPlatform: () => true }; plugin(mockAPI); console.log('✓ Plugin registration works');"`
  4. Configuration schema test: `node -e "const schema = require('./config.schema.json'); console.log('✓ Schema valid:', schema.pluginAlias);"`
- Always run `npm run lint` before committing changes or CI will fail
- Check for outdated packages: `npm run check` (may show available updates)

## Key Project Structure

### Source Code Organization
- `src/index.ts` - Main plugin entry point that registers the platform
- `src/platform.ts` - Core SharkIQPlatform class, handles device discovery and login
- `src/platformAccessory.ts` - Individual vacuum accessory implementation
- `src/login.ts` - Authentication handling (OAuth and email/password)
- `src/config.ts` - Configuration validation and OAuth URL generation
- `src/sharkiq-js/` - SharkIQ API wrapper classes
  - `ayla_api.ts` - Core API communication with Ayla IoT platform
  - `sharkiq.ts` - SharkIQ vacuum device abstraction
  - `properties.ts` - Vacuum properties and mode definitions
- `src/homebridge-ui/` - Custom Homebridge configuration UI
- `config.schema.json` - Homebridge configuration schema

### Build Output
- `dist/` - Compiled JavaScript and type definitions
- `docs/` - Generated TypeDoc documentation
- Build generates ES modules (type: "module" in package.json)

## Authentication and Login Methods

### OAuth Code Method (Recommended)
The plugin supports manual OAuth login for cases where automated login fails:
1. Run Homebridge with plugin configured
2. Check logs for OAuth URL (printed by homebridge-sharkiq)
3. Open URL in browser (NOT Safari - use Chrome/Firefox)
4. Open developer tools → Network tab
5. Login with SharkClean credentials
6. Find `/authorize/resume` request in network tab
7. Extract code from `com.sharkninja.shark://...callback?code=XXXX&state=` URL
8. Add extracted code to `oAuthCode` config field
9. Remove email/password from config when using OAuth code

### Email/Password Method
- Direct login using SharkClean account credentials
- May fail on some platforms (documented in login.ts for linux arm64)
- Plugin will fallback to OAuth method if automatic login fails

## Plugin Configuration

### Required Configuration
```json
{
  "platforms": [{
    "name": "SharkIQ",
    "platform": "SharkIQ", 
    "vacuums": ["DSN1", "DSN2"],
    "europe": false
  }]
}
```

### Authentication Options
- `email` + `password` - Direct login credentials
- `oAuthCode` - Manual OAuth code (remove email/password when using this)
- `europe` - Set to true for European SharkClean servers

### Device Serial Numbers (DSNs)
- Found in SharkClean mobile app
- Must match exactly the devices on your account
- Plugin will warn if provided DSNs don't match account devices

## Validation Scenarios

### After Making Code Changes
1. **Always build and lint**: `npm run build && npm run lint` - takes ~8 seconds total
2. **Essential validation tests** (run all 4):
   ```bash
   # Test 1: Plugin loads successfully  
   node -e "const plugin = require('./dist/index.js').default; console.log('✓ Plugin loaded');"
   
   # Test 2: Plugin registration works
   node -e "const plugin = require('./dist/index.js').default; const mockAPI = { registerPlatform: () => true }; plugin(mockAPI); console.log('✓ Registration works');"
   
   # Test 3: Configuration schema is valid
   node -e "const schema = require('./config.schema.json'); console.log('✓ Schema valid:', schema.pluginAlias);"
   
   # Test 4: TypeScript declarations generated
   ls dist/*.d.ts >/dev/null && echo "✓ Type definitions generated"
   ```
3. **Optional**: `npm run docs` to regenerate documentation if you modified JSDoc comments
4. **Before committing**: `npm run lint:fix` to auto-fix any style issues

### Manual Testing Scenarios
**IMPORTANT**: This plugin requires real SharkClean account credentials and vacuum devices to test fully. Without these, you can only validate build and load functionality.

**Always run these 4 validation tests after any change:**
```bash
# Essential validation suite (works without hardware)
npm run build && npm run lint && \
node -e "require('./dist/index.js').default({registerPlatform:()=>{}});console.log('✓ All tests passed')"
```

**If you have SharkClean account access (hardware testing):**
1. Configure plugin with valid credentials in Homebridge
2. Start Homebridge: `homebridge -D -U ~/.homebridge-dev`
3. Check logs for successful vacuum discovery
4. Verify OAuth URL generation if using OAuth method
5. Test vacuum appears in HomeKit app

### Full Integration Testing (requires hardware)
If you have access to SharkClean account and vacuum:
1. Configure plugin with valid credentials
2. Start Homebridge with the plugin
3. Verify vacuum appears in HomeKit
4. Test vacuum controls: on/off, power modes, pause
5. Verify docked status sensor works correctly

## Common Development Tasks

### Modifying API Communication
- Key files: `src/sharkiq-js/ayla_api.ts`, `src/login.ts`
- Always test OAuth flow when modifying authentication
- Check both US and European server endpoints (`europe` config)

### Adding New Vacuum Features
- Modify `src/sharkiq-js/properties.ts` for new properties
- Update `src/platformAccessory.ts` for HomeKit service mappings
- Add corresponding config options to `config.schema.json`

### UI Configuration Changes
- Update `src/homebridge-ui/public/index.html` for UI layout
- Modify `src/homebridge-ui/server.ts` for server-side logic
- Run `npm run plugin-ui` to copy UI files to dist after changes

### Documentation Updates
- Run `npm run docs` to regenerate TypeDoc documentation
- Update this file when adding new development workflows
- Always update README.md for user-facing changes

## Dependencies and Environment

### Node.js Requirements
- Requires Node.js ^22 || ^24 (package.json engines field)
- Current test environment uses Node v20 with EBADENGINE warnings (still works)

### Key Dependencies
- `puppeteer` - Used for automated browser login (skipped in restricted environments)
- `@homebridge/plugin-ui-utils` - Custom configuration UI framework
- `node-fetch` - HTTP requests to SharkClean API (v2.6.1 for compatibility)

### Network Dependencies
- **CRITICAL**: Plugin requires internet access to SharkClean servers
- OAuth login requires browser automation (may fail in headless environments)  
- Always use `PUPPETEER_SKIP_DOWNLOAD=true` in restricted network environments

## CI/CD Pipeline

### GitHub Actions Workflows
- Build/test: `.github/workflows/build.yml` (uses shared Homebridge workflows)
- Release: `.github/workflows/release.yml` (publishes to npm)
- Runs on Node.js matrix, includes lint and build validation

### Pre-publish Validation
- `npm run prepublishOnly` - Runs complete validation: lint → build → plugin-ui → docs → docs:lint → docs:theme
- Takes ~20 seconds total. NEVER CANCEL. Set timeout to 60+ seconds.
- All commands must pass for successful npm publication
- If any step fails, fix issues before attempting to publish

## Troubleshooting

### Common Build Issues
- "Puppeteer Chrome download failed" → Use `PUPPETEER_SKIP_DOWNLOAD=true npm install`
- "TypeScript compilation errors" → Check `tsconfig.json` and fix type issues
- "ESLint max-warnings exceeded" → Run `npm run lint:fix` to auto-fix issues

### Runtime Issues  
- "OAuth data not found" → Clear OAuth code and retry login process
- "DSN not found" → Verify vacuum serial numbers in SharkClean app
- "Authentication failed" → Try OAuth code method instead of email/password

### Platform-Specific Issues
- Linux ARM64: Automatic login disabled, must use OAuth code method
- Network restrictions: Use manual OAuth flow, skip Puppeteer downloads