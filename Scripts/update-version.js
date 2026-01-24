#!/usr/bin/env node
"use strict";
/**
 * Script to update WhatsApp Web version across the codebase.
 * Fetches the latest version from web.whatsapp.com and updates:
 * - lib/Defaults/baileys-version.json
 * - lib/Utils/generics.js (references the JSON file)
 *
 * Usage: node Scripts/update-version.ts
 */
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = require("fs");
const path_1 = require("path");
const ROOT_DIR = (0, path_1.join)(__dirname, '..');
/**
 * Fetch latest WhatsApp Web version
 */
function fetchLatestWaWebVersion() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const defaultHeaders = {
                'sec-fetch-site': 'none',
                'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
            };
            const response = yield fetch('https://web.whatsapp.com/sw.js', {
                method: 'GET',
                headers: defaultHeaders
            });
            if (!response.ok) {
                throw new Error(`Failed to fetch sw.js: ${response.statusText}`);
            }
            const data = yield response.text();
            const regex = /\\?"client_revision\\?":\s*(\d+)/;
            const match = data.match(regex);
            if (!(match === null || match === void 0 ? void 0 : match[1])) {
                throw new Error('Could not find client revision in the fetched content');
            }
            const clientRevision = match[1];
            return {
                version: [2, 3000, +clientRevision],
                isLatest: true
            };
        }
        catch (error) {
            return {
                version: null,
                isLatest: false,
                error
            };
        }
    });
}
function updateBaileysVersionJson(version) {
    const filePath = (0, path_1.join)(ROOT_DIR, 'lib/Defaults/baileys-version.json');
    const content = {
        version
    };
    try {
        const currentContent = (0, fs_1.readFileSync)(filePath, 'utf-8');
        const currentVersion = JSON.parse(currentContent).version;
        if (currentVersion[0] === version[0] && currentVersion[1] === version[1] && currentVersion[2] === version[2]) {
            console.log(`✓ baileys-version.json already up to date`);
            return false;
        }
        (0, fs_1.writeFileSync)(filePath, JSON.stringify(content, null, 4) + '\n');
        console.log(`✓ Updated baileys-version.json: [${currentVersion.join(', ')}] → [${version.join(', ')}]`);
        return true;
    }
    catch (error) {
        console.error(`✗ Failed to update baileys-version.json:`, error);
        throw error;
    }
}
function updateGenericsJs(version) {
    const filePath = (0, path_1.join)(ROOT_DIR, 'lib/Utils/generics.js');
    try {
        // The JavaScript file uses baileys_version_json_1.version which imports from baileys-version.json
        // So we just need to verify the file exists and uses the imported version
        const content = (0, fs_1.readFileSync)(filePath, 'utf-8');
        // Verify it uses the imported version
        if (!content.includes('baileys_version_json_1.version')) {
            console.log(`⚠ Warning: lib/Utils/generics.js may not be using imported version`);
        }
        else {
            console.log(`✓ lib/Utils/generics.js uses imported version from baileys-version.json (no direct update needed)`);
        }
        return false;
    }
    catch (error) {
        console.error(`✗ Failed to check lib/Utils/generics.js:`, error);
        throw error;
    }
}
function main() {
    return __awaiter(this, void 0, void 0, function* () {
        console.log('🔄 Fetching latest WhatsApp Web version...\n');
        const result = yield fetchLatestWaWebVersion();
        if (!result.isLatest || !result.version) {
            console.error('❌ Failed to fetch latest version:', result.error);
            process.exit(1);
        }
        console.log(`📦 Latest version: [${result.version.join(', ')}]\n`);
        const updates = [
            updateBaileysVersionJson(result.version),
            updateGenericsJs(result.version)
        ];
        const hasUpdates = updates.some(Boolean);
        console.log('');
        if (hasUpdates) {
            console.log('✅ Version update complete!');
            // Set GitHub Actions output if running in CI
            if (process.env.GITHUB_OUTPUT) {
                const { appendFileSync } = yield import('fs');
                appendFileSync(process.env.GITHUB_OUTPUT, `updated=true\n`);
                appendFileSync(process.env.GITHUB_OUTPUT, `version=${result.version.join('.')}\n`);
            }
        }
        else {
            console.log('✅ All files are already up to date.');
            if (process.env.GITHUB_OUTPUT) {
                const { appendFileSync } = yield import('fs');
                appendFileSync(process.env.GITHUB_OUTPUT, `updated=false\n`);
            }
        }
    });
}
main().catch(error => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
});
