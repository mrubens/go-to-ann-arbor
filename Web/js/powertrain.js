import { hot, load, save } from '../lamp-game.js';

export const ELECTRIC_CARS = { tesla: 310, ioniq: 280, cybertruck: 320, r1s: 330, r1t: 330 };
export const isElectric = kind => Object.hasOwn(ELECTRIC_CARS, kind);
export const batteries = hot(import.meta).state('batteries', {
  version: 1,
  start: () => ({ next: 1, cars: {}, ...load('ev-batteries') })
});
export function batteryFor(look) {
  if (!isElectric(look?.kind)) return null;
  look.energyId ||= `ev-${batteries.next++}`;
  return batteries.cars[look.energyId] ||= { charge: 0.8, charging: false, power: 0 };
}
export function saveBatteries() { save('ev-batteries', batteries); }
