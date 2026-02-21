/**
 * suncalc.js — Sunrise/sunset calculator.
 * Adapted from https://github.com/mourner/suncalc (MIT License).
 * Stripped down to only what we need: sunrise and sunset times.
 */
'use strict';

(function (global) {
  const rad    = Math.PI / 180;
  const dayMs  = 86_400_000;
  const J1970  = 2_440_588;
  const J2000  = 2_451_545;
  const e      = rad * 23.4397; // obliquity of Earth's orbit

  function toJulian(date) { return date.valueOf() / dayMs - 0.5 + J1970; }
  function fromJulian(j)  { return new Date((j + 0.5 - J1970) * dayMs); }
  function toDays(date)   { return toJulian(date) - J2000; }

  function declination(l, b) {
    return Math.asin(Math.sin(b) * Math.cos(e) + Math.cos(b) * Math.sin(e) * Math.sin(l));
  }

  function solarMeanAnomaly(d) {
    return rad * (357.5291 + 0.98560028 * d);
  }

  function eclipticLongitude(M) {
    const C = rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
    const P = rad * 102.9372;
    return M + C + P + Math.PI;
  }

  function julianCycle(d, lw)      { return Math.round(d - 0.0009 - lw / (2 * Math.PI)); }
  function approxTransit(Ht, lw, n){ return 0.0009 + (Ht + lw) / (2 * Math.PI) + n; }
  function solarTransitJ(ds, M, L) { return J2000 + ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L); }

  function hourAngle(h, phi, dec) {
    return Math.acos(
      (Math.sin(h) - Math.sin(phi) * Math.sin(dec)) /
      (Math.cos(phi) * Math.cos(dec))
    );
  }

  /**
   * Returns { sunrise: Date, sunset: Date } in UTC for the given date and coordinates.
   * @param {Date}   date
   * @param {number} lat  Latitude in degrees
   * @param {number} lng  Longitude in degrees
   */
  function getSunTimes(date, lat, lng) {
    const lw  = rad * -lng;
    const phi = rad * lat;
    const d   = toDays(date);
    const n   = julianCycle(d, lw);
    const ds  = approxTransit(0, lw, n);
    const M   = solarMeanAnomaly(ds);
    const L   = eclipticLongitude(M);
    const dec = declination(L, 0);
    const Jnoon = solarTransitJ(ds, M, L);

    // h0: angle for sunrise/sunset (includes atmospheric refraction + solar disc radius)
    const h0   = rad * -0.833;
    const w0   = hourAngle(h0, phi, dec);
    const Jset  = solarTransitJ(approxTransit(w0, lw, n), M, L);
    const Jrise = Jnoon - (Jset - Jnoon);

    return {
      sunrise: fromJulian(Jrise),
      sunset:  fromJulian(Jset),
    };
  }

  global.SunCalc = { getSunTimes };
})(globalThis);
