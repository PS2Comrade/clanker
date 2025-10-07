#!/usr/bin/env node
/**
 * Integration Test Script for Clanker Bot
 * Tests all major components without requiring Discord connection
 */

import { initDatabase, guildConfig, moderation } from './src/database/db.js';
import { processWarning, getUserStats, getTrialName, parseDuration, formatDuration } from './src/utils/moderationLogic.js';
import { translateWithLingva } from './src/utils/translationProviders.js';

console.log('🧪 Starting Clanker Bot Integration Tests\n');

let testsPassed = 0;
let testsFailed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✅ ${name}`);
    testsPassed++;
  } catch (error) {
    console.log(`❌ ${name}`);
    console.error(`   Error: ${error.message}`);
    testsFailed++;
  }
}

function assertEquals(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`);
  }
}

// Database Tests
console.log('📊 Database Tests');
console.log('─────────────────');

test('Database initialization', () => {
  initDatabase();
});

test('Guild config - get default', () => {
  const config = guildConfig.get('test_guild_1');
  assertEquals(config.guild_id, 'test_guild_1', 'Guild ID mismatch');
  assertEquals(config.auto_translate_channels.length, 0, 'Should have no channels initially');
});

test('Guild config - add channel', () => {
  guildConfig.addAutoTranslateChannel('test_guild_1', 'channel_123');
  const config = guildConfig.get('test_guild_1');
  assertEquals(config.auto_translate_channels.length, 1, 'Should have 1 channel');
  assertEquals(config.auto_translate_channels[0], 'channel_123', 'Channel ID mismatch');
});

test('Guild config - remove channel', () => {
  guildConfig.removeAutoTranslateChannel('test_guild_1', 'channel_123');
  const config = guildConfig.get('test_guild_1');
  assertEquals(config.auto_translate_channels.length, 0, 'Should have no channels');
});

test('Guild config - blacklist', () => {
  guildConfig.addBlacklistedLanguage('test_guild_1', 'ES');
  const config = guildConfig.get('test_guild_1');
  assertEquals(config.blacklisted_languages.includes('ES'), true, 'ES should be blacklisted');
  
  guildConfig.removeBlacklistedLanguage('test_guild_1', 'ES');
  const config2 = guildConfig.get('test_guild_1');
  assertEquals(config2.blacklisted_languages.includes('ES'), false, 'ES should not be blacklisted');
});

test('Moderation - get trial', () => {
  const trial = moderation.getTrial('test_guild_2', 'user_123');
  assertEquals(trial.trial_stage, 1, 'Should start at trial 1');
  assertEquals(trial.warn_count, 0, 'Should have 0 warns');
});

test('Moderation - add action', () => {
  moderation.addAction('test_guild_2', 'user_123', 'mod_456', 'test', 'Testing');
  const history = moderation.getHistory('test_guild_2', 'user_123');
  assertEquals(history.length >= 1, true, 'Should have at least 1 action');
});

// Moderation Logic Tests
console.log('\n⚖️ Moderation Logic Tests');
console.log('─────────────────────────');

test('Trial names', () => {
  assertEquals(getTrialName(1), 'First Trial', 'Trial 1 name');
  assertEquals(getTrialName(2), 'Second Trial', 'Trial 2 name');
  assertEquals(getTrialName(3), 'Third Trial', 'Trial 3 name');
  assertEquals(getTrialName(4), 'Great Trial', 'Trial 4 name');
});

test('Duration parsing', () => {
  assertEquals(parseDuration('1h'), 3600000, '1 hour in ms');
  assertEquals(parseDuration('30m'), 1800000, '30 minutes in ms');
  assertEquals(parseDuration('1d'), 86400000, '1 day in ms');
  assertEquals(parseDuration('invalid'), null, 'Invalid duration');
});

test('Duration formatting', () => {
  assertEquals(formatDuration(3600000), '1h', 'Format 1 hour');
  assertEquals(formatDuration(1800000), '30m', 'Format 30 minutes');
  assertEquals(formatDuration(86400000), '1d', 'Format 1 day');
});

