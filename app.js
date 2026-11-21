"use strict";

const PRAYER_KEYS = ["fajr", "dhuhr", "asr", "maghrib", "isha"];
const TIMER_MINUTES = 15;
const STORAGE_KEY = "prayerAppData";

// Default location: Al Aqeeq district, Riyadh, Saudi Arabia.
// GPS is still requested first; this is used immediately and as a fallback.
const DEFAULT_LOCATION = {
  lat: 24.77361,
  lng: 46.62998,
  label: "Riyadh — Al Aqeeq"
};

const locationStatus = document.getElementById("location-status");
const prayerList = document.getElementById("prayer-list");
const refreshBtn = document.getElementById("refresh-btn");
const methodSelect = document.getElementById("method-select");
const activeTimer = document.getElementById("active-timer");
const timerPrayerName = document.getElementById("timer-prayer-name");
const countdownEl = document.getElementById("countdown");
const dismissTimerBtn = document.getElementById("dismiss-timer");
const soundBanner = document.getElementById("sound-banner");

// Inject the location card directly after the header.
const locationCard = document.createElement("div");
locationCard.className = "location-card";
locationCard.innerHTML =
  '<div>📍 <strong>Location</strong></div><div id="loc-details">Not fetched yet</div>';
const header = document.querySelector("header");
header.insertAdjacentElement("afterend", locationCard);

// Inject the next-prayer box as the first child of main.
const nextPrayerBox = document.createElement("div");
nextPrayerBox.className = "next-prayer-box";
nextPrayerBox.innerHTML =
  '<div class="label">Next Prayer</div>' +
  '<div class="name" id="next-name">—</div>' +
  '<div class="countdown" id="next-countdown">00:00:00</div>' +
  '<div class="at-time" id="next-at"></div>';
const main = document.querySelector("main");
main.prepend(nextPrayerBox);

const nextName = document.getElementById("next-name");
const nextCountdown = document.getElementById("next-countdown");
const nextAt = document.getElementById("next-at");
const locDetails = document.getElementById("loc-details");

let scheduledTimeouts = [];
let countdownInterval = null;
let nextPrayerInterval = null;
let currentTimes = null;
let currentPrayerKey = null;
let sharedAudioCtx = null;

function loadData() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
  } catch (error) {
    return {};
  }
}

function saveData(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (error) {
    // Storage may be unavailable in private browsing; the app still works.
  }
}

function getPosition(options) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Geolocation is not supported by this browser"));
      return;
    }

    navigator.geolocation.getCurrentPosition(resolve, reject, options);
  });
}

function locationFromPosition(position) {
  const coords = position.coords;
  return {
    lat: coords.latitude,
    lng: coords.longitude,
    accuracy: coords.accuracy,
    fetchedAt: new Date().toISOString()
  };
}

function getLocationErrorMessage(error) {
  if (error && error.code === 1) {
    return "Location permission denied";
  }
  if (error && error.code === 2) {
    return "Location unavailable";
  }
  if (error && error.code === 3) {
    return "Location request timed out";
  }
  return "Unable to get your location";
}

async function getLocation() {
  if (!navigator.geolocation) {
    throw new Error("Geolocation is not supported by this browser");
  }

  try {
    const position = await getPosition({
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 0
    });
    return locationFromPosition(position);
  } catch (firstError) {
    // Do not retry when the user explicitly denied permission.
    if (firstError && firstError.code === 1) {
      throw new Error(getLocationErrorMessage(firstError));
    }

    try {
      // Fallback to a faster, less accurate fix (often works indoors/mobile).
      const position = await getPosition({
        enableHighAccuracy: false,
        timeout: 15000,
        maximumAge: 60000
      });
      return locationFromPosition(position);
    } catch (secondError) {
      throw new Error(getLocationErrorMessage(secondError));
    }
  }
}

function calculatePrayerTimes(lat, lng, methodName) {
  return PrayerTimesLib.calculate(lat, lng, methodName);
}

