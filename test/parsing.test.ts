import { describe, expect, it } from 'vitest';
import homesFixture from './fixtures/homes.json';
import devicesFixture from './fixtures/devices.json';
import { parseDevice, parseDevices, parseHomes } from '../src/client/parsing';
import { LockStatus } from '../src/client/types';

describe('parseHomes', () => {
  it('parses home id and name', () => {
    const homes = parseHomes(homesFixture);
    expect(homes).toEqual([{ homeId: '54bdb081-ed79-429b-a8ee-accab83dbc55', homeName: 'Casa DAngela' }]);
  });

  it('returns empty array for missing data', () => {
    expect(parseHomes({})).toEqual([]);
    expect(parseHomes(null)).toEqual([]);
  });
});

describe('parseDevices', () => {
  it('parses the lock fields from the list endpoint', () => {
    const [dev] = parseDevices(devicesFixture);
    expect(dev).toMatchObject({
      deviceId: '10aaa9a07a7c3f35de',
      name: 'Front Door',
      lockStatus: LockStatus.Locked,
      batteryPercentage: 100,
      online: true,
      modelNumber: 'HALO-01',
    });
  });
});

describe('parseDevice', () => {
  it('falls back to deviceid when serialnumber is absent', () => {
    const dev = parseDevice({ deviceid: 'abc', lockstatus: 'Unlocked' });
    expect(dev?.deviceId).toBe('abc');
    expect(dev?.lockStatus).toBe(LockStatus.Unlocked);
  });

  it('reads doorstatus from the detail endpoint shape', () => {
    const dev = parseDevice({ serialnumber: 'abc', doorstatus: 'Jammed' });
    expect(dev?.lockStatus).toBe(LockStatus.Jammed);
  });

  it('treats a non-connected device as offline', () => {
    const dev = parseDevice({ serialnumber: 'abc', deviceconnectivitystatus: 'disconnected' });
    expect(dev?.online).toBe(false);
  });

  it('returns null without an identifier', () => {
    expect(parseDevice({ lockstatus: 'Locked' })).toBeNull();
  });

  it('coerces a string battery percentage and ignores blanks', () => {
    expect(parseDevice({ deviceid: 'a', batterypercentage: '55' })?.batteryPercentage).toBe(55);
    expect(parseDevice({ deviceid: 'a', batterypercentage: '' })?.batteryPercentage).toBeUndefined();
  });
});
