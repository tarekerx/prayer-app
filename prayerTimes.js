/*
 * PrayerTimesLib
 * A self-contained, offline prayer-time calculator based on the
 * PrayTimes.org algorithm. No external libraries, APIs, or imports.
 *
 * The default method is the Muslim World League, per the project brief.
 */
(function () {
  "use strict";

  var DEG = Math.PI / 180;

  function dtr(d) {
    return d * DEG;
  }

  function rtd(r) {
    return r / DEG;
  }

  function sin(d) {
    return Math.sin(dtr(d));
  }

  function cos(d) {
    return Math.cos(dtr(d));
  }

  function tan(d) {
    return Math.tan(dtr(d));
  }

  function arcsin(x) {
    return rtd(Math.asin(x));
  }

  function arccos(x) {
    return rtd(Math.acos(x));
  }

  function arctan2(y, x) {
    return rtd(Math.atan2(y, x));
  }

  function arccot(x) {
    return rtd(Math.atan(1 / x));
  }

  function fixAngle(a) {
    return ((a % 360) + 360) % 360;
  }

  function fixHour(a) {
    return ((a % 24) + 24) % 24;
  }

  function julianDate(year, month, day) {
    if (month <= 2) {
      year -= 1;
      month += 12;
    }

    var A = Math.floor(year / 100);
    var B = 2 - A + Math.floor(A / 4);

    return (
      Math.floor(365.25 * (year + 4716)) +
      Math.floor(30.6001 * (month + 1)) +
      day +
      B -
      1524.5
    );
  }

  function sunPosition(jd) {
    var D = jd - 2451545.0;
    var g = fixAngle(357.529 + 0.98560028 * D);
    var q = fixAngle(280.459 + 0.98564736 * D);
    var L = fixAngle(q + 1.915 * sin(g) + 0.020 * sin(2 * g));
    var e = 23.439 - 0.00000036 * D;
    var RA = arctan2(cos(e) * sin(L), cos(L)) / 15;
    var eqt = q / 15 - fixHour(RA);
    var decl = arcsin(sin(e) * sin(L));

    return { declination: decl, equation: eqt };
  }

  function midDay(jd) {
    var pos = sunPosition(jd);
    return fixHour(12 - pos.equation);
  }

  function timeForAngle(angle, lat, decl, direction, jd) {
    var noon = midDay(jd);
    var numerator = -sin(angle) - sin(lat) * sin(decl);
    var denominator = cos(lat) * cos(decl);
    var t = (1 / 15) * arccos(numerator / denominator);

    return direction === "ccw" ? noon - t : noon + t;
  }

  function asrTime(factor, lat, decl, jd) {
    var angle = -arccot(factor + tan(Math.abs(lat - decl)));
    return timeForAngle(angle, lat, decl, "cw", jd);
  }

  var METHODS = {
    MuslimWorldLeague: { fajr: 18, isha: 17 },
    UmmAlQura: { fajr: 18.5, isha: "90 min" },
    Egyptian: { fajr: 19.5, isha: 17.5 },
    Karachi: { fajr: 18, isha: 18 },
    NorthAmerica: { fajr: 15, isha: 15 },
    Dubai: { fajr: 18.2, isha: 18.2 },
    Qatar: { fajr: 18, isha: "90 min" },
    Kuwait: { fajr: 18, isha: 17.5 },
    Singapore: { fajr: 20, isha: 18 },
    Turkey: { fajr: 18, isha: 17 },
    Tehran: { fajr: 17.7, isha: 14 },
    Jafari: { fajr: 16, isha: 14, maghrib: 4 }
  };

  function calculate(lat, lng, methodName, timezone, date) {
    if (!methodName || !METHODS[methodName]) {
      methodName = "MuslimWorldLeague";
    }

    var method = METHODS[methodName];
    date = date || new Date();

    var year = date.getFullYear();
    var month = date.getMonth() + 1;
    var day = date.getDate();

    if (timezone === null || timezone === undefined) {
      timezone = -date.getTimezoneOffset() / 60;
    }

    var jd = julianDate(year, month, day) - lng / (15 * 24);
    var pos = sunPosition(jd);
    var decl = pos.declination;

    var dhuhr = midDay(jd);
    var sunrise = timeForAngle(0.833, lat, decl, "ccw", jd);
    var sunset = timeForAngle(0.833, lat, decl, "cw", jd);
    var asr = asrTime(1, lat, decl, jd);

    var fajr =
      typeof method.fajr === "number"
        ? timeForAngle(method.fajr, lat, decl, "ccw", jd)
        : sunrise - 1.5;

    var isha;
    if (typeof method.isha === "number") {
      isha = timeForAngle(method.isha, lat, decl, "cw", jd);
    } else if (method.isha === "90 min") {
      isha = sunset + 1.5;
    } else {
      isha = sunset + 1.5;
    }

    var maghrib = method.maghrib === 4 ? sunset + 4 / 60 : sunset;

    function adjust(hours) {
      return fixHour(hours + timezone - lng / 15);
    }

    function toDate(hours) {
      var h = Math.floor(hours);
      var m = Math.floor((hours - h) * 60);
      return new Date(year, month - 1, day, h, m, 0);
    }

    return {
      fajr: toDate(adjust(fajr)),
      sunrise: toDate(adjust(sunrise)),
      dhuhr: toDate(adjust(dhuhr)),
      asr: toDate(adjust(asr)),
      maghrib: toDate(adjust(maghrib)),
      isha: toDate(adjust(isha))
    };
  }

  window.PrayerTimesLib = {
    calculate: calculate,
    METHODS: METHODS
  };
})();
