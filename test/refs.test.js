import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  cleanKey, suggestKey, parseRef, cleanProjectKey, suggestProjectKey, parseCardId,
} from '../server/refs.js';

test('cleanKey takes a key in any case and stores it in capitals', () => {
  assert.equal(cleanKey('sch'), 'SCH');
  assert.equal(cleanKey('  Wrk2 '), 'WRK2');
  assert.equal(cleanKey('AB'), 'AB');
  assert.equal(cleanKey('ABCDEF'), 'ABCDEF');
});

test('cleanKey refuses anything that cannot be a key', () => {
  for (const bad of ['', 'A', '1AB', 'ABCDEFG', 'S-H', 'S H', 'שכ', null, undefined]) {
    assert.equal(cleanKey(bad), undefined, `${bad} should be refused`);
  }
});

test('suggestKey uses initials for a name in several words', () => {
  assert.equal(suggestKey('My board', 1, []), 'MB');
  assert.equal(suggestKey('side project two', 1, []), 'SPT');
});

test('suggestKey uses the first three letters of one word', () => {
  assert.equal(suggestKey('School', 4, []), 'SCH');
  assert.equal(suggestKey('Demo', 2, []), 'DEM');
  assert.equal(suggestKey('Personal', 3, []), 'PER');
});

test('suggestKey falls back to B and the id when the name has no Latin letters', () => {
  assert.equal(suggestKey('לימודים', 5, []), 'B5');
  assert.equal(suggestKey('', 7, []), 'B7');
  assert.equal(suggestKey('X', 8, []), 'B8');   // one letter is too short for a key
});

test('suggestKey ignores words that do not start with a letter', () => {
  assert.equal(suggestKey('2026 plans', 1, []), 'PLA');
  assert.equal(suggestKey('עבודה Work', 1, []), 'WOR');
});

test('suggestKey adds a digit while the key is taken', () => {
  assert.equal(suggestKey('School', 9, ['SCH']), 'SCH2');
  assert.equal(suggestKey('School', 9, ['SCH', 'SCH2']), 'SCH3');
  assert.equal(suggestKey('Schedule', 9, ['SCH']), 'SCH2');
});

test('suggestKey always returns a valid key', () => {
  assert.equal(cleanKey(suggestKey('ABCDEF', 1, ['ABC'])), 'ABC2');
  assert.ok(cleanKey(suggestKey('דבר', 1234567, [])));
  assert.ok(cleanKey(suggestKey('a b c d e f g h', 1, ['ABCD'])));
});

test('parseRef reads a reference in any case, with or without a hash', () => {
  assert.deepEqual(parseRef('SCH-3'), { key: 'SCH', number: 3 });
  assert.deepEqual(parseRef('sch-3'), { key: 'SCH', number: 3 });
  assert.deepEqual(parseRef('#MB-120'), { key: 'MB', number: 120 });
  assert.deepEqual(parseRef(' B5-1 '), { key: 'B5', number: 1 });
});

test('parseRef refuses anything that is not a reference', () => {
  for (const bad of ['3', '282', 'SCH', 'SCH-', 'SCH-x', '-3', 'S-3', 'TOOLONG-3', 'SCH-3-4', '', null]) {
    assert.equal(parseRef(bad), null, `${bad} should not parse`);
  }
});

/* ---------------- project keys ---------------- */

test('cleanProjectKey takes 2 to 5 letters in any case and stores them in capitals', () => {
  assert.equal(cleanProjectKey('crc'), 'CRC');
  assert.equal(cleanProjectKey(' Kip '), 'KIP');
  assert.equal(cleanProjectKey('HR'), 'HR');
  assert.equal(cleanProjectKey('PROTO'), 'PROTO');
});

test('cleanProjectKey refuses digits, one letter, six letters and anything else', () => {
  for (const bad of ['C', 'TOOLNG', 'CR1', '1CR', 'C-R', 'קרקל', '', null, undefined]) {
    assert.equal(cleanProjectKey(bad), undefined, `${bad} should be refused`);
  }
});

test('suggestProjectKey uses initials for several words and three letters for one', () => {
  assert.equal(suggestProjectKey('Kigali Irrigation Planner', []), 'KIP');
  assert.equal(suggestProjectKey('Smart-city', []), 'SC');
  assert.equal(suggestProjectKey('Website', []), 'WEB');
  // Digits are not part of a project key, so "106" is skipped.
  assert.equal(suggestProjectKey('106 Dashboard', []), 'DAS');
});

test('suggestProjectKey starts from PRJ when the name has too few Latin letters', () => {
  assert.equal(suggestProjectKey('סימולציה', []), 'PRJ');
  assert.equal(suggestProjectKey('A', []), 'PRJ');
});

test('suggestProjectKey swaps the end for a letter while the key is taken', () => {
  assert.equal(suggestProjectKey('Caracal', ['CAR']), 'CARA');
  assert.equal(suggestProjectKey('Caracal', ['CAR', 'CARA']), 'CARB');
  const taken = ['PRJ', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((l) => `PRJ${l}`)];
  assert.equal(suggestProjectKey('תכנון', taken), 'PRJAA');
});

test('suggestProjectKey always returns a valid project key', () => {
  for (const name of ['a b c d e f g', 'x', '', 'Mehiron AI', 'Code-cal / CitiCode', 'ננ"ס']) {
    assert.ok(cleanProjectKey(suggestProjectKey(name, ['MA', 'CCC'])), name);
  }
});

test('parseCardId reads a card id, bare or after a hash', () => {
  assert.equal(parseCardId('300'), 300);
  assert.equal(parseCardId('#300'), 300);
  assert.equal(parseCardId(' #7 '), 7);
  for (const bad of ['MB-300', '#', '3.5', '-3', '', null]) assert.equal(parseCardId(bad), null, String(bad));
});
