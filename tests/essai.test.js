import test from 'node:test';
import assert from 'node:assert/strict';
import { dureeEssai, finEssai } from '../essai.js';

test('les anciennes durées et valeurs absentes passent à 14 jours', () => {
  for (const essai_jours of [undefined, null, 0, 3, 7, '7', 14, -1, 'invalide', Infinity]) {
    assert.equal(dureeEssai({ essai_jours }), 14);
  }
  assert.equal(dureeEssai({ essai_jours: 30 }), 30);
});

test('le compteur gagne 7 jours sans remettre la date de début à zéro', () => {
  const etab = { est_fondateur: true, essai_jours: 7, date_creation: '2026-09-01T00:00:00Z' };
  const fin = finEssai(etab).getTime();
  assert.equal(new Date(fin).toISOString(), '2026-09-15T00:00:00.000Z');
  const maintenant = Date.parse('2026-09-01T16:00:00Z');
  assert.equal((fin - maintenant) / 3600000, 13 * 24 + 8);
  assert.ok(Date.parse('2026-09-09T00:00:00Z') < fin);
  assert.equal(Date.parse('2026-09-15T00:00:00Z') < fin, false);
});

test('même échéance pour tous les établissements et conservation des prolongations', () => {
  const base = { date_creation: '2026-09-01T12:30:00Z', essai_jours: 7 };
  assert.equal(finEssai(base).getTime(), finEssai({ ...base, est_fondateur: true }).getTime());
  assert.equal(finEssai({ ...base, essai_jours: 30 }).toISOString(), '2026-10-01T12:30:00.000Z');
});

test('une date absente ou invalide ne fabrique pas un nouvel essai', () => {
  for (const etab of [null, {}, { date_creation: 'invalide' }]) assert.equal(finEssai(etab), null);
});