function createDefaultLocation() {
  return {
    lat: DEFAULT_LOCATION.lat,
    lng: DEFAULT_LOCATION.lng,
    accuracy: 0,
    fetchedAt: new Date().toISOString(),
    isDefault: true,
    label: DEFAULT_LOCATION.label
  };
}

function applyLocationAndTimes(location, method, data) {
  renderLocation(location);

  const times = calculatePrayerTimes(location.lat, location.lng, method);

  data.times = times;
  data.lastCalculated = new Date().toISOString();
  saveData(data);

  renderList(times);
  startNextPrayerCountdown(times);
  schedulePrayerAlerts(times);
}

function renderLocation(location) {
  if (!location) {
    locDetails.textContent = "Default: Riyadh — Al Aqeeq";
    return;
  }

  const fetchedTime = new Date(location.fetchedAt).getTime();
  const ageMs = Date.now() - fetchedTime;
  const ageMinutes = Math.floor(ageMs / 60000);
  const ageStr =
    !Number.isFinite(ageMs) || ageMinutes < 1 ? "just now" : ageMinutes + " min ago";

  if (location.isDefault) {
    locDetails.innerHTML =
      '<div class="coord">' +
      location.lat.toFixed(5) +
      "°, " +
      location.lng.toFixed(5) +
      "°</div>" +
      "<div>Default: " +
      (location.label || DEFAULT_LOCATION.label) +
      " · fetched " +
      ageStr +
      "</div>";
    return;
  }

  locDetails.innerHTML =
    '<div class="coord">' +
    location.lat.toFixed(5) +
    "°, " +
    location.lng.toFixed(5) +
    "°</div>" +
    "<div>Accuracy: ±" +
    Math.round(location.accuracy) +
    " m · fetched " +
    ageStr +
    "</div>";
}

function renderList(times) {
  prayerList.innerHTML = "";

  const now = Date.now();
  let nextKey = null;

  PRAYER_KEYS.forEach((key) => {
    const prayerTime = new Date(times[key]);
    const prayerMs = prayerTime.getTime();

    if (prayerMs > now && nextKey === null) {
      nextKey = key;
    }

    const row = document.createElement("div");
    row.className = "prayer-row";

    if (prayerMs < now) {
      row.classList.add("passed");
    }

    if (key === nextKey) {
      row.classList.add("next");
    }

    row.innerHTML =
      '<span class="prayer-name">' +
      key +
      '</span><span class="prayer-time">' +
      prayerTime.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) +
      "</span>";

    prayerList.appendChild(row);
  });
}

function startNextPrayerCountdown(times) {
  currentTimes = times;

  if (nextPrayerInterval) {
    clearInterval(nextPrayerInterval);
  }

  function update() {
    const now = Date.now();
    let nextKey = null;
    let nextTime = null;

    PRAYER_KEYS.forEach((key) => {
      const time = new Date(times[key]).getTime();
      if (time > now && (nextTime === null || time < nextTime)) {
        nextKey = key;
        nextTime = time;
      }
    });

    if (!nextKey) {
      nextName.textContent = "—";
      nextCountdown.textContent = "00:00:00";
      nextAt.textContent = "Tomorrow's times refresh at midnight";

      if (currentPrayerKey !== null) {
        currentPrayerKey = null;
        renderList(currentTimes);
      }
      return;
    }

    const remaining = Math.max(0, nextTime - now);
    const totalSeconds = Math.floor(remaining / 1000);
    const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, "0");
    const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, "0");
    const seconds = String(totalSeconds % 60).padStart(2, "0");

    nextName.textContent = nextKey;
    nextCountdown.textContent = hours + ":" + minutes + ":" + seconds;
    nextAt.textContent =
      "at " +
      new Date(nextTime).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit"
      });

    if (nextKey !== currentPrayerKey) {
      currentPrayerKey = nextKey;
      renderList(currentTimes);
    }
  }

  update();
  nextPrayerInterval = setInterval(update, 1000);
}