test('Warning progression - First Trial', () => {
  const guildId = 'test_guild_3';
  const userId = 'user_warn_test';
  
  // Warnings 1-4 should not ban
  for (let i = 1; i <= 4; i++) {
    const result = processWarning(guildId, userId, 'mod_123', `Warning ${i}`);
    assertEquals(result.banned, false, `Warning ${i} should not ban`);
    assertEquals(result.warnCount, i, `Should have ${i} warnings`);
  }
  
  // Warning 5 should ban
  const result5 = processWarning(guildId, userId, 'mod_123', 'Warning 5');
  assertEquals(result5.banned, true, 'Warning 5 should ban');
  assertEquals(result5.warnCount, 5, 'Should have 5 warnings');
  assertEquals(result5.nextStage, 2, 'Should move to trial 2');
  assertEquals(result5.appealDate !== null, true, 'Should have appeal date');
});

test('User stats after ban', () => {
  const stats = getUserStats('test_guild_3', 'user_warn_test');
  assertEquals(stats.trialStage, 2, 'Should be in trial 2');
  assertEquals(stats.warnCount, 0, 'Warns should be reset');
  assertEquals(stats.maxWarns, 4, 'Trial 2 max warns is 4');
});

test('Warning progression - Second Trial', () => {
  const guildId = 'test_guild_3';
  const userId = 'user_warn_test';
  
  // Warnings 1-3 should not ban
  for (let i = 1; i <= 3; i++) {
    const result = processWarning(guildId, userId, 'mod_123', `T2 Warning ${i}`);
    assertEquals(result.banned, false, `T2 Warning ${i} should not ban`);
  }
  
  // Warning 4 should ban
  const result4 = processWarning(guildId, userId, 'mod_123', 'T2 Warning 4');
  assertEquals(result4.banned, true, 'T2 Warning 4 should ban');
  assertEquals(result4.nextStage, 3, 'Should move to trial 3');
});

// Translation Provider Tests
console.log('\n🌐 Translation Provider Tests');
console.log('──────────────────────────────');

test('Translation provider structure', async () => {
  // Test that provider returns null when network unavailable (expected in test env)
  const result = await translateWithLingva('test', 'en', 'https://invalid.url');
  assertEquals(result, null, 'Should return null for invalid URL');
});

// Command Structure Tests
console.log('\n📋 Command Structure Tests');
console.log('───────────────────────────');

test('Translation commands exist', async () => {
  const { trSlashCommand, trAutoCommand, trStatusCommand } = await import('./src/commands/translation.js');
  assertEquals(typeof trSlashCommand.execute, 'function', 'tr command has execute');
  assertEquals(typeof trAutoCommand.execute, 'function', 'tr_auto command has execute');
  assertEquals(typeof trStatusCommand.execute, 'function', 'tr_status command has execute');
});

test('Moderation commands exist', async () => {
  const { warnCommand, muteCommand, kickCommand, banCommand } = await import('./src/commands/moderation.js');
  assertEquals(typeof warnCommand.execute, 'function', 'warn command has execute');
  assertEquals(typeof muteCommand.execute, 'function', 'mute command has execute');
  assertEquals(typeof kickCommand.execute, 'function', 'kick command has execute');
  assertEquals(typeof banCommand.execute, 'function', 'ban command has execute');
});

// Summary
console.log('\n═══════════════════════════════');
console.log('📊 Test Summary');
console.log('═══════════════════════════════');
console.log(`✅ Passed: ${testsPassed}`);
console.log(`❌ Failed: ${testsFailed}`);
console.log(`📈 Total: ${testsPassed + testsFailed}`);

if (testsFailed === 0) {
  console.log('\n🎉 All tests passed! Bot is ready to deploy.');
  process.exit(0);
} else {
  console.log('\n⚠️ Some tests failed. Please review errors above.');
  process.exit(1);
}
