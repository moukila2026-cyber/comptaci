import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseMontantKompto,
  parsePourcentKompto,
  unwrapKompto,
  parseKomptoError,
  buildVerifyPayload,
  buildConfirmPayload,
  KOMPTO_DEFAULTS,
  KOMPTO_TVA_CODES,
} from '../kompto.js';

test('parseMontantKompto — virgule, string et number', () => {
  assert.equal(parseMontantKompto('50000'), 50000);
  assert.equal(parseMontantKompto('655,9570'), 655.957);
  assert.equal(parseMontantKompto('2,50%'), 2.5); // même si on ne l'utilise pas pour les montants, on tolère
  assert.equal(parseMontantKompto('590 000'), 590000);
  assert.equal(parseMontantKompto(123), 123);
  assert.equal(parseMontantKompto(null), 0);
  assert.equal(parseMontantKompto(''), 0);
});

test('parsePourcentKompto — % et virgule', () => {
  assert.equal(parsePourcentKompto('18%'), 18);
  assert.equal(parsePourcentKompto('2,50%'), 2.5);
  assert.equal(parsePourcentKompto('9%'), 9);
  assert.equal(parsePourcentKompto(null), 0);
  assert.equal(parsePourcentKompto(10), 10);
});

test('unwrapKompto — value vs plat vs bare string', () => {
  const plat = { komptoEntryId: 123, items: [] };
  assert.deepEqual(unwrapKompto(plat), plat);
  const wrapped = { value: plat, isSuccessful: true };
  assert.deepEqual(unwrapKompto(wrapped), plat);
  assert.equal(unwrapKompto('"La commande n\'existe pas."'), '"La commande n\'existe pas."');
  assert.equal(unwrapKompto(null), null);
});

test('parseKomptoError — 401, 404, validation, business', () => {
  const e401 = parseKomptoError({ status: 401, body: { title: 'Clé API invalide', status: 401, detail: 'La clé API fournie n\'est pas valide.' }, raw: '{}' });
  assert.equal(e401.kind, 'auth');
  assert.match(e401.message, /clé API/i);

  const e404 = parseKomptoError({ status: 404, body: 'La commande n\'existe pas.', raw: '"La commande n\'existe pas."' });
  assert.equal(e404.kind, 'not_found');
  assert.match(e404.message, /n'existe pas/);

  const e400val = parseKomptoError({ status: 400, body: { errors: { CustomerNCC: ["Le NCC doit être composé de 7 chiffres"] } }, raw: '{}' });
  assert.equal(e400val.kind, 'validation');
  assert.match(e400val.message, /CustomerNCC/);

  const eBusiness = parseKomptoError({ status: 200, body: { isSuccessful: false, message: 'La facture électronique a déjà été générée.' }, raw: '{}' });
  assert.equal(eBusiness.kind, 'business');
  assert.match(eBusiness.message, /déjà été générée/);

  const eRaw = parseKomptoError({ status: 400, body: 'paymentMethod est invalide;', raw: 'paymentMethod est invalide;' });
  assert.equal(eRaw.kind, 'raw');
});

test('buildVerifyPayload — taxes par paire, jamais 0', () => {
  const p = buildVerifyPayload({
    clientType: 'B2B',
    clientName: 'TEST SARL',
    clientNCC: '8200001A',
    clientTelephone: '2721212121',
    clientEmail: 'test@example.ci',
    items: [
      { itemName: 'Service', itemQuantity: 1, itemUnitPrice: 10000, itemTVAName: 'TVA' },
    ],
    entryTaxTTC1Name: null,
    entryTaxTTC1Percent: null,
  });
  assert.equal(p.entryTaxTTC1Name, null);
  assert.equal(p.entryTaxTTC1Percent, null);
  assert.equal(p.items[0].itemUnitPrice, 10000);
  assert.equal(typeof p.items[0].itemUnitPrice, 'number');
});

test('buildConfirmPayload — normalisation paymentMethod et isRNE', () => {
  const c = buildConfirmPayload({ komptoEntryId: '123', establishment: 'PROGICI SARL', pointOfSale: 'SIEGE', paymentMethod: 'Transfer', isRNE: false, numberRNE: 'XYZ' });
  assert.equal(c.paymentMethod, 'transfer');
  assert.equal(c.isRNE, false);
  assert.equal(c.numberRNE, null);
  assert.equal(c.komptoEntryId, 123);
  assert.equal(typeof c.komptoEntryId, 'number');
});

test('KOMPTO defaults et TVA codes', () => {
  assert.equal(KOMPTO_DEFAULTS.establishment, 'PROGICI SARL');
  assert.equal(KOMPTO_DEFAULTS.pointOfSale, 'SIEGE');
  assert.ok(KOMPTO_TVA_CODES.includes('TVA'));
  assert.ok(KOMPTO_TVA_CODES.includes('TVAB'));
});