function getAudioContext() {
  try {
    if (!sharedAudioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) {
        return null;
      }
      sharedAudioCtx = new AudioContextClass();
    }
    return sharedAudioCtx;
  } catch (error) {
    return null;
  }
}

function unlockAudioFromTap() {
  const ctx = getAudioContext();
  if (!ctx) {
    return;
  }

  const resumePromise =
    ctx.state === "suspended" ? ctx.resume() : Promise.resolve();

  resumePromise
    .then(() => {
      try {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = "sine";
        osc.frequency.value = 440;
        gain.gain.value = 0.0001;

        osc.connect(gain).connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.05);
      } catch (error) {
        // The inaudible prime is best-effort.
      }

      if (soundBanner) {
        soundBanner.textContent = "🔔 Sound enabled ✓";
      }

      try {
        localStorage.setItem("prayerSoundEnabled", "1");
      } catch (error) {
        // Ignore storage failures.
      }

      setTimeout(() => {
        if (soundBanner && soundBanner.parentNode) {
          soundBanner.remove();
        }
      }, 2500);
    })
    .catch(() => {});
}

if (soundBanner) {
  soundBanner.addEventListener("click", unlockAudioFromTap);

  try {
    if (localStorage.getItem("prayerSoundEnabled") === "1") {
      soundBanner.remove();
    }
  } catch (error) {
    // Ignore storage failures.
  }
}

function quietlyResumeAudio() {
  let ctx = sharedAudioCtx;

  // After a reload the banner is gone, so the first ordinary tap re-creates
  // and resumes the context when sound was previously enabled.
  if (!ctx) {
    try {
      if (localStorage.getItem("prayerSoundEnabled") !== "1") {
        return;
      }
    } catch (error) {
      return;
    }
    ctx = getAudioContext();
  }

  if (ctx && ctx.state === "suspended") {
    ctx.resume().catch(() => {});
  }
}

document.addEventListener("click", quietlyResumeAudio, { passive: true });
document.addEventListener("touchstart", quietlyResumeAudio, { passive: true });
document.addEventListener("pointerdown", quietlyResumeAudio, { passive: true });

function playAdhanChime() {
  const ctx = getAudioContext();
  if (!ctx) {
    return;
  }

  if (ctx.state === "suspended") {
    ctx.resume().catch(() => {});
  }

  const notes = [659.25, 830.61, 987.77, 659.25, 830.61, 987.77];

  try {
    notes.forEach((frequency, index) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const start = ctx.currentTime + index * 0.45;

      osc.type = "sine";
      osc.frequency.value = frequency;

      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.25, start + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.4);

      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.45);
    });
  } catch (error) {
    // Audio is a progressive enhancement.
  }
}

function clearScheduled() {
  scheduledTimeouts.forEach((timeoutId) => clearTimeout(timeoutId));
  scheduledTimeouts = [];

  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }
}

function schedulePrayerAlerts(times) {
  clearScheduled();

  const now = Date.now();

  PRAYER_KEYS.forEach((key) => {
    const prayerTime = new Date(times[key]).getTime();
    const delay = prayerTime - now;

    if (delay > 0 && delay < 24 * 60 * 60 * 1000) {
      const timeoutId = setTimeout(() => triggerPrayer(key), delay);
      scheduledTimeouts.push(timeoutId);
    }

    const elapsed = now - prayerTime;
    if (elapsed > 0 && elapsed < TIMER_MINUTES * 60 * 1000) {
      triggerPrayer(key, TIMER_MINUTES * 60 * 1000 - elapsed);
    }
  });
}

function triggerPrayer(prayerKey, remainingMs) {
  if (remainingMs === undefined) {
    remainingMs = TIMER_MINUTES * 60 * 1000;
  }

  timerPrayerName.textContent = "🕌 " + prayerKey.toUpperCase() + " time";
  activeTimer.classList.remove("hidden");

  playAdhanChime();

  if (
    "vibrate" in navigator &&
    /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent)
  ) {
    try {
      navigator.vibrate([300, 150, 300, 150, 300]);
    } catch (error) {
      // Vibration is optional.
    }
  }

  if ("Notification" in window && Notification.permission === "granted") {
    try {
      new Notification(prayerKey.toUpperCase() + " time", {
        body: "15-minute timer started",
        silent: false
      });
    } catch (error) {
      // Notifications are optional.
    }
  }

  startCountdown(remainingMs);
}

function startCountdown(ms) {
  if (countdownInterval) {
    clearInterval(countdownInterval);
  }

  const endTime = Date.now() + ms;

  function tick() {
    const remaining = endTime - Date.now();

    if (remaining <= 0) {
      countdownEl.textContent = "00:00";
      if (countdownInterval) {
        clearInterval(countdownInterval);
        countdownInterval = null;
      }
      return;
    }

    const totalSeconds = Math.floor(remaining / 1000);
    const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
    const seconds = String(totalSeconds % 60).padStart(2, "0");

    countdownEl.textContent = minutes + ":" + seconds;
  }

  tick();
  countdownInterval = setInterval(tick, 1000);
}

dismissTimerBtn.addEventListener("click", () => {
  activeTimer.classList.add("hidden");

  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }
});

async function init(forceRefresh = false) {
  const data = loadData();

  // Sensible default: Muslim World League when no saved method exists.
  const method = methodSelect.value || data.method || "MuslimWorldLeague";
  methodSelect.value = method;
  data.method = method;

  const hasSavedLocation = !!data.location;
  let location = data.location;
  let defaultApplied = false;

  if (!location) {
    location = createDefaultLocation();
    data.location = location;
    saveData(data);
  }

  // Show the Riyadh default immediately while a first GPS fix is requested.
  if (!hasSavedLocation) {
    locationStatus.textContent = "📍 Default: Riyadh — Al Aqeeq";
    applyLocationAndTimes(location, method, data);
    defaultApplied = true;
  }

  if (!forceRefresh && hasSavedLocation) {
    locationStatus.textContent = location.isDefault
      ? "📍 Default: Riyadh — Al Aqeeq"
      : "📍 Using saved location";
    applyLocationAndTimes(location, method, data);
    return;
  }

  locationStatus.textContent = "Getting your precise location…";

  try {
    const freshLocation = await getLocation();
    data.location = freshLocation;
    saveData(data);
    locationStatus.textContent = "📍 Location updated";
    applyLocationAndTimes(freshLocation, method, data);
  } catch (error) {
    const message =
      error && error.message ? error.message : "Unable to get your location";

    if (hasSavedLocation) {
      locationStatus.textContent = location.isDefault
        ? "📍 Default: Riyadh — Al Aqeeq"
        : "Using last saved location";
      applyLocationAndTimes(location, method, data);
    } else {
      locationStatus.textContent = "📍 Default: Riyadh — Al Aqeeq";
      if (!defaultApplied) {
        applyLocationAndTimes(location, method, data);
      }
    }
  }
}

refreshBtn.addEventListener("click", () => init(true));

methodSelect.addEventListener("change", () => init(false));

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    init(false);
  }
});

setInterval(() => {
  const data = loadData();

  if (!data.lastCalculated) {
    return;
  }

  const lastCalculated = new Date(data.lastCalculated);
  if (Number.isNaN(lastCalculated.getTime())) {
    return;
  }

  if (lastCalculated.toDateString() !== new Date().toDateString()) {
    init(false);
  }
}, 60000);

if ("Notification" in window && Notification.permission === "default") {
  try {
    Notification.requestPermission().catch(() => {});
  } catch (error) {
    // Notifications are optional.
  }
}

if ("serviceWorker" in navigator) {
  try {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  } catch (error) {
    // Service workers require HTTPS or localhost.
  }
}

window.triggerPrayer = triggerPrayer;
window.initApp = init;

// Restore the saved calculation method once, before the first calculation.
const initialData = loadData();
if (initialData.method && PrayerTimesLib.METHODS[initialData.method]) {
  methodSelect.value = initialData.method;
}

init(false);
